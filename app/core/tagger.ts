import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig, type TaggerConfig } from "./config.ts";
import { getBoard, listBoards } from "./board.ts";
import { appDir, ensureLibraryDirs, getLibraryPath } from "./paths.ts";
import { getRef, listAllRefs, updateRef } from "./ref.ts";
import type { RefData } from "./types.ts";
import { rebuildBoardOutput } from "./output.ts";
import { atomicWriteSync } from "./util.ts";
import { createAdapter, type TaggerAdapter, type TaggerCheck } from "./tagger/adapters/index.ts";
import { noneAdapterOffMessage } from "./tagger/adapters/none.ts";
import { prepareFileJpeg, prepareTaggerJpeg } from "./tagger/image.ts";
import { parseTaggerResponse } from "./tagger/parse.ts";
import { buildTagPrompt, readVocabulary } from "./tagger/vocabulary.ts";
import { checkFfmpeg, isVideoRef, stillImagePath } from "./video.ts";
const LOCK_STALE_MS = 2 * 60 * 1000;

let injectedAdapter: TaggerAdapter | null = null;
const workerFailedIds = new Set<string>();

export function setTaggerAdapterForTests(adapter: TaggerAdapter | null): void {
  injectedAdapter = adapter;
}

export function resetTaggerWorkerStateForTests(): void {
  workerFailedIds.clear();
}

function taggerEnabled(lib: string): boolean {
  if (injectedAdapter) return true;
  return loadConfig(lib).tagger.adapter !== "none";
}

function taggerLockPath(lib: string): string {
  return join(lib, ".cache", "tagger.lock");
}

function failuresPath(lib: string): string {
  return join(lib, ".cache", "tagger-failures.json");
}

