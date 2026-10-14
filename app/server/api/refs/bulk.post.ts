import { addRefToBoard, getBoard, removeRefFromBoard } from "~~/core/board.ts";
import { rebuildBoardOutput } from "~~/core/output.ts";
import { getRef } from "~~/core/ref.ts";
import { assertBoardPath, assertRefId } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

type BulkBody = {
  action?: "move" | "add" | "remove";
  to?: string;
  items?: { id: string; from?: string }[];
};

// move: onto `to` and off each item's `from`, keeping its board note and key flag.
// add: onto `to`, staying where it is. remove: off each item's `from`.
export default defineEventHandler(async (event) => {
  const body = await readBody<BulkBody>(event);
  const action = body?.action;
  const items = body?.items ?? [];
  if (action !== "move" && action !== "add" && action !== "remove") {
    throw createError({ statusCode: 400, statusMessage: "action must be move, add or remove" });
  }
  if (!items.length) throw createError({ statusCode: 400, statusMessage: "items is required" });
  if (action !== "remove") {
    if (!body?.to) throw createError({ statusCode: 400, statusMessage: "to is required" });
    assertBoardPath(body.to);
  }
  for (const item of items) {
    assertRefId(item.id);
    if (item.from) assertBoardPath(item.from);
    if (action === "remove" && !item.from) {
      throw createError({ statusCode: 400, statusMessage: "from is required to remove" });
    }
  }

  const lib = library();
  const to = body!.to;
  const touched = new Set<string>();
  try {
    if (to) getBoard(lib, to);
    for (const { id, from } of items) {
      getRef(lib, id);
      if (to) {
        const entry = from ? getBoard(lib, from).refs.find((r) => r.id === id) : undefined;
        const onTarget = getBoard(lib, to).refs.some((r) => r.id === id);
        // Never overwrite a note already on the target board.
        addRefToBoard(lib, to, id, onTarget ? {} : { note: entry?.note, key: entry?.key });
        touched.add(to);
      }
      if (action !== "add" && from && from !== to) {
        removeRefFromBoard(lib, from, id);
        touched.add(from);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bulk change failed";
    throw createError({ statusCode: 400, statusMessage: msg });
  } finally {
    for (const board of touched) await rebuildBoardOutput(lib, board);
  }
  return { count: items.length, boards: [...touched] };
});
