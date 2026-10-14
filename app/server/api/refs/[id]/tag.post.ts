import { tagRef } from "~~/core/tagger.ts";
import { assertRefId } from "../../../utils/validate.ts";
import { library } from "../../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  assertRefId(id);
  const lib = library();
  try {
    const ref = await tagRef(lib, id);
    return { ref };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not tag ref";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
});
