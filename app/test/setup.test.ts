import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath } from "../core/config.ts";
import { detectTaggers, runSetup } from "../core/setup.ts";
import { cleanupLibrary, tempLibrary } from "./helpers.ts";

describe("setup", () => {
  let lib: string;

  beforeEach(() => {
    lib = tempLibrary();
  });

  afterEach(() => {
    cleanupLibrary(lib);
  });

  it("creates config.yaml with adapter none and comments", async () => {
    const result = await runSetup(lib);
    expect(result.created).toBe(true);
    const raw = readFileSync(configPath(lib), "utf8");
    expect(raw).toContain("adapter: none");
    expect(raw).toContain('README "Tagging"');
    expect(raw).toContain("mode: auto");
  });

  it("second run keeps config byte-for-byte", async () => {
    await runSetup(lib);
    const before = readFileSync(configPath(lib), "utf8");
    await runSetup(lib);
    const after = readFileSync(configPath(lib), "utf8");
    expect(after).toBe(before);
  });

  it("updates only tagger and preserves comments and output", async () => {
    writeFileSync(
      configPath(lib),
      `# custom keep me
tagger:
  adapter: none
output:
  mode: copies
`,
      "utf8",
    );
    await runSetup(lib, { tagger: "ollama", model: "m" });
    const raw = readFileSync(configPath(lib), "utf8");
    expect(raw).toContain("# custom keep me");
    expect(raw).toContain("mode: copies");
    expect(raw).toContain("preset: ollama");
    expect(raw).toContain("model: m");
    expect(raw).toContain("adapter: openai-compatible");
  });

  it("switching tagger drops the previous model and URL", async () => {
    await runSetup(lib, { tagger: "ollama", model: "llava", baseUrl: "http://127.0.0.1:1/v1" });
    await runSetup(lib, { tagger: "claude" });
    const text = readFileSync(configPath(lib), "utf8");
    expect(text).toContain("adapter: claude-cli");
    expect(text).not.toContain("llava");
    expect(text).not.toContain("base_url");
    expect(text).not.toContain("preset");
  });

  it("refuses --tagger ollama without --model", async () => {
    await runSetup(lib);
    await expect(runSetup(lib, { tagger: "ollama" })).rejects.toThrow(
      /--tagger ollama requires --model/,
    );
  });

  it("detectTaggers returns models from a mock server", async () => {
    let server: Server | undefined;
    const models = { data: [{ id: "mock-vision" }, { id: "other" }] };
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === "/v1/models" || req.url === "/models") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(models));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}/v1`;
    const detected = await detectTaggers([
      {
        tagger: "mock",
        adapter: "openai-compatible",
        base_url: base,
      },
    ]);
    server?.close();
    expect(detected[0]?.ok).toBe(true);
    expect(detected[0]?.models).toContain("mock-vision");
  });

  it("detectTaggers reports not ok on a closed port", async () => {
    const detected = await detectTaggers([
      {
        tagger: "dead",
        adapter: "openai-compatible",
        base_url: "http://127.0.0.1:1/v1",
      },
    ]);
    expect(detected[0]?.ok).toBe(false);
  });
});
