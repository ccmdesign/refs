import { setBoardBrief } from "~~/core/board.ts";
import { rebuildBoardOutput } from "~~/core/output.ts";
import { assertBoardPath } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string; brief?: string }>(event);
  const path = body?.path;
  if (!path) {
    throw createError({ statusCode: 400, statusMessage: "path is required" });
  }
  assertBoardPath(path);
  const brief = body?.brief ?? "";
  const lib = library();
  try {
    setBoardBrief(lib, path, brief);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not update brief";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
  await rebuildBoardOutput(lib, path);
  return { path, brief };
});
