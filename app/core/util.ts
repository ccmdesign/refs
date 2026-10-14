import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCK_STALE_MS = 10_000;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ref";
}

export async function atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  renameSync(tmp, filePath);
}

export function atomicWriteSync(filePath: string, content: string | Buffer): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

export function validateBoardPath(boardPath: string): void {
  if (!boardPath || boardPath.trim() === "") {
    throw new Error("Board path must not be empty");
  }
  const segments = boardPath.split("/");
  for (const seg of segments) {
    if (seg === "") {
      throw new Error(`Invalid board path segment in "${boardPath}"`);
    }
    if (seg.startsWith(".")) {
      throw new Error(`Board path segment must not start with a dot: "${seg}"`);
    }
    if (seg.includes("\\") || seg.includes("/")) {
      throw new Error(`Invalid board path segment: "${seg}"`);
    }
  }
}

export function splitBoardPath(boardPath: string): string[] {
  validateBoardPath(boardPath);
  return boardPath.split("/");
}

export function parentBoardPath(boardPath: string): string | null {
  const parts = splitBoardPath(boardPath);
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join("/");
}

export function boardPathPrefix(boardPath: string): string {
  return boardPath + "/";
}

export function isSubBoardPath(parent: string, child: string): boolean {
  const prefix = boardPathPrefix(parent);
  return child.startsWith(prefix) && child !== parent;
}

export async function withBoardLock<T>(
  lib: string,
  boardPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = join(lib, "boards", `${boardPath}.yaml.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  acquireBoardLockSync(lockPath);
  try {
    return await fn();
  } finally {
    releaseBoardLock(lockPath);
  }
}

export function withBoardLockSync<T>(lib: string, boardPath: string, fn: () => T): T {
  const lockPath = join(lib, "boards", `${boardPath}.yaml.lock`);
  mkdirSync(dirname(lockPath), { recursive: true });
  acquireBoardLockSync(lockPath);
  try {
    return fn();
  } finally {
    releaseBoardLock(lockPath);
  }
}

function acquireBoardLockSync(lockPath: string): void {
  if (existsSync(lockPath)) {
    try {
      const stat = readFileSync(lockPath, "utf8");
      const ts = Number(stat.trim());
      if (!Number.isNaN(ts) && Date.now() - ts > LOCK_STALE_MS) {
        unlinkSync(lockPath);
      }
    } catch {
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
  }
  let fd: number | undefined;
  for (let i = 0; i < 50; i++) {
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(fd, String(Date.now()));
      closeSync(fd);
      return;
    } catch {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
      }
      const start = Date.now();
      while (Date.now() - start < 20) {
        /* spin briefly */
      }
    }
  }
  throw new Error(`Could not acquire board lock: ${lockPath}`);
}

function releaseBoardLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

export function extensionFromPath(path: string): string {
  const m = path.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "";
}

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
