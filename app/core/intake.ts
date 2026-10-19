import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import sharp from "sharp";
import {
  ensureLibraryDirs,
  imageStoragePath,
  imageStorageRelative,
  refIdFromBuffer,
  refIdFromString,
  refYamlPath,
} from "./paths.ts";
import { IMAGE_EXTENSIONS, type RefData } from "./types.ts";
import { extensionFromPath, isHttpUrl } from "./util.ts";
import { atomicWriteSync } from "./util.ts";
import { stringifyRef } from "./yaml.ts";
import { addRefToBoard } from "./board.ts";
import { rebuildBoardOutput } from "./output.ts";
import { assertVideoSize, ensurePoster, isVideoExtension, probeVideo } from "./video.ts";

export type AddResult = {
  id: string;
  duplicate: boolean;
  ref: RefData;
};

export type AddOptions = {
  board?: string;
  note?: string;
  boardNote?: string;
  key?: boolean;
  tags?: string[];
  source?: string;
  title?: string;
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Last URL path segment without extension, decoded; hostname if path is empty. */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      const decoded = decodeURIComponent(last);
      const dot = decoded.lastIndexOf(".");
      const base = dot > 0 ? decoded.slice(0, dot) : decoded;
      if (base) return base;
    }
    return u.hostname;
  } catch {
    return url;
  }
}

