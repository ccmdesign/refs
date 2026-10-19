import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RefData } from "./types.ts";
import { VIDEO_EXTENSIONS } from "./types.ts";
import { setVideoMeta } from "./ref.ts";

// ffmpeg and ffprobe are optional. Without them a video is stored and plays,
// but has no size, no duration and no poster frame, so it is not tagged.

const DEFAULT_MAX_VIDEO_MB = 200;

export function maxVideoBytes(): number {
  const mb = Number(process.env.REFS_MAX_VIDEO_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_VIDEO_MB) * 1024 * 1024;
}

export function isVideoExtension(ext: string): boolean {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase());
}

export function isVideoRef(ref: RefData): boolean {
  return ref.kind === "video";
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Throws when a video is over the size cap. */
export function assertVideoSize(bytes: number): void {
  const max = maxVideoBytes();
  if (bytes > max) {
    throw new Error(`Video is ${formatMb(bytes)}; the limit is ${formatMb(max)}`);
  }
}

function tool(name: "ffmpeg" | "ffprobe"): string {
  return (name === "ffmpeg" ? process.env.REFS_FFMPEG : process.env.REFS_FFPROBE) || name;
}

function run(cmd: string, args: string[]) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
}

export type FfmpegCheck = { ok: boolean; detail: string };

export function checkFfmpeg(): FfmpegCheck {
  const res = run(tool("ffmpeg"), ["-version"]);
  if (res.error || res.status !== 0) return { ok: false, detail: "not found on PATH" };
  const first = (res.stdout || "").split("\n")[0] ?? "";
  const version = first.match(/ffmpeg version (\S+)/)?.[1];
  const probe = run(tool("ffprobe"), ["-version"]);
  if (probe.error || probe.status !== 0) {
    return { ok: false, detail: `ffmpeg ${version ?? ""} found, ffprobe not found`.replace("  ", " ") };
  }
  return { ok: true, detail: version ? `ffmpeg ${version}` : "ffmpeg found" };
}

export type VideoInfo = { width?: number; height?: number; duration?: number };

export function probeVideo(absPath: string): VideoInfo {
  const res = run(tool("ffprobe"), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    absPath,
  ]);
  if (res.error || res.status !== 0) return {};
  try {
    const data = JSON.parse(res.stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const s = data.streams?.[0] ?? {};
    const d = Number(data.format?.duration);
    return {
      width: s.width || undefined,
      height: s.height || undefined,
      duration: Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : undefined,
    };
  } catch {
    return {};
  }
}

export function posterRelative(videoRel: string): string {
  return videoRel.replace(/\.[^./]+$/, ".poster.jpg");
}

/** Saves one frame, about a second in (earlier for short clips), as a JPEG. */
export function makePoster(absVideo: string, absPoster: string, duration?: number): boolean {
  mkdirSync(dirname(absPoster), { recursive: true });
  const at = duration ? Math.min(1, duration / 10) : 0;
  const attempt = (seek: number) =>
    run(tool("ffmpeg"), [
      "-v",
      "error",
      "-y",
      "-ss",
      String(seek),
      "-i",
      absVideo,
      "-frames:v",
      "1",
      "-vf",
      "scale='min(1600,iw)':-2",
      "-q:v",
      "3",
      absPoster,
    ]);
  let res = attempt(at);
  if ((res.error || res.status !== 0 || !existsSync(absPoster)) && at > 0) res = attempt(0);
  return !res.error && res.status === 0 && existsSync(absPoster);
}

/**
 * The poster for a video ref, made now if ffmpeg is available and it is missing.
 * Returns the absolute path, or undefined when there is none.
 */
export function ensurePoster(lib: string, ref: RefData): string | undefined {
  if (!isVideoRef(ref) || !ref.file) return undefined;
  const rel = ref.poster ?? posterRelative(ref.file);
  const abs = join(lib, rel);
  if (existsSync(abs)) {
    if (!ref.poster) setVideoMeta(lib, ref.id, { poster: rel });
    return abs;
  }
  const video = join(lib, ref.file);
  if (!existsSync(video)) return undefined;
  const info = ref.duration || ref.width ? {} : probeVideo(video);
  if (!makePoster(video, abs, ref.duration ?? info.duration)) return undefined;
  setVideoMeta(lib, ref.id, { poster: rel, ...info });
  return abs;
}

/** The still image for a ref: the file itself for images, the poster for videos. */
export function stillImagePath(lib: string, ref: RefData): string | undefined {
  if (!ref.file) return undefined;
  if (isVideoRef(ref)) return ensurePoster(lib, ref);
  const abs = join(lib, ref.file);
  return existsSync(abs) ? abs : undefined;
}
