import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
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

// Async, so making a poster in the server never blocks other requests.
function runAsync(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout ?? "") });
    });
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

export async function probeVideo(absPath: string): Promise<VideoInfo> {
  const res = await runAsync(tool("ffprobe"), [
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
  if (!res.ok) return {};
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

/**
 * Saves one frame, about a second in (earlier for short clips), as a JPEG.
 * Written to a temporary name first, so a half-written poster is never read.
 */
export async function makePoster(absVideo: string, absPoster: string, duration?: number): Promise<boolean> {
  mkdirSync(dirname(absPoster), { recursive: true });
  const tmp = absPoster.replace(/\.jpg$/, `.${process.pid}.${Date.now()}.tmp.jpg`);
  const at = duration ? Math.min(1, duration / 10) : 0;
  const attempt = (seek: number) =>
    runAsync(tool("ffmpeg"), [
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
      tmp,
    ]);
  let res = await attempt(at);
  if ((!res.ok || !existsSync(tmp)) && at > 0) res = await attempt(0);
  if (!res.ok || !existsSync(tmp)) {
    rmSync(tmp, { force: true });
    return false;
  }
  renameSync(tmp, absPoster);
  return true;
}

// One poster job per ref at a time, however many thumbnail sizes ask for it at once.
const inFlight = new Map<string, Promise<string | undefined>>();

/**
 * The poster for a video ref, made now if ffmpeg is available and it is missing.
 * Returns the absolute path, or undefined when there is none.
 */
export function ensurePoster(lib: string, ref: RefData): Promise<string | undefined> {
  if (!isVideoRef(ref) || !ref.file) return Promise.resolve(undefined);
  const key = join(lib, ref.id);
  const running = inFlight.get(key);
  if (running) return running;
  const job = makeMissingPoster(lib, ref).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function makeMissingPoster(lib: string, ref: RefData): Promise<string | undefined> {
  const rel = ref.poster ?? posterRelative(ref.file!);
  const abs = join(lib, rel);
  if (existsSync(abs)) {
    if (!ref.poster) setVideoMeta(lib, ref.id, { poster: rel });
    return abs;
  }
  const video = join(lib, ref.file!);
  if (!existsSync(video)) return undefined;
  const info = ref.duration || ref.width ? {} : await probeVideo(video);
  if (!(await makePoster(video, abs, ref.duration ?? info.duration))) return undefined;
  setVideoMeta(lib, ref.id, { poster: rel, ...info });
  return abs;
}

/** The still image for a ref: the file itself for images, the poster for videos. */
export async function stillImagePath(lib: string, ref: RefData): Promise<string | undefined> {
  if (!ref.file) return undefined;
  if (isVideoRef(ref)) return ensurePoster(lib, ref);
  const abs = join(lib, ref.file);
  return existsSync(abs) ? abs : undefined;
}
