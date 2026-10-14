import { getBoard, listBoards } from "~~/core/board.ts";
import { listUnsortedRefIds } from "~~/core/ref.ts";
import { listAllRefIds } from "~~/core/ref.ts";

export type BoardTreeNode = {
  path: string;
  name: string;
  count: number;
  children: BoardTreeNode[];
};

export function boardsContainingRef(lib: string, refId: string): string[] {
  return listBoards(lib).filter((path) => {
    try {
      const board = getBoard(lib, path);
      return board.refs.some((r) => r.id === refId);
    } catch {
      return false;
    }
  });
}

export function refCountOnBoard(lib: string, boardPath: string): number {
  try {
    return getBoard(lib, boardPath).refs.length;
  } catch {
    return 0;
  }
}

export function buildBoardTree(lib: string): BoardTreeNode[] {
  const paths = listBoards(lib);
  const nodes = new Map<string, BoardTreeNode>();

  for (const path of paths) {
    const segments = path.split("/");
    const name = segments[segments.length - 1]!;
    nodes.set(path, {
      path,
      name,
      count: refCountOnBoard(lib, path),
      children: [],
    });
  }

  const roots: BoardTreeNode[] = [];
  for (const path of paths) {
    const node = nodes.get(path)!;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
    if (parentPath && nodes.has(parentPath)) {
      nodes.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (list: BoardTreeNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of list) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

export function boardTreePayload(lib: string) {
  return {
    tree: buildBoardTree(lib),
    allCount: listAllRefIds(lib).length,
    unsortedCount: listUnsortedRefIds(lib).length,
  };
}