function readFailures(lib: string): Record<string, string> {
  const path = failuresPath(lib);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeFailures(lib: string, failures: Record<string, string>): void {
  const path = failuresPath(lib);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteSync(path, JSON.stringify(failures, null, 2));
}

function ensureCacheDir(lib: string): void {
  mkdirSync(join(lib, ".cache"), { recursive: true });
}

function recordFailure(lib: string, id: string, message: string): void {
  const failures = readFailures(lib);
  failures[id] = message;
  writeFailures(lib, failures);
  workerFailedIds.add(id);
}

function clearFailure(lib: string, id: string): void {
  const failures = readFailures(lib);
  if (!failures[id]) return;
  delete failures[id];
  writeFailures(lib, failures);
  workerFailedIds.delete(id);
}

function lockIsLive(lib: string): boolean {
  const path = taggerLockPath(lib);
  if (!existsSync(path)) return false;
  try {
    const ts = Number(readFileSync(path, "utf8").trim());
    return !Number.isNaN(ts) && Date.now() - ts < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function touchLock(lib: string): void {
  const path = taggerLockPath(lib);
  ensureCacheDir(lib);
  atomicWriteSync(path, String(Date.now()));
}

function releaseLock(lib: string): void {
  try {
    unlinkSync(taggerLockPath(lib));
  } catch {
    /* ignore */
  }
}

function refHasLocalImage(lib: string, ref: RefData): boolean {
  if (!ref.file) return false;
  if (isVideoRef(ref)) {
    // A video is tagged from its poster frame; without ffmpeg there is none.
    if (ref.poster && existsSync(join(lib, ref.poster))) return true;
    return ffmpegAvailable();
  }
  return existsSync(join(lib, ref.file));
}

let ffmpegCache: { at: number; ok: boolean } | undefined;
function ffmpegAvailable(): boolean {
  if (!ffmpegCache || Date.now() - ffmpegCache.at > 60_000) {
    ffmpegCache = { at: Date.now(), ok: checkFfmpeg().ok };
  }
  return ffmpegCache.ok;
}

function isUntaggedCandidate(
  lib: string,
  ref: RefData,
  failures: Record<string, string>,
): boolean {
  if (!refHasLocalImage(lib, ref)) return false;
  if (ref.auto) return false;
  if (failures[ref.id]) return false;
  if (workerFailedIds.has(ref.id)) return false;
  return true;
}

function findNextUntaggedId(lib: string): string | null {
  const failures = readFailures(lib);
  for (const ref of listAllRefs(lib)) {
    if (isUntaggedCandidate(lib, ref, failures)) return ref.id;
  }
  return null;
}

async function rebuildBoardsForRef(lib: string, id: string): Promise<void> {
  for (const boardPath of listBoards(lib)) {
    const board = getBoard(lib, boardPath);
    if (board.refs.some((r) => r.id === id)) {
      await rebuildBoardOutput(lib, boardPath);
    }
  }
}

async function resolveAdapter(lib: string): Promise<{ adapter: TaggerAdapter; cfg: TaggerConfig }> {
  if (injectedAdapter) {
    return { adapter: injectedAdapter, cfg: loadConfig(lib).tagger };
  }
  const cfg = loadConfig(lib);
  if (cfg.tagger.adapter === "none") {
    throw new Error(noneAdapterOffMessage);
  }
  const adapter = await createAdapter(cfg.tagger, lib);
  return { adapter, cfg: cfg.tagger };
}

async function tagRefCore(
  lib: string,
  id: string,
  shared?: { adapter: TaggerAdapter; cfg: TaggerConfig },
): Promise<RefData> {
  const { adapter, cfg } = shared ?? await resolveAdapter(lib);
  ensureLibraryDirs(lib);
  const ref = getRef(lib, id);
  if (!ref.file) {
    throw new Error(`Ref ${id} has no local image file`);
  }
  const imagePath = await stillImagePath(lib, ref);
  if (!imagePath) {
    throw new Error(
      isVideoRef(ref)
        ? `No poster frame for video ref ${id}; install ffmpeg to tag videos`
        : `Image file missing for ref ${id}`,
    );
  }

  const vocabulary = readVocabulary(lib);
  const prompt = buildTagPrompt(vocabulary, { videoFrame: isVideoRef(ref) });
  const jpegPath = await prepareTaggerJpeg(lib, id, imagePath);
  const model = cfg.model;
  const raw = await adapter.describe({ prompt, imagePath: jpegPath, model });
  const parsed = parseTaggerResponse(raw);
  const storedModel = cfg.model ?? adapter.id;
  clearFailure(lib, id);
  updateRef(lib, id, {
    auto: {
      tags: parsed.tags,
      description: parsed.description,
      model: storedModel,
      at: new Date().toISOString(),
    },
  });
  await rebuildBoardsForRef(lib, id);
  return getRef(lib, id);
}

export async function tagRef(lib: string, id: string): Promise<RefData> {
  return tagRefCore(lib, id);
}

export function pendingTagCount(lib: string): number {
  if (!taggerEnabled(lib)) return 0;
  const failures = readFailures(lib);
  let count = 0;
  for (const ref of listAllRefs(lib)) {
    if (isUntaggedCandidate(lib, ref, failures)) count++;
  }
  return count;
}

export function kickTagger(lib: string): void {
  if (!taggerEnabled(lib)) return;
  ensureLibraryDirs(lib);
  const child = spawn(
    process.execPath,
    [join(appDir(), "bin", "refs.ts"), "tag", "--worker"],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, REFS_LIBRARY: lib },
    },
  );
  child.unref();
}

export async function runTagWorker(lib: string): Promise<void> {
  if (!taggerEnabled(lib)) return;
  ensureLibraryDirs(lib);
  if (lockIsLive(lib)) return;

  touchLock(lib);
  let shared: { adapter: TaggerAdapter; cfg: TaggerConfig } | undefined;
  try {
    shared = await resolveAdapter(lib);
  } catch {
    releaseLock(lib);
    return;
  }
  try {
    for (;;) {
      const id = findNextUntaggedId(lib);
      if (!id) break;
      touchLock(lib);
      try {
        await tagRefCore(lib, id, shared);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        recordFailure(lib, id, msg);
      }
    }
  } finally {
    workerFailedIds.clear();
    releaseLock(lib);
  }
}

export async function checkTagger(
  lib: string,
): Promise<TaggerCheck & { adapter: string }> {
  const cfg = loadConfig(lib);
  const adapter = await createAdapter(cfg.tagger, lib);
  const result = await adapter.check();
  return { ...result, adapter: cfg.tagger.adapter };
}

export type CompareRow = {
  file: string;
  modelA: string;
  modelB: string;
  secondsA: number;
  secondsB: number;
  tagsA: string[];
  tagsB: string[];
  descriptionA: string;
  descriptionB: string;
};

export async function compareTagFiles(
  modelA: string,
  modelB: string,
  files: string[],
): Promise<CompareRow[]> {
  const lib = getLibraryPath();
  const { adapter } = await resolveAdapter(lib);

  const cacheDir = join(tmpdir(), `refs-tag-compare-${process.pid}`);
  await mkdir(join(cacheDir, "tagger"), { recursive: true });
  const vocabulary: string[] = [];
  const prompt = buildTagPrompt(vocabulary);

  const rows: CompareRow[] = [];
  for (const file of files) {
    const abs = resolve(file);
    const id = `compare-${rows.length}`;
    const jpegPath = join(cacheDir, "tagger", `${id}.jpg`);
    await prepareFileJpeg(abs, jpegPath);

    const t0 = performance.now();
    const rawA = await adapter.describe({ prompt, imagePath: jpegPath, model: modelA });
    const secondsA = (performance.now() - t0) / 1000;
    const parsedA = parseTaggerResponse(rawA);

    const t1 = performance.now();
    const rawB = await adapter.describe({ prompt, imagePath: jpegPath, model: modelB });
    const secondsB = (performance.now() - t1) / 1000;
    const parsedB = parseTaggerResponse(rawB);

    rows.push({
      file: abs,
      modelA,
      modelB,
      secondsA,
      secondsB,
      tagsA: parsedA.tags,
      tagsB: parsedB.tags,
      descriptionA: parsedA.description,
      descriptionB: parsedB.description,
    });
  }
  return rows;
}

export function formatCompareTable(rows: CompareRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(`file: ${row.file}`);
    lines.push(
      `${row.modelA} (${row.secondsA.toFixed(1)}s): ${row.tagsA.join(", ")} — ${row.descriptionA}`,
    );
    lines.push(
      `${row.modelB} (${row.secondsB.toFixed(1)}s): ${row.tagsB.join(", ")} — ${row.descriptionB}`,
    );
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
