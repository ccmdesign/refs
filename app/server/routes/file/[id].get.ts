import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { getRef } from "~~/core/ref.ts";
import { assertRefId } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  assertRefId(id);
  const lib = library();
  let ref;
  try {
    ref = getRef(lib, id);
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Ref not found" });
  }
  if (!ref.file) {
    throw createError({ statusCode: 404, statusMessage: "Not an image ref" });
  }
  const abs = join(lib, ref.file);
  if (!existsSync(abs)) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }
  const ext = ref.file.split(".").pop()?.toLowerCase() ?? "jpg";
  setHeader(event, "content-type", MIME[ext] ?? "application/octet-stream");
  return sendStream(event, createReadStream(abs));
});
