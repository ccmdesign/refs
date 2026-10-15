import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLibrary, tempLibrary, tinyPng } from "./helpers.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const refsBin = join(appDir, "bin/refs.ts");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function runRefs(
  lib: string,
  port: number,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, REFS_LIBRARY: lib, REFS_PORT: String(port) };
    // Run as a fresh install would: no tagger or output settings from the parent shell.
    for (const key of Object.keys(env)) {
      if (key.startsWith("REFS_TAGGER") || key === "REFS_OUTPUT") delete env[key];
    }

    const child = spawn(process.execPath, [refsBin, ...args], {
      cwd: appDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function refsJson<T>(lib: string, port: number, args: string[]): Promise<T> {
  const { stdout, stderr, code } = await runRefs(lib, port, args);
  if (code !== 0) {
    throw new Error(`refs ${args.join(" ")} exited ${code}\n${stderr}\n${stdout}`);
  }
  return JSON.parse(stdout.trim()) as T;
}

describe("e2e CLI", () => {
  let lib: string;
  let port: number;

  beforeEach(async () => {
    lib = tempLibrary();
    port = await freePort();
  });

  afterEach(() => {
    cleanupLibrary(lib);
  });

  it(
    "setup, add, doctor, rebuild, show and path on a temp library",
    async () => {
      const setup = await refsJson<{
        created: boolean;
        tagger: { adapter: string };
      }>(lib, port, ["setup", "--json"]);
      expect(setup.created).toBe(true);
      expect(setup.tagger.adapter).toBe("none");

      let run = await runRefs(lib, port, ["board", "create", "posters"]);
      expect(run.code).toBe(0);

      const pngPath = join(lib, "pixel.png");
      await tinyPng(pngPath);
      run = await runRefs(lib, port, [
        "add",
        pngPath,
        "--board",
        "posters",
        "--board-note",
        "take the grid",
      ]);
      expect(run.code).toBe(0);

      const doctor = await refsJson<{ ok: boolean; checks: { status: string }[] }>(
        lib,
        port,
        ["doctor", "--json"],
      );
      expect(doctor.checks.every((c) => c.status !== "fail")).toBe(true);

      run = await runRefs(lib, port, ["rebuild"]);
      expect(run.code).toBe(0);

      const shown = await refsJson<{ refs: { board_note?: string }[] }>(lib, port, [
        "show",
        "posters",
        "--json",
      ]);
      expect(shown.refs).toHaveLength(1);
      expect(shown.refs[0]?.board_note).toBe("take the grid");

      run = await runRefs(lib, port, ["path", "posters"]);
      expect(run.code).toBe(0);
      const boardDir = run.stdout.trim();
      expect(existsSync(join(boardDir, "refs.yaml"))).toBe(true);

      const imageNames = readdirSync(boardDir).filter((n) => n !== "refs.yaml");
      expect(imageNames.length).toBeGreaterThanOrEqual(1);
      const imagePath = join(boardDir, imageNames[0]!);
      expect(existsSync(imagePath)).toBe(true);
      expect(statSync(imagePath).size).toBeGreaterThan(0);
    },
    60_000,
  );
});
