import { addFromBuffer, addFromUrl } from "~~/core/intake.ts";
import { kickTagger } from "~~/core/tagger.ts";
import { parseBoardQuery } from "../utils/validate.ts";
import { library } from "../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const lib = library();
  const contentType = getRequestHeader(event, "content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await readBody<{ url?: string; board?: string; note?: string; source?: string }>(
      event,
    );
    if (!body?.url) {
      throw createError({ statusCode: 400, statusMessage: "url is required" });
    }
    const board = body.board ? parseBoardQuery(body.board) : undefined;
    try {
      const result = await addFromUrl(lib, body.url, {
        board,
        note: body.note,
        source: body.source,
      });
      kickTagger(lib);
      return { results: [{ id: result.id, duplicate: result.duplicate, ref: result.ref }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add URL";
      throw createError({ statusCode: 400, statusMessage: msg });
    }
  }

  const form = await readMultipartFormData(event);
  if (!form?.length) {
    throw createError({ statusCode: 400, statusMessage: "No files uploaded" });
  }

  let board: string | undefined;
  let source: string | undefined;
  const results: { id: string; duplicate: boolean; ref: unknown }[] = [];

  for (const part of form) {
    if (part.name === "board" && part.data) {
      board = parseBoardQuery(part.data.toString("utf8"));
    } else if (part.name === "source" && part.data) {
      source = part.data.toString("utf8");
    } else if (part.name === "file" || part.filename) {
      const filename = part.filename ?? "upload.bin";
      const buf = part.data;
      if (!buf?.length) continue;
      try {
        const result = await addFromBuffer(lib, buf, filename, { board, source });
        results.push({ id: result.id, duplicate: result.duplicate, ref: result.ref });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not add file";
        throw createError({ statusCode: 400, statusMessage: msg });
      }
    }
  }

  if (!results.length) {
    throw createError({ statusCode: 400, statusMessage: "No files uploaded" });
  }

  kickTagger(lib);
  return { results };
});
