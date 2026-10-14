import { rebuildBoardOutput } from "~~/core/output.ts";
import { boardsContainingRef } from "./boards.ts";

export async function rebuildBoardsForRef(lib: string, refId: string): Promise<void> {
  for (const board of boardsContainingRef(lib, refId)) {
    await rebuildBoardOutput(lib, board);
  }
}
