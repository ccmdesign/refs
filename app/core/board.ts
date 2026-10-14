import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { boardYamlPath } from "./paths.ts";
import type { BoardData, BoardRefEntry, ParentBriefEntry } from "./types.ts";
import {
  isSubBoardPath,
  parentBoardPath,
  splitBoardPath,
  validateBoardPath,
  withBoardLockSync,
} from "./util.ts";
import { parseBoard, readBoardFile, stringifyBoard } from "./yaml.ts";
import { atomicWriteSync } from "./util.ts";
import { getRef } from "./ref.ts";

function writeBoard(lib: string, boardPath: string, data: BoardData): void {
  const path = boardYamlPath(lib, boardPath);
  mkdirSync(join(lib, "boards", ...splitBoardPath(boardPath).slice(0, -1)), {
    recursive: true,
  });
  atomicWriteSync(path, stringifyBoard(data));
}

export function getBoard(lib: string, boardPath: string): BoardData {
  const path = boardYamlPath(lib, boardPath);
  if (!existsSync(path)) throw new Error(`Board not found: ${boardPath}`);
  return readBoardFile(path);
}

export function listBoards(lib: string): string[] {
  const boardsDir = join(lib, "boards");
  if (!existsSync(boardsDir)) return [];
  const out: string[] = [];

  function walk(rel: string): void {
    const full = rel ? join(boardsDir, rel) : boardsDir;
    for (const ent of readdirSync(full, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        walk(rel ? `${rel}/${ent.name}` : ent.name);
      } else if (ent.name.endsWith(".yaml") && !ent.name.endsWith(".yaml.lock")) {
        const boardPath = rel
          ? `${rel}/${ent.name.replace(/\.yaml$/, "")}`
          : ent.name.replace(/\.yaml$/, "");
        out.push(boardPath);
      }
    }
  }
  walk("");
  return out.sort();
}

export function createBoard(lib: string, boardPath: string): void {
  validateBoardPath(boardPath);
  const path = boardYamlPath(lib, boardPath);
  if (existsSync(path)) throw new Error(`Board already exists: ${boardPath}`);
  const segments = splitBoardPath(boardPath);
  for (let i = 1; i < segments.length; i++) {
    const parent = segments.slice(0, i).join("/");
    const parentPath = boardYamlPath(lib, parent);
    if (!existsSync(parentPath)) {
      writeBoard(lib, parent, { refs: [] });
    }
  }
  writeBoard(lib, boardPath, { refs: [] });
}

export function renameBoard(lib: string, from: string, to: string): void {
  validateBoardPath(from);
  validateBoardPath(to);
  if (!existsSync(boardYamlPath(lib, from))) {
    throw new Error(`Board not found: ${from}`);
  }
  if (from === to) return;
  if (isSubBoardPath(from, to)) {
    throw new Error(`Cannot move a board into itself: ${from}`);
  }
  if (existsSync(boardYamlPath(lib, to))) {
    throw new Error(`Board already exists: ${to}`);
  }
  // A board always has its parents, as with createBoard.
  const parent = parentBoardPath(to);
  if (parent && !existsSync(boardYamlPath(lib, parent))) createBoard(lib, parent);
  const boards = listBoards(lib);
  const toMove = boards.filter((b) => b === from || isSubBoardPath(from, b));
  toMove.sort((a, b) => b.length - a.length);

  for (const oldPath of toMove) {
    const suffix = oldPath === from ? "" : oldPath.slice(from.length + 1);
    const newPath = suffix ? `${to}/${suffix}` : to;
    const oldYaml = boardYamlPath(lib, oldPath);
    const newYaml = boardYamlPath(lib, newPath);
    mkdirSync(join(lib, "boards", ...splitBoardPath(newPath).slice(0, -1)), {
      recursive: true,
    });
    renameSync(oldYaml, newYaml);
    const oldLock = `${oldYaml}.lock`;
    if (existsSync(oldLock)) unlinkSync(oldLock);
  }
}

export function deleteBoard(lib: string, boardPath: string): void {
  if (!existsSync(boardYamlPath(lib, boardPath))) {
    throw new Error(`Board not found: ${boardPath}`);
  }
  const boards = listBoards(lib);
  for (const b of boards) {
    if (b === boardPath || isSubBoardPath(boardPath, b)) {
      unlinkSync(boardYamlPath(lib, b));
      const lock = `${boardYamlPath(lib, b)}.lock`;
      if (existsSync(lock)) unlinkSync(lock);
      const out = join(lib, "out", b);
      if (existsSync(out)) rmSync(out, { recursive: true, force: true });
    }
  }
}

export function setBoardBrief(lib: string, boardPath: string, brief: string): BoardData {
  return withBoardLockSync(lib, boardPath, () => {
    const board = getBoard(lib, boardPath);
    board.brief = brief || undefined;
    writeBoard(lib, boardPath, board);
    return board;
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

export type AddRefToBoardOptions = {
  note?: string;
  key?: boolean;
};

export function addRefToBoard(
  lib: string,
  boardPath: string,
  refId: string,
  options: AddRefToBoardOptions = {},
): BoardData {
  getRef(lib, refId);
  return withBoardLockSync(lib, boardPath, () => {
    const board = getBoard(lib, boardPath);
    const existing = board.refs.find((r) => r.id === refId);
    if (existing) {
      if (options.note !== undefined) existing.note = options.note || undefined;
      if (options.key !== undefined) existing.key = options.key || undefined;
    } else {
      const entry: BoardRefEntry = { id: refId, added: nowIso() };
      if (options.note) entry.note = options.note;
      if (options.key) entry.key = options.key;
      board.refs.push(entry);
    }
    writeBoard(lib, boardPath, board);
    return board;
  });
}

export function removeRefFromBoard(
  lib: string,
  boardPath: string,
  refId: string,
): BoardData {
  return withBoardLockSync(lib, boardPath, () => {
    const board = getBoard(lib, boardPath);
    board.refs = board.refs.filter((r) => r.id !== refId);
    writeBoard(lib, boardPath, board);
    return board;
  });
}

export function updateBoardRef(
  lib: string,
  boardPath: string,
  refId: string,
  input: { note?: string; key?: boolean },
): BoardData {
  return withBoardLockSync(lib, boardPath, () => {
    const board = getBoard(lib, boardPath);
    const entry = board.refs.find((r) => r.id === refId);
    if (!entry) throw new Error(`Ref ${refId} not on board ${boardPath}`);
    if (input.note !== undefined) entry.note = input.note || undefined;
    if (input.key !== undefined) entry.key = input.key || undefined;
    writeBoard(lib, boardPath, board);
    return board;
  });
}

export function moveRefBetweenBoards(
  lib: string,
  refId: string,
  from: string,
  to: string,
): void {
  removeRefFromBoard(lib, from, refId);
  addRefToBoard(lib, to, refId, {});
}

export function collectParentBriefs(
  lib: string,
  boardPath: string,
): ParentBriefEntry[] {
  const briefs: ParentBriefEntry[] = [];
  let current = parentBoardPath(boardPath);
  const chain: string[] = [];
  while (current) {
    chain.unshift(current);
    current = parentBoardPath(current);
  }
  for (const p of chain) {
    const path = boardYamlPath(lib, p);
    if (existsSync(path)) {
      const b = parseBoard(readFileSync(path, "utf8"));
      if (b.brief) briefs.push({ board: p, brief: b.brief });
    }
  }
  return briefs;
}
