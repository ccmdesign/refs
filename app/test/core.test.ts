import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRefToBoard,
  createBoard,
  renameBoard,
  removeRefFromBoard,
  setBoardBrief,
} from "../core/board.ts";
import { addFromFile, addFromUrl, titleFromUrl } from "../core/intake.ts";
import {
  exportBoard,
  rebuildAllOutput,
  rebuildBoardOutput,
} from "../core/output.ts";
import { refIdFromBuffer } from "../core/paths.ts";
import {
  deleteRef,
  listRefs,
  listUnsortedRefIds,
} from "../core/ref.ts";
import { moveRefBetweenBoards } from "../core/board.ts";
import { cleanupLibrary, tempLibrary, tinyPng } from "./helpers.ts";
import YAML from "yaml";

describe("refs core", () => {
  let lib: string;
  let imgPath: string;

  beforeEach(async () => {
    lib = tempLibrary();
    imgPath = join(lib, "sample.png");
    await tinyPng(imgPath);
  });

  afterEach(() => {
    cleanupLibrary(lib);
    vi.restoreAllMocks();
  });

  it("adds an image ref and stores file by hash", async () => {
    createBoard(lib, "main");
    const buf = readFileSync(imgPath);
    const id = refIdFromBuffer(buf);
    const result = await addFromFile(lib, imgPath, { board: "main", title: "sample" });
    expect(result.duplicate).toBe(false);
    expect(result.id).toBe(id);
    expect(existsSync(join(lib, "refs", `${id}.yaml`))).toBe(true);
    expect(existsSync(join(lib, "files", id.slice(0, 2), `${id}.png`))).toBe(true);
    await rebuildBoardOutput(lib, "main");
    const outDir = join(lib, "out", "main");
    expect(existsSync(join(outDir, "refs.yaml"))).toBe(true);
  });

  it("duplicate add does not store image again but adds to board", async () => {
    createBoard(lib, "a");
    createBoard(lib, "b");
    const first = await addFromFile(lib, imgPath, { board: "a" });
    const filePath = join(lib, "files", first.id.slice(0, 2), `${first.id}.png`);
    const mtime = readFileSync(filePath).length;
    const second = await addFromFile(lib, imgPath, { board: "b" });
    expect(second.duplicate).toBe(true);
    expect(readFileSync(filePath).length).toBe(mtime);
    const boardB = YAML.parse(readFileSync(join(lib, "boards", "b.yaml"), "utf8"));
    expect(boardB.refs.some((r: { id: string }) => r.id === first.id)).toBe(true);
  });

  it("creates link-only ref for non-image URL", async () => {
    createBoard(lib, "links");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "text/html" },
        arrayBuffer: async () => new TextEncoder().encode("<html></html>").buffer,
      })),
    );
    const url = "https://example.com/page";
    const result = await addFromUrl(lib, url, { board: "links" });
    expect(result.ref.url).toBe(url);
    expect(result.ref.file).toBeUndefined();
    expect(result.ref.source).toBeUndefined();
    expect(existsSync(join(lib, "refs", `${result.id}.yaml`))).toBe(true);
    const stored = YAML.parse(readFileSync(join(lib, "refs", `${result.id}.yaml`), "utf8"));
    expect(stored.source).toBeUndefined();
    await rebuildBoardOutput(lib, "links");
    const out = YAML.parse(readFileSync(join(lib, "out", "links", "refs.yaml"), "utf8"));
    expect(out.refs[0].id).toBe(result.id);
    expect(out.refs[0].source).toBeUndefined();
  });

  it("same ref on two boards with different board notes", async () => {
    createBoard(lib, "one");
    createBoard(lib, "two");
    const { id } = await addFromFile(lib, imgPath, { board: "one", boardNote: "note-a" });
    addRefToBoard(lib, "two", id, { note: "note-b" });
    await rebuildBoardOutput(lib, "one");
    await rebuildBoardOutput(lib, "two");
    const out1 = YAML.parse(readFileSync(join(lib, "out", "one", "refs.yaml"), "utf8"));
    const out2 = YAML.parse(readFileSync(join(lib, "out", "two", "refs.yaml"), "utf8"));
    expect(out1.refs[0].board_note).toBe("note-a");
    expect(out2.refs[0].board_note).toBe("note-b");
  });

  it("moves ref between boards", async () => {
    createBoard(lib, "from");
    createBoard(lib, "to");
    const { id } = await addFromFile(lib, imgPath, { board: "from" });
    moveRefBetweenBoards(lib, id, "from", "to");
    const from = YAML.parse(readFileSync(join(lib, "boards", "from.yaml"), "utf8"));
    const to = YAML.parse(readFileSync(join(lib, "boards", "to.yaml"), "utf8"));
    expect(from.refs).toHaveLength(0);
    expect(to.refs[0].id).toBe(id);
  });

  it("remove from board vs delete to trash", async () => {
    createBoard(lib, "b");
    const { id } = await addFromFile(lib, imgPath, { board: "b" });
    removeRefFromBoard(lib, "b", id);
    expect(listUnsortedRefIds(lib)).toContain(id);
    expect(existsSync(join(lib, "refs", `${id}.yaml`))).toBe(true);

    await deleteRef(lib, id);
    expect(existsSync(join(lib, "refs", `${id}.yaml`))).toBe(false);
    expect(existsSync(join(lib, ".trash", `${id}.yaml`))).toBe(true);
    expect(existsSync(join(lib, ".trash", `${id}.png`))).toBe(true);
  });

  it("nested boards and rename moves yaml and out paths", async () => {
    createBoard(lib, "parent/child");
    setBoardBrief(lib, "parent", "parent brief");
    await addFromFile(lib, imgPath, { board: "parent/child" });
    renameBoard(lib, "parent", "renamed");
    await rebuildAllOutput(lib);
    expect(existsSync(join(lib, "boards", "renamed", "child.yaml"))).toBe(true);
    expect(existsSync(join(lib, "boards", "parent", "child.yaml"))).toBe(false);
    await rebuildBoardOutput(lib, "renamed/child");
    expect(existsSync(join(lib, "out", "renamed", "child", "refs.yaml"))).toBe(true);
  });

  it("moving a board under another keeps its sub-boards and clears old output", async () => {
    createBoard(lib, "illustrations/flat");
    createBoard(lib, "diia");
    await addFromFile(lib, imgPath, { board: "illustrations/flat" });
    await rebuildAllOutput(lib);
    renameBoard(lib, "illustrations", "diia/illustrations");
    await rebuildAllOutput(lib);
    expect(existsSync(join(lib, "boards", "diia", "illustrations", "flat.yaml"))).toBe(true);
    expect(existsSync(join(lib, "out", "diia", "illustrations", "flat", "refs.yaml"))).toBe(true);
    expect(existsSync(join(lib, "out", "illustrations"))).toBe(false);
  });

  it("refuses to move a board onto an existing one or into itself", () => {
    createBoard(lib, "a/x");
    createBoard(lib, "b/a");
    expect(() => renameBoard(lib, "a", "b/a")).toThrow(/already exists/);
    expect(() => renameBoard(lib, "a", "a/x/a")).toThrow(/into itself/);
    expect(existsSync(join(lib, "boards", "a", "x.yaml"))).toBe(true);
  });

  it("lists unsorted refs", async () => {
    const { id } = await addFromFile(lib, imgPath);
    expect(listUnsortedRefIds(lib)).toContain(id);
    createBoard(lib, "sorted");
    addRefToBoard(lib, "sorted", id);
    expect(listUnsortedRefIds(lib)).not.toContain(id);
  });

  it("filters refs by human or machine tag", async () => {
    const { id } = await addFromFile(lib, imgPath, { tags: ["poster"] });
    const { updateRef } = await import("../core/ref.ts");
    updateRef(lib, id, { auto: { tags: ["grid"], description: "x" } });
    expect(listRefs(lib, { tag: "poster" }).map((r) => r.id)).toContain(id);
    expect(listRefs(lib, { tag: "grid" }).map((r) => r.id)).toContain(id);
  });

  it("generated folder has parent briefs and key-first order", async () => {
    createBoard(lib, "root");
    createBoard(lib, "root/middle");
    createBoard(lib, "root/middle/leaf");
    setBoardBrief(lib, "root", "root brief");
    setBoardBrief(lib, "root/middle/leaf", "leaf brief");

    const img2 = join(lib, "b.png");
    await tinyPng(img2, { r: 200, g: 50, b: 10 });
    const b = await addFromFile(lib, img2, { board: "root/middle/leaf" });
    await new Promise((r) => setTimeout(r, 5));
    const a = await addFromFile(lib, imgPath, {
      board: "root/middle/leaf",
      key: true,
    });

    await rebuildBoardOutput(lib, "root/middle/leaf");
    const yamlPath = join(lib, "out", "root", "middle", "leaf", "refs.yaml");
    const out = YAML.parse(readFileSync(yamlPath, "utf8"));
    expect(out.parent_briefs).toEqual([{ board: "root", brief: "root brief" }]);
    expect(out.refs[0].id).toBe(a.id);
    expect(out.refs[1].id).toBe(b.id);
    expect(out.brief).toBe("leaf brief");
    expect(readFileSync(yamlPath, "utf8")).toMatch(/refs:\n  - id:/);
    expect(out.refs[0].key).toBe(true);
    expect(out.refs[0].file).toMatch(new RegExp(`${a.id.slice(0, 6)}`));
    expect(out.refs[1].file).toMatch(new RegExp(`${b.id.slice(0, 6)}`));
  });

  it("out image symlinks are relative and resolve to stored files", async () => {
    createBoard(lib, "rel");
    const { id } = await addFromFile(lib, imgPath, { board: "rel", title: "rel-img" });
    await rebuildBoardOutput(lib, "rel");
    const outDir = join(lib, "out", "rel");
    const linkName = readdirSync(outDir).find((f) => f !== "refs.yaml");
    expect(linkName).toBeTruthy();
    const target = readlinkSync(join(outDir, linkName!));
    expect(isAbsolute(target)).toBe(false);
    const resolved = resolve(outDir, target);
    expect(resolved).toBe(resolve(lib, "files", id.slice(0, 2), `${id}.png`));
  });

  it("export copies real files not symlinks", async () => {
    createBoard(lib, "export-me");
    await addFromFile(lib, imgPath, { board: "export-me", title: "exportable" });
    const exportDir = join(lib, "export-target");
    await exportBoard(lib, "export-me", exportDir);
    const files = readdirSync(exportDir).filter((f) => f !== "refs.yaml");
    expect(files.length).toBe(1);
    const stat = lstatSync(join(exportDir, files[0]));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
  });

  it("stale output files are removed on rebuild", async () => {
    createBoard(lib, "clean");
    const { id } = await addFromFile(lib, imgPath, { board: "clean", title: "first" });
    await rebuildBoardOutput(lib, "clean");
    const outDir = join(lib, "out", "clean");
    writeFileSync(join(outDir, "stale-old.png"), "junk");
    removeRefFromBoard(lib, "clean", id);
    await rebuildBoardOutput(lib, "clean");
    expect(readdirSync(outDir)).not.toContain("stale-old.png");
  });

  it("titleFromUrl uses last path segment without extension", () => {
    expect(titleFromUrl("https://example.com/assets/vignelli-poster.jpg")).toBe("vignelli-poster");
    expect(titleFromUrl("https://cdn.example.com/foo/bar%20name.webp")).toBe("bar name");
    expect(titleFromUrl("https://example.com/")).toBe("example.com");
  });

  it("parent rebuild does not delete child out subfolders", async () => {
    createBoard(lib, "p");
    createBoard(lib, "p/c");
    await addFromFile(lib, imgPath, { board: "p" });
    await addFromFile(lib, imgPath, { board: "p/c" });
    await rebuildBoardOutput(lib, "p");
    await rebuildBoardOutput(lib, "p/c");
    expect(existsSync(join(lib, "out", "p", "c", "refs.yaml"))).toBe(true);
    await rebuildBoardOutput(lib, "p");
    expect(existsSync(join(lib, "out", "p", "c", "refs.yaml"))).toBe(true);
  });
});
