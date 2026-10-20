import { createReadStream, existsSync, statSync } from "node:fs";
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
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
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
    throw createError({ statusCode: 404, statusMessage: "Not a file ref" });
  }
  const abs = join(lib, ref.file);
  if (!existsSync(abs)) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }
  const ext = ref.file.split(".").pop()?.toLowerCase() ?? "jpg";
  const size = statSync(abs).size;
  setHeader(event, "content-type", MIME[ext] ?? "application/octet-stream");
  setHeader(event, "accept-ranges", "bytes");

  // Browsers ask for byte ranges to play and seek video.
  const range = getRequestHeader(event, "range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      setHeader(event, "content-range", `bytes */${size}`);
      throw createError({ statusCode: 416, statusMessage: "Range not satisfiable" });
    }
    setResponseStatus(event, 206);
    setHeader(event, "content-range", `bytes ${start}-${end}/${size}`);
    setHeader(event, "content-length", end - start + 1);
    return sendStream(event, createReadStream(abs, { start, end }));
  }
  setHeader(event, "content-length", size);
  return sendStream(event, createReadStream(abs));
});
