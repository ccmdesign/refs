import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleAdapter } from "../core/tagger/adapters/openai-compatible.ts";
import { createNoneAdapter } from "../core/tagger/adapters/none.ts";
import { createAdapter } from "../core/tagger/adapters/index.ts";
import sharp from "sharp";
import { cleanupLibrary, tempLibrary } from "./helpers.ts";

function withMockServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        handler(req, res, Buffer.concat(chunks).toString("utf8"));
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({
        base: `http://127.0.0.1:${addr.port}/v1`,
        close: () =>
          new Promise((r, j) => server.close((err) => (err ? j(err) : r()))),
      });
    });
  });
}

describe("adapters", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("none adapter describe throws setup message", async () => {
    const a = createNoneAdapter();
    await expect(a.describe({ prompt: "p", imagePath: "/x" })).rejects.toThrow(
      /pnpm refs setup/,
    );
  });

  it("openai-compatible sends model and image; auth only when env set", async () => {
    let lastAuth: string | undefined;
    let lastBody: Record<string, unknown> | undefined;
    const mock = await withMockServer((req, res, body) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "vision-1" }] }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        lastAuth = req.headers.authorization;
        lastBody = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '{"tags":[],"description":"ok"}' } }],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const lib = tempLibrary();
    const img = join(lib, "t.jpg");
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toFile(img);

    const adapter = createOpenAiCompatibleAdapter({
      adapter: "openai-compatible",
      base_url: mock.base,
      model: "vision-1",
      api_key_env: "TEST_OPENAI_KEY",
    });

    vi.stubEnv("TEST_OPENAI_KEY", "test-key");
    await adapter.describe({ prompt: "describe", imagePath: img, model: "vision-1" });
    expect(lastAuth).toBe("Bearer test-key");
    expect(lastBody?.model).toBe("vision-1");
    const messages = (lastBody?.messages as unknown[]) ?? [];
    const content = (messages[0] as { content: unknown[] }).content;
    const imagePart = content.find(
      (p) => p && typeof p === "object" && (p as { type?: string }).type === "image_url",
    ) as { image_url?: { url?: string } };
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);

    vi.stubEnv("TEST_OPENAI_KEY", "");
    lastAuth = undefined;
    await adapter.describe({ prompt: "describe", imagePath: img, model: "vision-1" });
    expect(lastAuth).toBeUndefined();

    await mock.close();
    cleanupLibrary(lib);
  });

  it("openai-compatible check: model found, missing, connection refused", async () => {
    const mock = await withMockServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const adapter = createOpenAiCompatibleAdapter({
      adapter: "openai-compatible",
      base_url: mock.base,
      model: "a",
    });
    const ok = await adapter.check();
    expect(ok.ok).toBe(true);
    expect(ok.detail).toContain("2 models");

    const missing = createOpenAiCompatibleAdapter({
      adapter: "openai-compatible",
      base_url: mock.base,
      model: "missing",
    });
    const bad = await missing.check();
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('model "missing" not found');
    await mock.close();

    const dead = createOpenAiCompatibleAdapter({
      adapter: "openai-compatible",
      base_url: "http://127.0.0.1:1/v1",
    });
    const refused = await dead.check();
    expect(refused.ok).toBe(false);
    expect(refused.detail).toMatch(/cannot reach/);
  });

  it("loads module adapter object and factory", async () => {
    const lib = tempLibrary();
    const objectPath = join(lib, "obj.mjs");
    writeFileSync(
      objectPath,
      `export default {
  id: "custom",
  async check() { return { ok: true, detail: "custom ok" }; },
  async describe() { return '{"tags":["x"],"description":"d"}'; },
};`,
    );
    const a1 = await createAdapter({ adapter: "./obj.mjs" }, lib);
    expect(await a1.check()).toMatchObject({ ok: true, detail: "custom ok" });

    const factoryPath = join(lib, "fact.mjs");
    writeFileSync(
      factoryPath,
      `export default function (cfg) {
  return {
    id: "factory",
    async check() { return { ok: true, detail: cfg.model ?? "no-model" }; },
    async describe() { return '{"tags":[],"description":""}'; },
  };
}`,
    );
    const a2 = await createAdapter(
      { adapter: "./fact.mjs", model: "m1" },
      lib,
    );
    expect((await a2.check()).detail).toBe("m1");

    const badPath = join(lib, "bad.mjs");
    writeFileSync(badPath, `export default { id: "nope" };`);
    await expect(createAdapter({ adapter: "./bad.mjs" }, lib)).rejects.toThrow(
      /does not export a tagger adapter/,
    );
    cleanupLibrary(lib);
  });
});
