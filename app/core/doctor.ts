import { createServer } from "node:net";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { configPath, loadConfig } from "./config.ts";
import {
  probeOutputMethod,
  type OutputMethod,
} from "./output.ts";
import { checkTagger } from "./tagger.ts";
import { checkFfmpeg } from "./video.ts";

export type Check = {
  id: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
};

export type DoctorOpts = {
  port?: number;
  probeOutputMethod?: (lib: string) => OutputMethod;
};

function parseNodeParts(v: string): [number, number, number] {
  const [major, minor, patch] = v.split(".").map((n) => Number(n) || 0);
  return [major, minor, patch];
}

function nodeVersionOk(v: string): boolean {
  const [major, minor] = parseNodeParts(v);
  if (major > 22) return true;
  if (major < 22) return false;
  return minor >= 18;
}

function methodLabel(method: OutputMethod): string {
  if (method === "symlink") return "symlinks";
  if (method === "hardlink") return "hard links";
  return "copies";
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(false);
      else resolve(true);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function refsOnPort(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/boards`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { tree?: unknown };
    return Array.isArray(data.tree);
  } catch {
    return false;
  }
}

export async function runDoctor(
  lib: string,
  opts?: DoctorOpts,
): Promise<Check[]> {
  const checks: Check[] = [];

  const nodeVer = process.versions.node;
  if (nodeVersionOk(nodeVer)) {
    checks.push({ id: "node", status: "ok", detail: nodeVer });
  } else {
    checks.push({
      id: "node",
      status: "fail",
      detail: nodeVer,
      fix: `Install Node.js 22.18 or newer from https://nodejs.org (current: ${nodeVer})`,
    });
  }

  try {
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .resize(1, 1)
      .toBuffer();
    checks.push({ id: "sharp", status: "ok", detail: "loaded" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      id: "sharp",
      status: "fail",
      detail: msg,
      fix:
        "Run pnpm install (on Linux, install libvips if sharp fails to load native binaries).",
    });
  }

  try {
    const cacheDir = join(lib, ".cache");
    const probeFile = join(cacheDir, "doctor-write-test");
    writeFileSync(probeFile, "ok", "utf8");
    unlinkSync(probeFile);
    checks.push({ id: "library", status: "ok", detail: lib });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      id: "library",
      status: "fail",
      detail: msg,
      fix: "pnpm refs setup",
    });
  }

  const cfgFile = configPath(lib);
  if (!existsSync(cfgFile)) {
    checks.push({
      id: "config",
      status: "warn",
      detail: "config.yaml is missing",
      fix: "pnpm refs setup",
    });
  } else {
    try {
      loadConfig(lib);
      checks.push({ id: "config", status: "ok", detail: "config.yaml" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ id: "config", status: "fail", detail: msg });
    }
  }

  try {
    const mode = loadConfig(lib).output.mode;
    const probe = opts?.probeOutputMethod ?? probeOutputMethod;
    const method = probe(lib);
    if (mode === "links") {
      if (method !== "symlink") {
        checks.push({
          id: "output",
          status: "fail",
          detail: `output.mode is links but ${methodLabel(method)} are used`,
          fix: "set output.mode: auto in config.yaml",
        });
      } else {
        checks.push({ id: "output", status: "ok", detail: "links (symlinks)" });
      }
    } else if (mode === "auto") {
      checks.push({
        id: "output",
        status: "ok",
        detail: `auto (${methodLabel(method)})`,
      });
    } else {
      checks.push({ id: "output", status: "ok", detail: "copies" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ id: "output", status: "fail", detail: msg });
  }

  try {
    const taggerResult = await checkTagger(lib);
    if (taggerResult.adapter === "none") {
      checks.push({
        id: "tagger",
        status: "ok",
        detail: "off",
        fix: "pnpm refs setup to see tagging options",
      });
    } else if (taggerResult.ok) {
      checks.push({
        id: "tagger",
        status: "ok",
        detail: taggerResult.detail,
      });
    } else {
      checks.push({
        id: "tagger",
        status: "warn",
        detail: taggerResult.detail,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ id: "tagger", status: "warn", detail: msg });
  }

  const ffmpeg = checkFfmpeg();
  checks.push(
    ffmpeg.ok
      ? { id: "ffmpeg", status: "ok", detail: ffmpeg.detail }
      : {
          id: "ffmpeg",
          status: "warn",
          detail: `${ffmpeg.detail}: videos get no poster frame and are not tagged`,
          fix: "Optional: install ffmpeg (https://ffmpeg.org/download.html), which includes ffprobe",
        },
  );

  const port =
    opts?.port ?? (Number(process.env.REFS_PORT) || 3210);
  const free = await portFree(port);
  if (free) {
    checks.push({ id: "port", status: "ok", detail: String(port) });
  } else {
    const isRefs = await refsOnPort(port);
    if (isRefs) {
      checks.push({
        id: "port",
        status: "ok",
        detail: "refs is already running here",
      });
    } else {
      checks.push({
        id: "port",
        status: "warn",
        detail: `port ${port} is used by another program`,
        fix: "set REFS_PORT to a free port",
      });
    }
  }

  return checks;
}

export function doctorFailed(checks: Check[]): boolean {
  return checks.some((c) => c.status === "fail");
}
