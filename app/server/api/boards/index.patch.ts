import { renameBoard } from "~~/core/board.ts";
import { rebuildAllOutput } from "~~/core/output.ts";
import { assertBoardPath } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ from?: string; to?: string }>(event);
  const from = body?.from;
  const to = body?.to;
  if (!from || !to) {
    throw createError({ statusCode: 400, statusMessage: "from and to are required" });
  }
  assertBoardPath(from);
  assertBoardPath(to);
  const lib = library();
  try {
    renameBoard(lib, from, to);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not rename board";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
  await rebuildAllOutput(lib);
  return { from, to };
});
