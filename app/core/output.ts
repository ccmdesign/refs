import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import YAML from "yaml";
import { dirname, join, relative, resolve } from "node:path";
import { boardOutputDir, boardYamlPath } from "./paths.ts";
import type { OutputRefEntry, OutputRefsYaml } from "./types.ts";
import { slugify } from "./util.ts";
import { stringifyOutput } from "./yaml.ts";
import { collectParentBriefs, getBoard, listBoards } from "./board.ts";
import { getRef } from "./ref.ts";

function sortBoardRefs(
  board: ReturnType<typeof getBoard>,
): typeof board.refs {
  return [...board.refs].sort((a, b) => {
    const ak = a.key ? 1 : 0;
    const bk = b.key ? 1 : 0;
    if (ak !== bk) return bk - ak;
    return a.added.localeCompare(b.added);
  });
}

function outputFileName(ref: ReturnType<typeof getRef>, id: string): string {
  const title = ref.title || id;
  const ext = ref.file ? ref.file.split(".").pop()! : "link";
  return `${slugify(title)}-${id.slice(0, 6)}.${ext}`;
}

function buildOutputYaml(
  lib: string,
  boardPath: string,
): OutputRefsYaml {
  const board = getBoard(lib, boardPath);
  const parentBriefs = collectParentBriefs(lib, boardPath);
  const refs: OutputRefEntry[] = [];

  for (const entry of sortBoardRefs(board)) {
    const ref = getRef(lib, entry.id);
    const out: OutputRefEntry = { id: entry.id };
    if (ref.file) {
      out.file = outputFileName(ref, entry.id);
    } else if (ref.url) {
      out.url = ref.url;
    }
    if (entry.key) out.key = true;
    if (ref.note) out.note = ref.note;
    if (entry.note) out.board_note = entry.note;
    if (ref.tags?.length) out.tags = ref.tags;
    if (ref.auto?.tags?.length) out.machine_tags = ref.auto.tags;
    if (ref.auto?.description) out.description = ref.auto.description;
    if (ref.source) out.source = ref.source;
    refs.push(out);
  }

  const doc: OutputRefsYaml = {
    board: boardPath,
    refs,
  };
  if (board.brief) doc.brief = board.brief;
  if (parentBriefs.length) doc.parent_briefs = parentBriefs;
  return doc;
}

export async function rebuildBoardOutput(lib: string, boardPath: string): Promise<void> {
  if (!existsSync(boardYamlPath(lib, boardPath))) return;

  const outDir = boardOutputDir(lib, boardPath);
  mkdirSync(outDir, { recursive: true });

  const board = getBoard(lib, boardPath);
  const desiredLinks = new Map<string, { rel: string; abs: string }>();

  for (const entry of board.refs) {
    const ref = getRef(lib, entry.id);
    if (!ref.file) continue;
    const linkName = outputFileName(ref, entry.id);
    const abs = resolve(lib, ref.file);
    desiredLinks.set(linkName, { rel: relative(outDir, abs), abs });
  }

  const existing = existsSync(outDir)
    ? readdirSync(outDir, { withFileTypes: true })
    : [];

  for (const ent of existing) {
    if (ent.name === "refs.yaml") continue;
    const full = join(outDir, ent.name);
    if (ent.isDirectory()) continue;
    if (!desiredLinks.has(ent.name)) {
      rmSync(full, { force: true });
    }
  }

  for (const [name, { rel, abs }] of desiredLinks) {
    const linkPath = join(outDir, name);
    if (existsSync(linkPath)) {
      try {
        const current = readlinkSync(linkPath);
        if (resolve(dirname(linkPath), current) === abs) continue;
      } catch {
        /* not a symlink */
      }
      unlinkSync(linkPath);
    }
    symlinkSync(rel, linkPath);
  }

  const yaml = buildOutputYaml(lib, boardPath);
  const yamlDoc: Record<string, unknown> = {
    board: yaml.board,
  };
  if (yaml.brief) yamlDoc.brief = yaml.brief;
  if (yaml.parent_briefs?.length) yamlDoc.parent_briefs = yaml.parent_briefs;
  yamlDoc.refs = yaml.refs;
  writeFileSync(join(outDir, "refs.yaml"), stringifyOutput(yamlDoc));
}

export async function rebuildAllOutput(lib: string): Promise<void> {
  // Start clean so folders of renamed or deleted boards do not linger.
  rmSync(join(lib, "out"), { recursive: true, force: true });
  const boards = listBoards(lib);
  for (const b of boards) {
    await rebuildBoardOutput(lib, b);
  }
}

export function getGeneratedBoardPath(lib: string, boardPath: string): string {
  return resolve(boardOutputDir(lib, boardPath));
}

export function readGeneratedRefsYaml(lib: string, boardPath: string): OutputRefsYaml {
  const outDir = boardOutputDir(lib, boardPath);
  const path = join(outDir, "refs.yaml");
  if (!existsSync(path)) {
    throw new Error(`Generated output not found for board: ${boardPath}`);
  }
  return YAML.parse(readFileSync(path, "utf8")) as OutputRefsYaml;
}

export async function exportBoard(
  lib: string,
  boardPath: string,
  targetDir: string,
): Promise<void> {
  await rebuildBoardOutput(lib, boardPath);
  const srcDir = boardOutputDir(lib, boardPath);
  mkdirSync(targetDir, { recursive: true });

  const board = getBoard(lib, boardPath);
  for (const ent of readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.isDirectory()) continue;
    const src = join(srcDir, ent.name);
    const dest = join(targetDir, ent.name);
    if (ent.name === "refs.yaml") {
      copyFileSync(src, dest);
      continue;
    }
    const entry = board.refs.find((r) => {
      const ref = getRef(lib, r.id);
      return outputFileName(ref, r.id) === ent.name;
    });
    if (entry) {
      const ref = getRef(lib, entry.id);
      if (ref.file) {
        copyFileSync(resolve(lib, ref.file), dest);
      }
    } else {
      copyFileSync(src, dest);
    }
  }

}
