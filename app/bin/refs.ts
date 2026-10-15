#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { getLibraryPath } from "../core/paths.ts";
import {
  createBoard,
  deleteBoard,
  listBoards,
  moveRefBetweenBoards,
  removeRefFromBoard,
  renameBoard,
  setBoardBrief,
} from "../core/board.ts";
import { addInput } from "../core/intake.ts";
import {
  exportBoard,
  getGeneratedBoardPath,
  readGeneratedRefsYaml,
  rebuildAllOutput,
  rebuildBoardOutput,
} from "../core/output.ts";
import { deleteRef, listRefIdsOnBoard } from "../core/ref.ts";
import {
  checkTagger,
  compareTagFiles,
  formatCompareTable,
  kickTagger,
  runTagWorker,
  tagRef,
} from "../core/tagger.ts";

const USAGE = `refs — design reference library CLI

Usage:
  refs add <file|url>... [--board <board>] [--note <text>] [--board-note <text>] [--key] [--tags a,b] [--source <url>] [--title <text>]
  refs boards
  refs show <board>
  refs board create <board>
  refs board rename <from> <to>
  refs board rm <board>
  refs board brief <board> <text>
  refs rm <id> --board <board>
  refs delete <id>
  refs move <id> --from <board> --to <board>
  refs export <board> --to <dir>
  refs rebuild
  refs path <board>
  refs tag <id>
  refs tag --board <board>
  refs tag --untagged
  refs tag --worker
  refs tag --check
  refs tag --compare <model-a>,<model-b> <file>...

Options:
  --json    Machine-readable JSON output
  --help    Show this help
`;

type Parsed = {
  cmd: string;
  rest: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
};

function parseArgv(argv: string[]): Parsed {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      flags.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(a);
  }
  const cmd = positional[0] ?? "";
  const rest = positional.slice(1);
  return { cmd, rest, flags, json };
}

