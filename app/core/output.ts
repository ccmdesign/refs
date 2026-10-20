import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import YAML from "yaml";
import { dirname, join, relative, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { boardOutputDir, boardYamlPath } from "./paths.ts";
import type { OutputRefEntry, OutputRefsYaml } from "./types.ts";
import { slugify } from "./util.ts";
import { stringifyOutput } from "./yaml.ts";
import { collectParentBriefs, getBoard, listBoards } from "./board.ts";
import { getRef } from "./ref.ts";

/** Vitest cannot reliably spy `node:fs` named ESM imports; tests patch these. */
export const outputFileOps = {
  symlinkSync,
  linkSync,
  copyFileSync,
};

export type OutputMethod = "symlink" | "hardlink" | "copy";

const outputMethodByLib = new Map<string, OutputMethod>();

export function resetOutputMethodCacheForTests(): void {
  outputMethodByLib.clear();
}

function errCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as NodeJS.ErrnoException).code);
  }
  return undefined;
}

function isSymlinkFallbackError(err: unknown): boolean {
  const code = errCode(err);
  return (
    code === "EPERM" ||
    code === "EACCES" ||
    code === "ENOTSUP" ||
    code === "EINVAL" ||
    code === "UNKNOWN"
  );
}

function isHardlinkFallbackError(err: unknown): boolean {
  const code = errCode(err);
  return code === "EXDEV" || code === "EPERM";
}

function isEntryCorrect(
  entryPath: string,
  absStored: string,
  method: OutputMethod,
): boolean {
  if (!existsSync(entryPath)) return false;
  const entryStat = lstatSync(entryPath);
  const storedStat = statSync(absStored);

  if (method === "symlink") {
    if (!entryStat.isSymbolicLink()) return false;
    try {
      const target = readlinkSync(entryPath);
      return resolve(dirname(entryPath), target) === absStored;
    } catch {
      return false;
    }
  }

  if (method === "hardlink") {
    if (entryStat.isSymbolicLink() || !entryStat.isFile()) return false;
    return entryStat.ino === storedStat.ino && entryStat.dev === storedStat.dev;
  }

  if (entryStat.isSymbolicLink() || !entryStat.isFile()) return false;
  return entryStat.size === storedStat.size;
}

function removeEntry(entryPath: string): void {
  if (!existsSync(entryPath)) return;
  unlinkSync(entryPath);
}

function createSymlink(rel: string, entryPath: string, mode: string): void {
  try {
    outputFileOps.symlinkSync(rel, entryPath);
  } catch (err) {
    throw new Error(
      `output.mode ${mode}: could not create symlink (${errCode(err) ?? "error"}). Try output.mode: auto in config.yaml`,
    );
  }
}

function createHardlink(absStored: string, entryPath: string): void {
  outputFileOps.linkSync(absStored, entryPath);
}

function createCopy(absStored: string, entryPath: string): void {
  outputFileOps.copyFileSync(absStored, entryPath);
}

function createWithMethod(
  method: OutputMethod,
  rel: string,
  absStored: string,
  entryPath: string,
  configMode: string,
): void {
  if (method === "symlink") {
    createSymlink(rel, entryPath, configMode);
  } else if (method === "hardlink") {
    createHardlink(absStored, entryPath);
  } else {
    createCopy(absStored, entryPath);
  }
}

function tryAutoMethod(
  lib: string,
  rel: string,
  absStored: string,
  entryPath: string,
): OutputMethod {
  try {
    outputFileOps.symlinkSync(rel, entryPath);
    outputMethodByLib.set(lib, "symlink");
    return "symlink";
  } catch (err) {
    if (!isSymlinkFallbackError(err)) throw err;
  }

  try {
    outputFileOps.linkSync(absStored, entryPath);
    outputMethodByLib.set(lib, "hardlink");
    return "hardlink";
  } catch (err) {
    if (!isHardlinkFallbackError(err)) throw err;
  }

  outputFileOps.copyFileSync(absStored, entryPath);
  outputMethodByLib.set(lib, "copy");
  return "copy";
}

