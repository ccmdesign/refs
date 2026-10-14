import { createBoard } from "~~/core/board.ts";
import { rebuildBoardOutput } from "~~/core/output.ts";
import { assertBoardPath } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string }>(event);
  const path = body?.path;
  if (!path || typeof path !== "string") {
    throw createError({ statusCode: 400, statusMessage: "path is required" });
  }
  assertBoardPath(path);
  const lib = library();
  try {
    createBoard(lib, path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not create board";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
  await rebuildBoardOutput(lib, path);
  return { path };
});
