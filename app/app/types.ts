import type { RefData } from "~~/core/types.ts";

export type BoardTreeNode = {
  path: string;
  name: string;
  count: number;
  children: BoardTreeNode[];
};

export type BoardsResponse = {
  tree: BoardTreeNode[];
  allCount: number;
  unsortedCount: number;
};

export type RefListItem = {
  ref: RefData;
  boards: string[];
  boardNote?: string;
  key?: boolean;
  /** Board in the viewed subtree this ref’s note/key come from (recursive board view). */
  viaBoard?: string;
};

export type RefsResponse = {
  refs: RefListItem[];
  count: number;
  brief?: string;
  pending: number;
};

export type ViewKind = "all" | "unsorted" | "board";
