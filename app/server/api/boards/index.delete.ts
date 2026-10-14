import { deleteBoard } from "~~/core/board.ts";
import { assertBoardPath } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const path = query.path as string | undefined;
  if (!path) {
    throw createError({ statusCode: 400, statusMessage: "path is required" });
  }
  assertBoardPath(path);
  const lib = library();
  try {
    deleteBoard(lib, path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not delete board";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
  return { path };
});
