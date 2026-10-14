import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBoard, listBoards } from "./board.ts";
import { appDir, ensureLibraryDirs } from "./paths.ts";
import { getRef, listAllRefs, updateRef } from "./ref.ts";
import type { RefData } from "./types.ts";
import { rebuildBoardOutput } from "./output.ts";
import { atomicWriteSync } from "./util.ts";
import { resolveTagModelFn, type TagModelFn } from "./tagger/backends.ts";
import { prepareFileJpeg, prepareTaggerJpeg } from "./tagger/image.ts";
import { parseTaggerResponse } from "./tagger/parse.ts";
import { buildTagPrompt, readVocabulary } from "./tagger/vocabulary.ts";

const LOCK_STALE_MS = 2 * 60 * 1000;

let injectedModelFn: TagModelFn | null = null;
const workerFailedIds = new Set<string>();

export function setTaggerModelFnForTests(fn: TagModelFn | null): void {
  injectedModelFn = fn;
}

export function resetTaggerWorkerStateForTests(): void {
  workerFailedIds.clear();
}

export type TaggerMode = "omlx" | "claude" | "codex" | "none";

export function getTaggerMode(): TaggerMode {
  const raw = (process.env.REFS_TAGGER ?? "omlx").toLowerCase();
  if (raw === "claude" || raw === "codex" || raw === "none") return raw;
  return "omlx";
}

export function getTaggerModel(): string {
  const override = process.env.REFS_TAGGER_MODEL;
  if (override) return override;
  const mode = getTaggerMode();
  if (mode === "omlx") return "Qwen3.8-27B-8bit";
  return mode;
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
  return existsSync(join(lib, ref.file));
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

function modelFn(): TagModelFn {
  if (injectedModelFn) return injectedModelFn;
  return resolveTagModelFn(getTaggerMode());
}

async function tagRefCore(lib: string, id: string): Promise<RefData> {
  const mode = getTaggerMode();
  if (mode === "none") {
    throw new Error("Tagger is disabled (REFS_TAGGER=none)");
  }
  ensureLibraryDirs(lib);
  const ref = getRef(lib, id);
  if (!ref.file) {
    throw new Error(`Ref ${id} has no local image file`);
  }
  const imagePath = join(lib, ref.file);
  if (!existsSync(imagePath)) {
    throw new Error(`Image file missing for ref ${id}`);
  }

  const vocabulary = readVocabulary(lib);
  const prompt = buildTagPrompt(vocabulary);
  const jpegPath = await prepareTaggerJpeg(lib, id, imagePath);
  const model = getTaggerModel();
  const raw = await modelFn()({ prompt, jpegPath, model });
  const parsed = parseTaggerResponse(raw);
  clearFailure(lib, id);
  updateRef(lib, id, {
    auto: {
      tags: parsed.tags,
      description: parsed.description,
      model,
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
  if (getTaggerMode() === "none") return 0;
  const failures = readFailures(lib);
  let count = 0;
  for (const ref of listAllRefs(lib)) {
    if (isUntaggedCandidate(lib, ref, failures)) count++;
  }
  return count;
}

export function kickTagger(lib: string): void {
  if (getTaggerMode() === "none") return;
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
  if (getTaggerMode() === "none") return;
  ensureLibraryDirs(lib);
  if (lockIsLive(lib)) return;

  touchLock(lib);
  try {
    for (;;) {
      const id = findNextUntaggedId(lib);
      if (!id) break;
      touchLock(lib);
      try {
        await tagRefCore(lib, id);
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
  const cacheDir = join(tmpdir(), `refs-tag-compare-${process.pid}`);
  await mkdir(join(cacheDir, "tagger"), { recursive: true });
  const vocabulary: string[] = [];
  const prompt = buildTagPrompt(vocabulary);
  const call = callOmlxForCompare;

  const rows: CompareRow[] = [];
  for (const file of files) {
    const abs = resolve(file);
    const id = `compare-${rows.length}`;
    const jpegPath = join(cacheDir, "tagger", `${id}.jpg`);
    await prepareFileJpeg(abs, jpegPath);

    const t0 = performance.now();
    const rawA = await call({ prompt, jpegPath, model: modelA });
    const secondsA = (performance.now() - t0) / 1000;
    const parsedA = parseTaggerResponse(rawA);

    const t1 = performance.now();
    const rawB = await call({ prompt, jpegPath, model: modelB });
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

async function callOmlxForCompare(input: {
  prompt: string;
  jpegPath: string;
  model: string;
}): Promise<string> {
  return resolveTagModelFn("omlx")(input);
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
