import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getBoard } from "~~/core/board.ts";
import { listRefs } from "~~/core/ref.ts";
import { pendingTagCount } from "~~/core/tagger.ts";
import type { BoardData, RefData } from "~~/core/types.ts";
import { readBoardFile } from "~~/core/yaml.ts";
import { boardsContainingRef } from "../../utils/boards.ts";
import { library } from "../../utils/lib.ts";
import { parseBoardQuery } from "../../utils/validate.ts";

function depthUnderRoot(root: string, boardPath: string): number {
  if (boardPath === root) return 0;
  const prefix = `${root}/`;
  if (!boardPath.startsWith(prefix)) return Number.POSITIVE_INFINITY;
  return boardPath.slice(prefix.length).split("/").length;
}

function boardRefEntriesInSubtree(
  lib: string,
  rootBoard: string,
): Map<string, { note?: string; key?: boolean; viaBoard: string }> {
  const boardsDir = join(lib, "boards");
  const map = new Map<string, { note?: string; key?: boolean; viaBoard: string; depth: number }>();
  if (!existsSync(boardsDir)) return new Map();

  function walk(rel: string): void {
    const full = rel ? join(boardsDir, rel) : boardsDir;
    for (const ent of readdirSync(full, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        walk(rel ? `${rel}/${ent.name}` : ent.name);
      } else if (ent.name.endsWith(".yaml") && !ent.name.endsWith(".yaml.lock")) {
        const boardPath = rel
          ? `${rel}/${ent.name.replace(/\.yaml$/, "")}`
          : ent.name.replace(/\.yaml$/, "");
        if (boardPath !== rootBoard && !boardPath.startsWith(`${rootBoard}/`)) continue;
        const depth = depthUnderRoot(rootBoard, boardPath);
        const board = readBoardFile(join(full, ent.name)) as BoardData;
        for (const entry of board.refs) {
          const prev = map.get(entry.id);
          if (!prev || depth < prev.depth) {
            map.set(entry.id, {
              note: entry.note,
              key: entry.key,
              viaBoard: boardPath,
              depth,
            });
          }
        }
      }
    }
  }
  walk("");

  const out = new Map<string, { note?: string; key?: boolean; viaBoard: string }>();
  for (const [id, { note, key, viaBoard }] of map) {
    out.set(id, { note, key, viaBoard });
  }
  return out;
}

function refTags(ref: RefData): string[] {
  const human = ref.tags ?? [];
  const machine = ref.auto?.tags ?? [];
  return [...human, ...machine];
}

function matchesAllTags(ref: RefData, tags: string[]): boolean {
  if (!tags.length) return true;
  const lower = refTags(ref).map((t) => t.toLowerCase());
  return tags.every((t) => lower.includes(t.toLowerCase()));
}

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const lib = library();
  const board = parseBoardQuery(query.board);
  const unsorted = query.unsorted === "true" || query.unsorted === "1";
  const recursive = query.recursive === "true" || query.recursive === "1";

  const tagParam = query.tag;
  const tagFilters: string[] = [];
  if (Array.isArray(tagParam)) {
    tagFilters.push(...tagParam.map(String));
  } else if (tagParam) {
    tagFilters.push(
      ...String(tagParam)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    );
  }

  let refs = listRefs(lib, {
    board,
    includeSubBoards: board ? recursive : false,
    unsorted: unsorted || undefined,
  });

  if (tagFilters.length) {
    refs = refs.filter((r) => matchesAllTags(r, tagFilters));
  }

  const boardPath = board;
  let brief: string | undefined;
  const entryMap = new Map<string, { note?: string; key?: boolean; viaBoard?: string }>();
  if (boardPath) {
    try {
      const boardData = getBoard(lib, boardPath);
      brief = boardData.brief;
      if (recursive) {
        const subtree = boardRefEntriesInSubtree(lib, boardPath);
        for (const [id, entry] of subtree) entryMap.set(id, entry);
      } else {
        for (const entry of boardData.refs) {
          entryMap.set(entry.id, { note: entry.note, key: entry.key, viaBoard: boardPath });
        }
      }
    } catch {
      throw createError({ statusCode: 404, statusMessage: "Board not found" });
    }
  }

  const items = refs.map((ref) => {
    const onBoard = entryMap.get(ref.id);
    const viaBoard =
      onBoard?.viaBoard && onBoard.viaBoard !== boardPath ? onBoard.viaBoard : undefined;
    return {
      ref,
      boards: boardsContainingRef(lib, ref.id),
      boardNote: onBoard?.note,
      key: onBoard?.key,
      viaBoard,
    };
  });

  return {
    refs: items,
    count: items.length,
    brief,
    pending: pendingTagCount(lib),
  };
});
