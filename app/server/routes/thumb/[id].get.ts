import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { getRef } from "~~/core/ref.ts";
import { stillImagePath } from "~~/core/video.ts";
import { assertRefId } from "../../utils/validate.ts";
import { library } from "../../utils/lib.ts";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  assertRefId(id);
  const query = getQuery(event);
  const wRaw = query.w ? Number(query.w) : 320;
  const w = Number.isFinite(wRaw) && wRaw > 0 ? Math.min(2048, Math.round(wRaw)) : 320;

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
  // For a video this is its poster frame, made now if it is missing and ffmpeg is there.
  const abs = await stillImagePath(lib, ref);
  if (!abs) {
    throw createError({ statusCode: 404, statusMessage: "No still image" });
  }

  const ext = abs.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "svg" || ext === "gif") {
    const mime = ext === "svg" ? "image/svg+xml" : "image/gif";
    setHeader(event, "content-type", mime);
    return sendStream(event, createReadStream(abs));
  }

  const cacheDir = join(lib, ".cache", "thumbs");
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, `${id}-${w}.webp`);

  if (!existsSync(cachePath)) {
    const buf = await sharp(abs)
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    writeFileSync(cachePath, buf);
  }

  setHeader(event, "content-type", "image/webp");
  return sendStream(event, createReadStream(cachePath));
});
