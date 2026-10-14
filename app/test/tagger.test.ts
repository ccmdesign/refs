import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoard } from "../core/board.ts";
import { addFromFile } from "../core/intake.ts";
import { vocabularyPath } from "../core/paths.ts";
import { getRef } from "../core/ref.ts";
import {
  kickTagger,
  pendingTagCount,
  resetTaggerWorkerStateForTests,
  runTagWorker,
  setTaggerModelFnForTests,
  tagRef,
} from "../core/tagger.ts";
import { parseTaggerResponse } from "../core/tagger/parse.ts";
import { buildTagPrompt, readVocabulary } from "../core/tagger/vocabulary.ts";
import { cleanupLibrary, tempLibrary, tinyPng } from "./helpers.ts";
import YAML from "yaml";

const okJson = JSON.stringify({
  tags: ["swiss", "grid", "mono", "editorial"],
  description: "Tight typographic grid with restrained monochrome palette.",
});

describe("tagger", () => {
  let lib: string;

  beforeEach(() => {
    lib = tempLibrary();
    resetTaggerWorkerStateForTests();
    setTaggerModelFnForTests(null);
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    setTaggerModelFnForTests(null);
    resetTaggerWorkerStateForTests();
    cleanupLibrary(lib);
    vi.restoreAllMocks();
  });

  describe("parseTaggerResponse", () => {
    it("parses plain JSON", () => {
      const r = parseTaggerResponse(okJson);
      expect(r.tags).toEqual(["swiss", "grid", "mono", "editorial"]);
      expect(r.description).toContain("typographic");
    });

    it("parses fenced JSON", () => {
      const r = parseTaggerResponse(`Here:\n\`\`\`json\n${okJson}\n\`\`\``);
      expect(r.tags).toHaveLength(4);
    });

    it("strips think blocks", () => {
      const r = parseTaggerResponse(
        `<think>secret</think>\n${okJson}`,
      );
      expect(r.tags[0]).toBe("swiss");
    });

    it("parses JSON with junk around it", () => {
      const r = parseTaggerResponse(`Note:\n${okJson}\nDone.`);
      expect(r.description).toContain("typographic");
    });

    it("lowercases and dedupes tags", () => {
      const r = parseTaggerResponse(
        JSON.stringify({
          tags: ["Swiss", "swiss", "GRID", "grid", "a", "b", "c", "d", "e", "f", "g"],
          description: "x",
        }),
      );
      expect(r.tags).toEqual(["swiss", "grid", "a", "b", "c", "d", "e", "f", "g"]);
      expect(r.tags.length).toBeLessThanOrEqual(10);
    });

    it("throws on invalid JSON", () => {
      expect(() => parseTaggerResponse("not json")).toThrow();
    });
  });

  describe("vocabulary", () => {
    it("reads a YAML list", () => {
      writeFileSync(vocabularyPath(lib), YAML.stringify(["swiss", "brutalist"]));
      expect(readVocabulary(lib)).toEqual(["swiss", "brutalist"]);
    });

    it("reads { tags: [...] }", () => {
      writeFileSync(vocabularyPath(lib), YAML.stringify({ tags: ["mono"] }));
      expect(readVocabulary(lib)).toEqual(["mono"]);
    });

    it("returns empty when missing", () => {
      expect(readVocabulary(lib)).toEqual([]);
    });

    it("includes vocabulary in prompt", () => {
      const p = buildTagPrompt(["swiss"]);
      expect(p).toContain("swiss");
    });
  });

  describe("tagRef", () => {
    it("writes auto without touching human tags", async () => {
      setTaggerModelFnForTests(async () => okJson);
      createBoard(lib, "main");
      const imgPath = join(lib, "img.png");
      await tinyPng(imgPath);
      const { id } = await addFromFile(lib, imgPath, {
        board: "main",
        tags: ["hand", "picked"],
      });
      const result = await tagRef(lib, id);
      expect(result.auto?.tags).toEqual(["swiss", "grid", "mono", "editorial"]);
      expect(result.tags).toEqual(["hand", "picked"]);
      const stored = getRef(lib, id);
      expect(stored.tags).toEqual(["hand", "picked"]);
      expect(stored.auto?.model).toBeTruthy();
      expect(stored.auto?.at).toBeTruthy();
    });

    it("skips link-only refs in worker", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: { get: () => "text/html" },
          arrayBuffer: async () => new TextEncoder().encode("<html></html>").buffer,
        })),
      );
      const { addFromUrl } = await import("../core/intake.ts");
      createBoard(lib, "links");
      const { id } = await addFromUrl(lib, "https://example.com/x", { board: "links" });
      setTaggerModelFnForTests(async () => okJson);
      await expect(tagRef(lib, id)).rejects.toThrow(/no local image/);
    });
  });

  describe("worker", () => {
    it("drains several refs and stops", async () => {
      setTaggerModelFnForTests(async () => okJson);
      createBoard(lib, "b");
      for (let i = 0; i < 3; i++) {
        const p = join(lib, `img-${i}.png`);
        await tinyPng(p, { r: i * 10, g: 0, b: 0 });
        await addFromFile(lib, p, { board: "b" });
      }
      expect(pendingTagCount(lib)).toBe(3);
      await runTagWorker(lib);
      expect(pendingTagCount(lib)).toBe(0);
      for (const ref of (await import("../core/ref.ts")).listAllRefs(lib)) {
        expect(ref.auto?.tags?.length).toBeGreaterThan(0);
      }
    });

    it("records failure and does not loop forever", async () => {
      let calls = 0;
      setTaggerModelFnForTests(async () => {
        calls++;
        throw new Error("model down");
      });
      createBoard(lib, "b");
      const p = join(lib, "one.png");
      await tinyPng(p);
      await addFromFile(lib, p, { board: "b" });
      await runTagWorker(lib);
      expect(calls).toBe(1);
      expect(pendingTagCount(lib)).toBe(0);
      const failures = JSON.parse(
        readFileSync(join(lib, ".cache", "tagger-failures.json"), "utf8"),
      );
      expect(Object.keys(failures)).toHaveLength(1);
    });
  });

  describe("REFS_TAGGER=none", () => {
    it("kickTagger is a no-op and pendingTagCount is 0", async () => {
      vi.stubEnv("REFS_TAGGER", "none");
      createBoard(lib, "b");
      const p = join(lib, "img.png");
      await tinyPng(p);
      await addFromFile(lib, p, { board: "b" });
      kickTagger(lib);
      expect(pendingTagCount(lib)).toBe(0);
    });
  });
});
