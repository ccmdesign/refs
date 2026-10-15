import {
  existsSync,
  lstatSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBoard } from "../core/board.ts";
import { addFromFile } from "../core/intake.ts";
import {
  outputFileOps,
  probeOutputMethod,
  rebuildBoardOutput,
  resetOutputMethodCacheForTests,
} from "../core/output.ts";
import { cleanupLibrary, tempLibrary, tinyPng, writeLibraryConfig } from "./helpers.ts";

describe("output modes", () => {
  let lib: string;
  let imgPath: string;

  beforeEach(async () => {
    lib = tempLibrary();
    imgPath = join(lib, "sample.png");
    await tinyPng(imgPath);
    resetOutputMethodCacheForTests();
  });

  afterEach(() => {
    resetOutputMethodCacheForTests();
    cleanupLibrary(lib);
  });

  it("copies mode creates regular files with matching size", async () => {
    writeLibraryConfig(lib, { output: { mode: "copies" } });
    createBoard(lib, "cp");
    const { id } = await addFromFile(lib, imgPath, { board: "cp", title: "copy-me" });
    await rebuildBoardOutput(lib, "cp");
    const outDir = join(lib, "out", "cp");
    const name = readdirSync(outDir).find((f) => f !== "refs.yaml");
    expect(name).toBeTruthy();
    const entryPath = join(outDir, name!);
    const st = lstatSync(entryPath);
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
    const stored = statSync(resolve(lib, "files", id.slice(0, 2), `${id}.png`));
    expect(st.size).toBe(stored.size);
  });

  it("links mode creates relative symlinks", async () => {
    if (process.platform === "win32") return;
    writeLibraryConfig(lib, { output: { mode: "links" } });
    createBoard(lib, "rel");
    const { id } = await addFromFile(lib, imgPath, { board: "rel", title: "rel-img" });
    await rebuildBoardOutput(lib, "rel");
    const outDir = join(lib, "out", "rel");
    const linkName = readdirSync(outDir).find((f) => f !== "refs.yaml");
    expect(linkName).toBeTruthy();
    const target = readlinkSync(join(outDir, linkName!));
    expect(isAbsolute(target)).toBe(false);
    expect(resolve(outDir, target)).toBe(
      resolve(lib, "files", id.slice(0, 2), `${id}.png`),
    );
  });

  it("auto falls back to hardlink when symlink fails with EPERM", async () => {
    writeLibraryConfig(lib, { output: { mode: "auto" } });
    createBoard(lib, "auto-hl");
    const { id } = await addFromFile(lib, imgPath, { board: "auto-hl", title: "hl" });
    // Start as a machine without symlink rights would: no entries, no remembered method.
    rmSync(join(lib, "out", "auto-hl"), { recursive: true, force: true });
    resetOutputMethodCacheForTests();
    const realSymlink = outputFileOps.symlinkSync;
    outputFileOps.symlinkSync = () => {
      const err = new Error("symlink denied") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    };
    await rebuildBoardOutput(lib, "auto-hl");
    outputFileOps.symlinkSync = realSymlink;

    const outDir = join(lib, "out", "auto-hl");
    const name = readdirSync(outDir).find((f) => f !== "refs.yaml")!;
    const entryStat = lstatSync(join(outDir, name));
    expect(entryStat.isSymbolicLink()).toBe(false);
    const storedStat = statSync(resolve(lib, "files", id.slice(0, 2), `${id}.png`));
    expect(entryStat.ino).toBe(storedStat.ino);
    expect(entryStat.dev).toBe(storedStat.dev);
  });

  it("auto falls back to copy when symlink and hardlink fail", async () => {
    writeLibraryConfig(lib, { output: { mode: "auto" } });
    createBoard(lib, "auto-cp");
    const { id } = await addFromFile(lib, imgPath, { board: "auto-cp", title: "cp" });
    // Start as a machine without symlink rights would: no entries, no remembered method.
    rmSync(join(lib, "out", "auto-cp"), { recursive: true, force: true });
    resetOutputMethodCacheForTests();
    const realSymlink = outputFileOps.symlinkSync;
    const realLink = outputFileOps.linkSync;
    outputFileOps.symlinkSync = () => {
      const err = new Error("symlink denied") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    };
    outputFileOps.linkSync = () => {
      const err = new Error("cross device") as NodeJS.ErrnoException;
      err.code = "EXDEV";
      throw err;
    };
    await rebuildBoardOutput(lib, "auto-cp");
    outputFileOps.symlinkSync = realSymlink;
    outputFileOps.linkSync = realLink;

    const outDir = join(lib, "out", "auto-cp");
    const name = readdirSync(outDir).find((f) => f !== "refs.yaml")!;
    const entryStat = lstatSync(join(outDir, name));
    expect(entryStat.isSymbolicLink()).toBe(false);
    const storedStat = statSync(resolve(lib, "files", id.slice(0, 2), `${id}.png`));
    expect(entryStat.size).toBe(storedStat.size);
    expect(entryStat.ino).not.toBe(storedStat.ino);
  });

  it("switching from links to copies replaces symlinks with files", async () => {
    if (process.platform === "win32") return;
    writeLibraryConfig(lib, { output: { mode: "links" } });
    createBoard(lib, "sw");
    await addFromFile(lib, imgPath, { board: "sw", title: "switch" });
    await rebuildBoardOutput(lib, "sw");
    const outDir = join(lib, "out", "sw");
    const name = readdirSync(outDir).find((f) => f !== "refs.yaml")!;
    expect(lstatSync(join(outDir, name)).isSymbolicLink()).toBe(true);

    writeLibraryConfig(lib, { output: { mode: "copies" } });
    await rebuildBoardOutput(lib, "sw");
    expect(lstatSync(join(outDir, name)).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(outDir, name)).isFile()).toBe(true);
  });

  it("rebuild does not rewrite correct entries", async () => {
    writeLibraryConfig(lib, { output: { mode: "copies" } });
    createBoard(lib, "stable");
    await addFromFile(lib, imgPath, { board: "stable", title: "stable" });
    await rebuildBoardOutput(lib, "stable");
    const outDir = join(lib, "out", "stable");
    const name = readdirSync(outDir).find((f) => f !== "refs.yaml")!;
    const path = join(outDir, name);
    const before = statSync(path);
    await rebuildBoardOutput(lib, "stable");
    const after = statSync(path);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("probeOutputMethod returns symlink on non-Windows and cleans probe dir", () => {
    if (process.platform === "win32") return;
    expect(probeOutputMethod(lib)).toBe("symlink");
    expect(existsSync(join(lib, ".cache", "probe"))).toBe(false);
  });
});
