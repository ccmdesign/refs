import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  boardYamlPath,
  refYamlPath,
  trashDir,
} from "./paths.ts";
import type { BoardData, RefData } from "./types.ts";
import { atomicWrite, atomicWriteSync } from "./util.ts";
import {
  parseBoard,
  readBoardFile,
  readRefFile,
  stringifyBoard,
  stringifyRef,
} from "./yaml.ts";
import { rebuildBoardOutput } from "./output.ts";

export function getRef(lib: string, id: string): RefData {
  const path = refYamlPath(lib, id);
  if (!existsSync(path)) throw new Error(`Ref not found: ${id}`);
  return readRefFile(path);
}

export function listAllRefIds(lib: string): string[] {
  const dir = join(lib, "refs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));
}

export function listAllRefs(lib: string): RefData[] {
  return listAllRefIds(lib).map((id) => getRef(lib, id));
}

function loadAllBoards(lib: string): Map<string, BoardData> {
  const boards = new Map<string, BoardData>();
  const boardsDir = join(lib, "boards");
  if (!existsSync(boardsDir)) return boards;

  function walk(rel: string): void {
    const full = rel ? join(boardsDir, rel) : boardsDir;
    for (const ent of readdirSync(full, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        walk(rel ? `${rel}/${ent.name}` : ent.name);
      } else if (ent.name.endsWith(".yaml") && !ent.name.endsWith(".yaml.lock")) {
        const boardPath = rel
          ? `${rel}/${ent.name.replace(/\.yaml$/, "")}`
          : ent.name.replace(/\.yaml$/, "");
        boards.set(boardPath, readBoardFile(join(full, ent.name)));
      }
    }
  }
  walk("");
  return boards;
}

export function listRefIdsOnBoard(lib: string, boardPath: string): string[] {
  const path = boardYamlPath(lib, boardPath);
  if (!existsSync(path)) throw new Error(`Board not found: ${boardPath}`);
  const board = readBoardFile(path);
  return board.refs.map((r) => r.id);
}

export function listRefIdsOnBoardTree(lib: string, boardPath: string): string[] {
  const boards = loadAllBoards(lib);
  const ids = new Set<string>();
  for (const [path, board] of boards) {
    if (path === boardPath || path.startsWith(boardPath + "/")) {
      for (const r of board.refs) ids.add(r.id);
    }
  }
  return [...ids];
}

export function listUnsortedRefIds(lib: string): string[] {
  const allIds = new Set(listAllRefIds(lib));
  const boards = loadAllBoards(lib);
  for (const board of boards.values()) {
    for (const r of board.refs) allIds.delete(r.id);
  }
  return [...allIds].sort();
}

export type ListRefsOptions = {
  board?: string;
  includeSubBoards?: boolean;
  unsorted?: boolean;
  tag?: string;
};

export function listRefs(lib: string, options: ListRefsOptions = {}): RefData[] {
  let ids: string[];
  if (options.unsorted) {
    ids = listUnsortedRefIds(lib);
  } else if (options.board) {
    ids = options.includeSubBoards
      ? listRefIdsOnBoardTree(lib, options.board)
      : listRefIdsOnBoard(lib, options.board);
  } else {
    ids = listAllRefIds(lib);
  }

  let refs = ids.map((id) => getRef(lib, id));
  if (options.tag) {
    const tag = options.tag.toLowerCase();
    refs = refs.filter((r) => {
      const human = (r.tags ?? []).map((t) => t.toLowerCase());
      const machine = (r.auto?.tags ?? []).map((t) => t.toLowerCase());
      return human.includes(tag) || machine.includes(tag);
    });
  }
  return refs;
}

export type UpdateRefInput = {
  title?: string;
  source?: string;
  note?: string;
  tags?: string[];
  auto?: RefData["auto"];
};

export function updateRef(lib: string, id: string, input: UpdateRefInput): RefData {
  const ref = getRef(lib, id);
  if (input.title !== undefined) ref.title = input.title || undefined;
  if (input.source !== undefined) ref.source = input.source || undefined;
  if (input.note !== undefined) ref.note = input.note || undefined;
  if (input.tags !== undefined) ref.tags = input.tags.length ? input.tags : undefined;
  if (input.auto !== undefined) ref.auto = input.auto;
  atomicWriteSync(refYamlPath(lib, id), stringifyRef(ref));
  return ref;
}

export async function deleteRef(lib: string, id: string): Promise<void> {
  const ref = getRef(lib, id);
  const trash = trashDir(lib);
  await mkdir(trash, { recursive: true });

  const refPath = refYamlPath(lib, id);
  const trashRef = join(trash, `${id}.yaml`);
  if (existsSync(refPath)) renameSync(refPath, trashRef);

  if (ref.file) {
    const imgPath = join(lib, ref.file);
    if (existsSync(imgPath)) {
      renameSync(imgPath, join(trash, basename(imgPath)));
    }
  }

  const boardsDir = join(lib, "boards");
  if (!existsSync(boardsDir)) return;

  async function walkBoards(rel: string): Promise<void> {
    const full = rel ? join(boardsDir, rel) : boardsDir;
    const entries = await readdir(full, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        await walkBoards(rel ? `${rel}/${ent.name}` : ent.name);
      } else if (ent.name.endsWith(".yaml") && !ent.name.endsWith(".yaml.lock")) {
        const boardPath = rel
          ? `${rel}/${ent.name.replace(/\.yaml$/, "")}`
          : ent.name.replace(/\.yaml$/, "");
        const bPath = join(full, ent.name);
        const board = parseBoard(readFileSync(bPath, "utf8"));
        if (board.refs.some((r) => r.id === id)) {
          board.refs = board.refs.filter((r) => r.id !== id);
          await atomicWrite(bPath, stringifyBoard(board));
          await rebuildBoardOutput(lib, boardPath);
        }
      }
    }
  }
  await walkBoards("");
}
