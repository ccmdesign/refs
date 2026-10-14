import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

export async function prepareTaggerJpeg(
  lib: string,
  id: string,
  sourcePath: string,
): Promise<string> {
  const cacheDir = join(lib, ".cache", "tagger");
  await mkdir(cacheDir, { recursive: true });
  const outPath = join(cacheDir, `${id}.jpg`);
  const buf = await sharp(sourcePath)
    .flatten({ background: "#ffffff" })
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg()
    .toBuffer();
  await writeFile(outPath, buf);
  return outPath;
}

export async function prepareFileJpeg(sourcePath: string, outPath: string): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  const buf = await sharp(sourcePath)
    .flatten({ background: "#ffffff" })
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg()
    .toBuffer();
  await writeFile(outPath, buf);
  return outPath;
}
