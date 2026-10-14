import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Inside the bundled Nuxt server this module no longer sits in app/core, so the
// server sets REFS_APP_DIR at startup (server/plugins/app-dir.ts).
export function appDir(): string {
  return process.env.REFS_APP_DIR || resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function getLibraryPath(override?: string): string {
  if (override) return resolve(override);
  const fromEnv = process.env.REFS_LIBRARY;
  if (fromEnv) return resolve(fromEnv);
  return resolve(appDir(), "../library");
}

export function refIdFromBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

export function refIdFromString(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);
}

export function refYamlPath(lib: string, id: string): string {
  return join(lib, "refs", `${id}.yaml`);
}

export function imageStoragePath(lib: string, id: string, ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  return join(lib, "files", id.slice(0, 2), `${id}.${normalized}`);
}

export function imageStorageRelative(id: string, ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  return `files/${id.slice(0, 2)}/${id}.${normalized}`;
}

export function boardYamlPath(lib: string, boardPath: string): string {
  return join(lib, "boards", `${boardPath}.yaml`);
}

export function boardOutputDir(lib: string, boardPath: string): string {
  return join(lib, "out", boardPath);
}

export function trashDir(lib: string): string {
  return join(lib, ".trash");
}

export function vocabularyPath(lib: string): string {
  return join(lib, "vocabulary.yaml");
}

export function ensureLibraryDirs(lib: string): void {
  for (const sub of ["files", "refs", "boards", "out", ".trash", ".cache"]) {
    mkdirSync(join(lib, sub), { recursive: true });
  }
}