function ensureOutputEntry(
  lib: string,
  mode: "links" | "copies" | "auto",
  rel: string,
  absStored: string,
  entryPath: string,
): void {
  let method: OutputMethod;

  if (mode === "links") {
    method = "symlink";
  } else if (mode === "copies") {
    method = "copy";
  } else {
    const cached = outputMethodByLib.get(lib);
    if (cached) {
      method = cached;
    } else {
      for (const candidate of ["symlink", "hardlink", "copy"] as const) {
        if (isEntryCorrect(entryPath, absStored, candidate)) {
          outputMethodByLib.set(lib, candidate);
          return;
        }
      }
      if (existsSync(entryPath)) removeEntry(entryPath);
      tryAutoMethod(lib, rel, absStored, entryPath);
      return;
    }
  }

  if (isEntryCorrect(entryPath, absStored, method)) return;
  if (existsSync(entryPath)) removeEntry(entryPath);
  createWithMethod(method, rel, absStored, entryPath, mode);
}

export function probeOutputMethod(lib: string): OutputMethod {
  const probeDir = join(lib, ".cache", "probe");
  mkdirSync(probeDir, { recursive: true });
  const storedPath = join(probeDir, "stored.txt");
  const entryPath = join(probeDir, "entry.txt");
  writeFileSync(storedPath, "probe");
  const absStored = resolve(storedPath);
  const rel = relative(probeDir, absStored);

  try {
    try {
      outputFileOps.symlinkSync(rel, entryPath);
      return "symlink";
    } catch (err) {
      if (!isSymlinkFallbackError(err)) throw err;
    }

    try {
      outputFileOps.linkSync(absStored, entryPath);
      return "hardlink";
    } catch (err) {
      if (!isHardlinkFallbackError(err)) throw err;
    }

    outputFileOps.copyFileSync(absStored, entryPath);
    return "copy";
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function sortBoardRefs(
  board: ReturnType<typeof getBoard>,
): typeof board.refs {
  return [...board.refs].sort((a, b) => {
    const ak = a.key ? 1 : 0;
    const bk = b.key ? 1 : 0;
    if (ak !== bk) return bk - ak;
    return a.added.localeCompare(b.added);
  });
}

function outputFileName(ref: ReturnType<typeof getRef>, id: string): string {
  const title = ref.title || id;
  const ext = ref.file ? ref.file.split(".").pop()! : "link";
  return `${slugify(title)}-${id.slice(0, 6)}.${ext}`;
}

function posterFileName(ref: ReturnType<typeof getRef>, id: string): string {
  return outputFileName(ref, id).replace(/\.[^.]+$/, ".poster.jpg");
}

function buildOutputYaml(
  lib: string,
  boardPath: string,
): OutputRefsYaml {
  const board = getBoard(lib, boardPath);
  const parentBriefs = collectParentBriefs(lib, boardPath);
  const refs: OutputRefEntry[] = [];

  for (const entry of sortBoardRefs(board)) {
    const ref = getRef(lib, entry.id);
    const out: OutputRefEntry = { id: entry.id };
    if (ref.kind === "video") out.type = "video";
    if (ref.file) {
      out.file = outputFileName(ref, entry.id);
      if (ref.poster && existsSync(resolve(lib, ref.poster))) {
        out.poster = posterFileName(ref, entry.id);
      }
      if (ref.duration) out.duration = ref.duration;
    } else if (ref.url) {
      out.url = ref.url;
    }
    if (entry.key) out.key = true;
    if (ref.note) out.note = ref.note;
    if (entry.note) out.board_note = entry.note;
    if (ref.tags?.length) out.tags = ref.tags;
    if (ref.auto?.tags?.length) out.machine_tags = ref.auto.tags;
    if (ref.auto?.description) out.description = ref.auto.description;
    if (ref.source) out.source = ref.source;
    refs.push(out);
  }

  const doc: OutputRefsYaml = {
    board: boardPath,
    refs,
  };
  if (board.brief) doc.brief = board.brief;
  if (parentBriefs.length) doc.parent_briefs = parentBriefs;
  return doc;
}

export async function rebuildBoardOutput(lib: string, boardPath: string): Promise<void> {
  if (!existsSync(boardYamlPath(lib, boardPath))) return;

  const { output } = loadConfig(lib);
  const mode = output.mode;

  const outDir = boardOutputDir(lib, boardPath);
  mkdirSync(outDir, { recursive: true });

  const board = getBoard(lib, boardPath);
  const desiredLinks = new Map<string, { rel: string; abs: string }>();

  for (const entry of board.refs) {
    const ref = getRef(lib, entry.id);
    if (!ref.file) continue;
    const linkName = outputFileName(ref, entry.id);
    const abs = resolve(lib, ref.file);
    desiredLinks.set(linkName, { rel: relative(outDir, abs), abs });
    if (ref.poster) {
      const posterAbs = resolve(lib, ref.poster);
      if (existsSync(posterAbs)) {
        desiredLinks.set(posterFileName(ref, entry.id), {
          rel: relative(outDir, posterAbs),
          abs: posterAbs,
        });
      }
    }
  }

  const existing = existsSync(outDir)
    ? readdirSync(outDir, { withFileTypes: true })
    : [];

  for (const ent of existing) {
    if (ent.name === "refs.yaml") continue;
    const full = join(outDir, ent.name);
    if (ent.isDirectory()) continue;
    if (!desiredLinks.has(ent.name)) {
      rmSync(full, { force: true });
    }
  }

  for (const [name, { rel, abs }] of desiredLinks) {
    const linkPath = join(outDir, name);
    ensureOutputEntry(lib, mode, rel, abs, linkPath);
  }

  const yaml = buildOutputYaml(lib, boardPath);
  const yamlDoc: Record<string, unknown> = {
    board: yaml.board,
  };
  if (yaml.brief) yamlDoc.brief = yaml.brief;
  if (yaml.parent_briefs?.length) yamlDoc.parent_briefs = yaml.parent_briefs;
  yamlDoc.refs = yaml.refs;
  writeFileSync(join(outDir, "refs.yaml"), stringifyOutput(yamlDoc));
}

export async function rebuildAllOutput(lib: string): Promise<void> {
  // Start clean so folders of renamed or deleted boards do not linger.
  rmSync(join(lib, "out"), { recursive: true, force: true });
  const boards = listBoards(lib);
  for (const b of boards) {
    await rebuildBoardOutput(lib, b);
  }
}

export function getGeneratedBoardPath(lib: string, boardPath: string): string {
  return resolve(boardOutputDir(lib, boardPath));
}

export function readGeneratedRefsYaml(lib: string, boardPath: string): OutputRefsYaml {
  const outDir = boardOutputDir(lib, boardPath);
  const path = join(outDir, "refs.yaml");
  if (!existsSync(path)) {
    throw new Error(`Generated output not found for board: ${boardPath}`);
  }
  return YAML.parse(readFileSync(path, "utf8")) as OutputRefsYaml;
}

export async function exportBoard(
  lib: string,
  boardPath: string,
  targetDir: string,
): Promise<void> {
  await rebuildBoardOutput(lib, boardPath);
  const srcDir = boardOutputDir(lib, boardPath);
  mkdirSync(targetDir, { recursive: true });

  const board = getBoard(lib, boardPath);
  for (const ent of readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.isDirectory()) continue;
    const src = join(srcDir, ent.name);
    const dest = join(targetDir, ent.name);
    if (ent.name === "refs.yaml") {
      copyFileSync(src, dest);
      continue;
    }
    const entry = board.refs.find((r) => {
      const ref = getRef(lib, r.id);
      return outputFileName(ref, r.id) === ent.name;
    });
    if (entry) {
      const ref = getRef(lib, entry.id);
      if (ref.file) {
        copyFileSync(resolve(lib, ref.file), dest);
      }
    } else {
      copyFileSync(src, dest);
    }
  }

}
