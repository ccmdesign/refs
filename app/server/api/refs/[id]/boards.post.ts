import { addRefToBoard } from "~~/core/board.ts";
import { rebuildBoardOutput } from "~~/core/output.ts";
import { getRef } from "~~/core/ref.ts";
import { assertBoardPath, assertRefId } from "../../../utils/validate.ts";
import { library } from "../../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  assertRefId(id);
  const body = await readBody<{ board?: string; note?: string; key?: boolean }>(event);
  if (!body?.board) {
    throw createError({ statusCode: 400, statusMessage: "board is required" });
  }
  assertBoardPath(body.board);
  const lib = library();
  try {
    getRef(lib, id);
    addRefToBoard(lib, body.board, id, { note: body.note, key: body.key });
    await rebuildBoardOutput(lib, body.board);
    return { id, board: body.board };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not add to board";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
});