async function imageDimensions(
  buf: Buffer,
  ext: string,
): Promise<{ width: number; height: number }> {
  if (ext === "svg") {
    const text = buf.toString("utf8");
    const wm = text.match(/width=["']([^"']+)["']/i);
    const hm = text.match(/height=["']([^"']+)["']/i);
    const w = wm ? parseFloat(wm[1]) : 0;
    const h = hm ? parseFloat(hm[1]) : 0;
    return { width: w || 0, height: h || 0 };
  }
  const meta = await sharp(buf).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

function parseTagsCsv(tags?: string): string[] | undefined {
  if (!tags) return undefined;
  const list = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

type StoreMeta = { title: string; source?: string };

/** Stores an image or video by content hash and writes its ref file; an existing ref is reused. */
async function storeMedia(
  lib: string,
  buf: Buffer,
  ext: string,
  meta: StoreMeta,
  options: AddOptions,
): Promise<{ id: string; duplicate: boolean; ref: RefData }> {
  const video = isVideoExtension(ext);
  if (video) assertVideoSize(buf.length);
  const id = refIdFromBuffer(buf);
  const refPath = refYamlPath(lib, id);
  if (existsSync(refPath)) {
    const { readRefFile } = await import("./yaml.ts");
    return { id, duplicate: true, ref: readRefFile(refPath) };
  }
  const relFile = imageStorageRelative(id, ext);
  const absFile = imageStoragePath(lib, id, ext);
  await mkdir(dirname(absFile), { recursive: true });
  writeFileSync(absFile, buf);
  let ref: RefData = {
    id,
    file: relFile,
    title: meta.title,
    source: meta.source,
    note: options.note,
    tags: options.tags,
    added: todayDate(),
  };
  if (video) {
    const info = probeVideo(absFile);
    ref = { ...ref, kind: "video", width: info.width, height: info.height, duration: info.duration };
  } else {
    const dims = await imageDimensions(buf, ext);
    ref.width = dims.width || undefined;
    ref.height = dims.height || undefined;
  }
  if (!ref.source) delete ref.source;
  if (!ref.note) delete ref.note;
  atomicWriteSync(refPath, stringifyRef(ref));
  if (video) ensurePoster(lib, ref);
  const { readRefFile } = await import("./yaml.ts");
  return { id, duplicate: false, ref: readRefFile(refPath) };
}

async function placeOnBoard(lib: string, id: string, options: AddOptions): Promise<void> {
  if (!options.board) return;
  addRefToBoard(lib, options.board, id, {
    note: options.boardNote,
    key: options.key,
  });
  await rebuildBoardOutput(lib, options.board);
}

function assertSupportedFile(ext: string): void {
  if (!IMAGE_EXTENSIONS.has(ext) && !isVideoExtension(ext)) {
    throw new Error(
      `Unsupported file type: ${ext || "(none)"}. Use an image or a video (mp4, webm, mov, m4v).`,
    );
  }
}

export async function addFromBuffer(
  lib: string,
  buf: Buffer,
  filename: string,
  options: AddOptions = {},
): Promise<AddResult> {
  ensureLibraryDirs(lib);
  const ext = extensionFromPath(filename);
  assertSupportedFile(ext);
  const result = await storeMedia(
    lib,
    buf,
    ext,
    { title: options.title || basename(filename, extname(filename)), source: options.source },
    options,
  );
  await placeOnBoard(lib, result.id, options);
  return result;
}

export async function addFromFile(
  lib: string,
  filePath: string,
  options: AddOptions = {},
): Promise<AddResult> {
  ensureLibraryDirs(lib);
  const ext = extensionFromPath(filePath);
  assertSupportedFile(ext);
  // Check the size before reading a large video into memory.
  if (isVideoExtension(ext)) assertVideoSize(statSync(filePath).size);
  const buf = readFileSync(filePath);
  const result = await storeMedia(
    lib,
    buf,
    ext,
    { title: options.title || basename(filePath, extname(filePath)), source: options.source },
    options,
  );
  await placeOnBoard(lib, result.id, options);
  return result;
}

function contentTypeIsImage(ct: string | null): boolean {
  if (!ct) return false;
  return ct.split(";")[0].trim().toLowerCase().startsWith("image/");
}

export async function addFromUrl(
  lib: string,
  url: string,
  options: AddOptions = {},
): Promise<AddResult> {
  ensureLibraryDirs(lib);
  if (!isHttpUrl(url)) throw new Error(`Invalid URL: ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);

  const ct = res.headers.get("content-type");
  const length = Number(res.headers.get("content-length"));
  if (videoExtFromContentType(ct) && length > 0) assertVideoSize(length);
  const buf = Buffer.from(await res.arrayBuffer());

  const videoExt = videoExtFromContentType(ct);
  if (videoExt) {
    const result = await storeMedia(
      lib,
      buf,
      videoExt,
      { title: options.title ?? titleFromUrl(url), source: options.source ?? url },
      options,
    );
    await placeOnBoard(lib, result.id, options);
    return result;
  }

  if (contentTypeIsImage(ct) || looksLikeImage(buf)) {
    const ext = extFromContentType(ct) || extFromBuffer(buf) || "jpg";
    if (!IMAGE_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported image type from URL: ${ext}`);
    }
    const result = await storeMedia(
      lib,
      buf,
      ext,
      { title: options.title ?? titleFromUrl(url), source: options.source ?? url },
      options,
    );
    await placeOnBoard(lib, result.id, options);
    return result;
  }

  const id = refIdFromString(url);
  const refPath = refYamlPath(lib, id);
  let duplicate = false;
  let ref: RefData;

  if (existsSync(refPath)) {
    duplicate = true;
    const { readRefFile } = await import("./yaml.ts");
    ref = readRefFile(refPath);
  } else {
    ref = {
      id,
      url,
      title: options.title ?? titleFromUrl(url),
      source: options.source,
      note: options.note,
      tags: options.tags,
      added: todayDate(),
    };
    if (!ref.source) delete ref.source;
    atomicWriteSync(refPath, stringifyRef(ref));
  }

  if (options.board) {
    addRefToBoard(lib, options.board, id, {
      note: options.boardNote,
      key: options.key,
    });
    await rebuildBoardOutput(lib, options.board);
  }

  return { id, duplicate, ref };
}

function videoExtFromContentType(ct: string | null): string | null {
  if (!ct) return null;
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-m4v": "m4v",
  };
  return map[ct.split(";")[0].trim().toLowerCase()] ?? null;
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49) return true;
  if (buf.slice(0, 4).toString() === "RIFF") return true;
  const start = buf.slice(0, 200).toString("utf8");
  if (start.includes("<svg")) return true;
  return false;
}

function extFromContentType(ct: string | null): string | null {
  if (!ct) return null;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
  };
  return map[ct.split(";")[0].trim().toLowerCase()] ?? null;
}

function extFromBuffer(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "gif";
  if (buf.slice(0, 4).toString() === "RIFF") return "webp";
  if (buf.slice(0, 100).toString("utf8").includes("<svg")) return "svg";
  return null;
}

export async function addInput(
  lib: string,
  input: string,
  options: AddOptions = {},
): Promise<AddResult> {
  const tagList = options.tags;
  if (typeof tagList === "string") {
    options = { ...options, tags: parseTagsCsv(tagList as string) };
  }
  if (isHttpUrl(input)) return addFromUrl(lib, input, options);
  return addFromFile(lib, input, options);
}