function out(data: unknown, json: boolean, plain?: string): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (plain !== undefined) {
    console.log(plain);
  } else if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    console.log(String(data));
  }
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main(): Promise<void> {
  const { cmd, rest, flags, json } = parseArgv(process.argv.slice(2));
  if (flags.help || !cmd) {
    console.log(USAGE.trim());
    process.exit(cmd ? 0 : flags.help ? 0 : 1);
  }

  const lib = getLibraryPath();

  try {
    if (cmd === "add") {
      if (rest.length === 0) fail("refs add requires at least one file or URL");
      const board = flags.board as string | undefined;
      const tagsRaw = flags.tags as string | undefined;
      const tags = tagsRaw
        ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;
      const results = [];
      for (const input of rest) {
        const result = await addInput(lib, input, {
          board,
          note: flags.note as string | undefined,
          boardNote: flags["board-note"] as string | undefined,
          key: flags.key === true,
          tags,
          source: flags.source as string | undefined,
          title: flags.title as string | undefined,
        });
        results.push(result);
      }
      if (json) out(results, true);
      else {
        for (const r of results) {
          console.log(
            r.duplicate ? `duplicate ${r.id}` : `added ${r.id}`,
          );
        }
      }
      kickTagger(lib);
      return;
    }

    if (cmd === "tag") {
      if (flags.check === true) {
        const result = await checkTagger(lib);
        if (json) out(result, true);
        else {
          console.log(`adapter: ${result.adapter}`);
          console.log(result.ok ? "ok" : "fail");
          console.log(result.detail);
        }
        if (!result.ok && result.adapter !== "none") process.exit(1);
        return;
      }
      if (flags.worker === true || flags.untagged === true) {
        await runTagWorker(lib);
        out({ tagged: true }, json);
        return;
      }
      if (flags.compare) {
        const pair = String(flags.compare);
        const [modelA, modelB] = pair.split(",").map((s) => s.trim());
        if (!modelA || !modelB || rest.length === 0) {
          fail("refs tag --compare requires <model-a>,<model-b> and at least one file");
        }
        const rows = await compareTagFiles(modelA, modelB, rest);
        console.log(formatCompareTable(rows));
        return;
      }
      const board = flags.board as string | undefined;
      if (board) {
        const ids = listRefIdsOnBoard(lib, board);
        const tagged = [];
        for (const id of ids) {
          try {
            tagged.push(await tagRef(lib, id));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes("no local image")) throw err;
          }
        }
        if (json) out(tagged, true);
        else console.log(`tagged ${tagged.length} ref(s) on ${board}`);
        return;
      }
      const id = rest[0];
      if (!id) fail("refs tag requires <id> or --board / --untagged / --compare");
      const ref = await tagRef(lib, id);
      if (json) out(ref, true);
      else {
        console.log(ref.auto?.tags?.join(", ") ?? "");
        if (ref.auto?.description) console.log(ref.auto.description);
      }
      return;
    }

    if (cmd === "boards") {
      const boards = listBoards(lib);
      if (json) out(boards, true);
      else boards.forEach((b) => console.log(b));
      return;
    }

    if (cmd === "show") {
      const board = rest[0];
      if (!board) fail("refs show requires a board path");
      await rebuildBoardOutput(lib, board);
      const path = getGeneratedBoardPath(lib, board);
      if (json) out(readGeneratedRefsYaml(lib, board), true);
      else console.log(readFileSync(`${path}/refs.yaml`, "utf8").trimEnd());
      return;
    }

    if (cmd === "board") {
      const sub = rest[0];
      if (sub === "create") {
        const name = rest[1];
        if (!name) fail("refs board create requires a board path");
        createBoard(lib, name);
        await rebuildBoardOutput(lib, name);
        out({ created: name }, json);
        return;
      }
      if (sub === "rename") {
        const from = rest[1];
        const to = rest[2];
        if (!from || !to) fail("refs board rename requires <from> <to>");
        renameBoard(lib, from, to);
        await rebuildAllOutput(lib);
        out({ renamed: { from, to } }, json);
        return;
      }
      if (sub === "rm") {
        const name = rest[1];
        if (!name) fail("refs board rm requires a board path");
        deleteBoard(lib, name);
        out({ removed: name }, json);
        return;
      }
      if (sub === "brief") {
        const name = rest[1];
        if (!name) fail("refs board brief requires a board path");
        const textParts = rest.slice(2);
        if (textParts.length === 0) fail("refs board brief requires text");
        const brief = textParts.join(" ");
        setBoardBrief(lib, name, brief);
        await rebuildBoardOutput(lib, name);
        out({ board: name, brief }, json);
        return;
      }
      fail(`Unknown board subcommand: ${sub ?? "(none)"}`);
    }

    if (cmd === "rm") {
      const id = rest[0];
      const board = flags.board as string | undefined;
      if (!id || !board) fail("refs rm requires <id> --board <board>");
      removeRefFromBoard(lib, board, id);
      await rebuildBoardOutput(lib, board);
      out({ removed: id, board }, json);
      return;
    }

    if (cmd === "delete") {
      const id = rest[0];
      if (!id) fail("refs delete requires <id>");
      await deleteRef(lib, id);
      out({ deleted: id }, json);
      return;
    }

    if (cmd === "move") {
      const id = rest[0];
      const from = flags.from as string | undefined;
      const to = flags.to as string | undefined;
      if (!id || !from || !to) fail("refs move requires <id> --from <board> --to <board>");
      moveRefBetweenBoards(lib, id, from, to);
      await rebuildBoardOutput(lib, from);
      await rebuildBoardOutput(lib, to);
      out({ id, from, to }, json);
      return;
    }

    if (cmd === "export") {
      const board = rest[0];
      const to = flags.to as string | undefined;
      if (!board || !to) fail("refs export requires <board> --to <dir>");
      await exportBoard(lib, board, to);
      out({ exported: board, to }, json);
      return;
    }

    if (cmd === "rebuild") {
      await rebuildAllOutput(lib);
      out({ rebuilt: true }, json);
      return;
    }

    if (cmd === "path") {
      const board = rest[0];
      if (!board) fail("refs path requires <board>");
      const p = getGeneratedBoardPath(lib, board);
      console.log(p);
      return;
    }

    fail(`Unknown command: ${cmd}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(msg);
  }
}

main();
