import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export function tempLibrary(): string {
  return mkdtempSync(join(tmpdir(), "refs-test-"));
}

export function cleanupLibrary(lib: string): void {
  rmSync(lib, { recursive: true, force: true });
}

export async function tinyPng(
  path: string,
  background: { r: number; g: number; b: number } = { r: 10, g: 20, b: 30 },
): Promise<void> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background },
  })
    .png()
    .toBuffer();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, buf);
}
