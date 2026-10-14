import { deleteRef } from "~~/core/ref.ts";
import { assertRefId } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  assertRefId(id);
  const lib = library();
  try {
    await deleteRef(lib, id);
    return { deleted: id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not delete ref";
    throw createError({ statusCode: 404, statusMessage: msg });
  }
});
