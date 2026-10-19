import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { createBoard } from "../core/board.ts";
import { runDoctor } from "../core/doctor.ts";
import { addFromBuffer, addFromFile } from "../core/intake.ts";
import { rebuildBoardOutput } from "../core/output.ts";
import { deleteRef, getRef } from "../core/ref.ts";
import { setTaggerAdapterForTests, tagRef } from "../core/tagger.ts";
import type { DescribeInput } from "../core/tagger/adapters/types.ts";
import { checkFfmpeg, stillImagePath } from "../core/video.ts";
import { cleanupLibrary, tempLibrary } from "./helpers.ts";

const hasFfmpeg = checkFfmpeg().ok;

/** A one-second 64×48 test pattern, made with ffmpeg. */
function tinyMp4(path: string): void {
  const res = spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=1",
    "-pix_fmt", "yuv420p", path,
  ]);
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr}`);
}

function withoutFfmpeg(): void {
  vi.stubEnv("REFS_FFMPEG", "refs-no-such-ffmpeg");
  vi.stubEnv("REFS_FFPROBE", "refs-no-such-ffprobe");
}

function outYaml(lib: string, board: string) {
  return YAML.parse(readFileSync(join(lib, "out", board, "refs.yaml"), "utf8"));
}

describe("video refs", () => {
  let lib: string;

  beforeEach(() => {
    lib = tempLibrary();
  });

  afterEach(() => {
    setTaggerAdapterForTests(null);
    vi.unstubAllEnvs();
    cleanupLibrary(lib);
  });

  describe("without ffmpeg", () => {
    beforeEach(withoutFfmpeg);

    it("stores the video, marks it, and dedupes by content", async () => {
      const buf = Buffer.from("not really a video, but named like one");
      createBoard(lib, "motion");
      const first = await addFromBuffer(lib, buf, "hover-study.mp4", { board: "motion" });
      expect(first.duplicate).toBe(false);
      expect(first.ref.kind).toBe("video");
      expect(first.ref.file).toBe(`files/${first.id.slice(0, 2)}/${first.id}.mp4`);
      expect(first.ref.poster).toBeUndefined();
      expect(existsSync(join(lib, first.ref.file!))).toBe(true);

      const again = await addFromBuffer(lib, buf, "copy.mp4", { board: "motion" });
      expect(again.duplicate).toBe(true);
      expect(again.id).toBe(first.id);

      const doc = outYaml(lib, "motion");
      expect(doc.refs).toHaveLength(1);
      expect(doc.refs[0]).toMatchObject({ type: "video", file: `hover-study-${first.id.slice(0, 6)}.mp4` });
      expect(doc.refs[0].poster).toBeUndefined();
      const entries = readdirSync(join(lib, "out", "motion")).sort();
      expect(entries).toEqual(["hover-study-" + first.id.slice(0, 6) + ".mp4", "refs.yaml"]);
    });

    it("has no still image, so the video is not tagged", async () => {
      const { id } = await addFromBuffer(lib, Buffer.from("video bytes"), "clip.webm");
      expect(stillImagePath(lib, getRef(lib, id))).toBeUndefined();
      setTaggerAdapterForTests({
        id: "fake",
        check: async () => ({ ok: true, detail: "fake" }),
        describe: async () => '{"tags":["x"],"description":"y"}',
      });
      await expect(tagRef(lib, id)).rejects.toThrow(/install ffmpeg/);
    });

    it("doctor warns about ffmpeg but does not fail", async () => {
      const checks = await runDoctor(lib, { port: 1 });
      const ff = checks.find((c) => c.id === "ffmpeg");
      expect(ff?.status).toBe("warn");
      expect(ff?.fix).toMatch(/ffmpeg/);
    });
  });

  it("refuses a video over the size cap, naming both sizes", async () => {
    withoutFfmpeg();
    vi.stubEnv("REFS_MAX_VIDEO_MB", "1");
    const big = Buffer.alloc(2 * 1024 * 1024);
    await expect(addFromBuffer(lib, big, "big.mov")).rejects.toThrow(/Video is 2 MB; the limit is 1 MB/);
    const path = join(lib, "big.mov");
    writeFileSync(path, Buffer.alloc(3 * 1024 * 1024));
    await expect(addFromFile(lib, path)).rejects.toThrow(/Video is 3 MB; the limit is 1 MB/);
    expect(readdirSync(join(lib, "refs"))).toEqual([]);
  });

  it("names the accepted types for anything else", async () => {
    await expect(addFromBuffer(lib, Buffer.from("x"), "song.mp3")).rejects.toThrow(
      /Unsupported file type: mp3\. Use an image or a video/,
    );
  });

  describe.skipIf(!hasFfmpeg)("with ffmpeg", () => {
    let clip: string;

    beforeEach(() => {
      clip = join(lib, "test-pattern.mp4");
      tinyMp4(clip);
    });

    it("records size and duration and saves a poster frame", async () => {
      createBoard(lib, "motion");
      const { id, ref } = await addFromFile(lib, clip, { board: "motion", boardNote: "the easing" });
      expect(ref).toMatchObject({ kind: "video", width: 64, height: 48, duration: 1 });
      expect(ref.poster).toBe(`files/${id.slice(0, 2)}/${id}.poster.jpg`);
      expect(statSync(join(lib, ref.poster!)).size).toBeGreaterThan(0);

      const short = id.slice(0, 6);
      const doc = outYaml(lib, "motion");
      expect(doc.refs[0]).toMatchObject({
        type: "video",
        file: `test-pattern-${short}.mp4`,
        poster: `test-pattern-${short}.poster.jpg`,
        duration: 1,
        board_note: "the easing",
      });
      expect(existsSync(join(lib, "out", "motion", `test-pattern-${short}.poster.jpg`))).toBe(true);
    });

    it("tags the poster frame and says it is from a video", async () => {
      const { id } = await addFromFile(lib, clip);
      let seen: DescribeInput | undefined;
      setTaggerAdapterForTests({
        id: "fake",
        check: async () => ({ ok: true, detail: "fake" }),
        describe: async (input) => {
          seen = input;
          return '{"tags":["test-pattern","colour-bars"],"description":"Colour bars."}';
        },
      });
      const tagged = await tagRef(lib, id);
      expect(seen?.imagePath).toMatch(/\.jpg$/);
      expect(seen?.prompt).toMatch(/frame of it/);
      expect(tagged.auto?.tags).toEqual(["test-pattern", "colour-bars"]);
    });

    it("makes a missing poster when it is next asked for", async () => {
      vi.stubEnv("REFS_FFMPEG", "refs-no-such-ffmpeg");
      vi.stubEnv("REFS_FFPROBE", "refs-no-such-ffprobe");
      const { id } = await addFromFile(lib, clip);
      expect(getRef(lib, id).poster).toBeUndefined();
      vi.unstubAllEnvs();
      const still = stillImagePath(lib, getRef(lib, id));
      expect(still && existsSync(still)).toBe(true);
      expect(getRef(lib, id)).toMatchObject({ poster: `files/${id.slice(0, 2)}/${id}.poster.jpg`, width: 64 });
    });

    it("moves the video and its poster to the trash on delete", async () => {
      createBoard(lib, "motion");
      const { id, ref } = await addFromFile(lib, clip, { board: "motion" });
      await deleteRef(lib, id);
      expect(existsSync(join(lib, ref.file!))).toBe(false);
      expect(existsSync(join(lib, ref.poster!))).toBe(false);
      expect(readdirSync(join(lib, ".trash")).sort()).toEqual(
        [`${id}.mp4`, `${id}.poster.jpg`, `${id}.yaml`].sort(),
      );
      await rebuildBoardOutput(lib, "motion");
      expect(readdirSync(join(lib, "out", "motion"))).toEqual(["refs.yaml"]);
    });
  });
});
