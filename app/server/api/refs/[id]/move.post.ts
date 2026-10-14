import { moveRefBetweenBoards } from "~~/core/board.ts";
import { rebuildBoardOutput } from "~~/core/output.ts";
import { assertBoardPath, assertRefId } from "../../../utils/validate.ts";
import { library } from "../../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  assertRefId(id);
  const body = await readBody<{ from?: string; to?: string }>(event);
  if (!body?.from || !body?.to) {
    throw createError({ statusCode: 400, statusMessage: "from and to are required" });
  }
  assertBoardPath(body.from);
  assertBoardPath(body.to);
  const lib = library();
  try {
    moveRefBetweenBoards(lib, id, body.from, body.to);
    await rebuildBoardOutput(lib, body.from);
    await rebuildBoardOutput(lib, body.to);
    return { id, from: body.from, to: body.to };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not move ref";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
});
