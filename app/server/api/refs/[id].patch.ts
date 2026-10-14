import { updateRef } from "~~/core/ref.ts";
import { assertRefId } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";
import { rebuildBoardsForRef } from "../../utils/rebuild.ts";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  assertRefId(id);
  const body = await readBody<{
    title?: string;
    source?: string;
    note?: string;
    tags?: string[] | string;
  }>(event);
  const lib = library();
  let tags: string[] | undefined;
  if (body.tags !== undefined) {
    if (Array.isArray(body.tags)) {
      tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
    } else {
      tags = String(body.tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  try {
    const ref = updateRef(lib, id, {
      title: body.title,
      source: body.source,
      note: body.note,
      tags,
    });
    if (body.title !== undefined) {
      await rebuildBoardsForRef(lib, id);
    }
    return { ref };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not update ref";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
});
