import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configPath, loadConfig } from "../core/config.ts";
import { cleanupLibrary, tempLibrary } from "./helpers.ts";
import YAML from "yaml";

describe("config", () => {
  let lib: string;

  beforeEach(() => {
    lib = tempLibrary();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanupLibrary(lib);
    vi.unstubAllEnvs();
  });

  it("uses defaults when config.yaml is missing", () => {
    const cfg = loadConfig(lib);
    expect(cfg.tagger.adapter).toBe("none");
    expect(cfg.output.mode).toBe("auto");
  });

  it("loads a valid file", () => {
    writeFileSync(
      configPath(lib),
      YAML.stringify({
        tagger: {
          adapter: "openai-compatible",
          preset: "ollama",
          model: "llava",
        },
        output: { mode: "links" },
      }),
    );
    const cfg = loadConfig(lib);
    expect(cfg.tagger.adapter).toBe("openai-compatible");
    expect(cfg.tagger.preset).toBe("ollama");
    expect(cfg.tagger.model).toBe("llava");
    expect(cfg.output.mode).toBe("links");
  });

  it("rejects unknown top-level keys", () => {
    writeFileSync(configPath(lib), YAML.stringify({ server: { port: 1 } }));
    expect(() => loadConfig(lib)).toThrow(/unknown field server/);
  });

  it("rejects wrong tagger.model type", () => {
    writeFileSync(
      configPath(lib),
      YAML.stringify({ tagger: { adapter: "none", model: 42 } }),
    );
    expect(() => loadConfig(lib)).toThrow(
      /config\.yaml: tagger\.model must be a string/,
    );
  });

  it("rejects api_key in tagger", () => {
    writeFileSync(
      configPath(lib),
      YAML.stringify({ tagger: { adapter: "openai-compatible", api_key: "secret" } }),
    );
    expect(() => loadConfig(lib)).toThrow(/api_key_env/);
  });

  it("allows unknown keys inside tagger.options", () => {
    writeFileSync(
      configPath(lib),
      YAML.stringify({
        tagger: { adapter: "none", options: { custom_flag: true } },
      }),
    );
    expect(loadConfig(lib).tagger.options).toEqual({ custom_flag: true });
  });

  it("maps REFS_TAGGER legacy omlx to openai-compatible preset", () => {
    vi.stubEnv("REFS_TAGGER", "omlx");
    expect(loadConfig(lib).tagger).toMatchObject({
      adapter: "openai-compatible",
      preset: "omlx",
    });
  });

  it("maps REFS_TAGGER legacy ollama", () => {
    vi.stubEnv("REFS_TAGGER", "ollama");
    expect(loadConfig(lib).tagger.preset).toBe("ollama");
    expect(loadConfig(lib).tagger.adapter).toBe("openai-compatible");
  });

  it("maps REFS_TAGGER legacy lmstudio, openrouter, and openai", () => {
    for (const preset of ["lmstudio", "openrouter", "openai"]) {
      vi.stubEnv("REFS_TAGGER", preset);
      expect(loadConfig(lib).tagger).toMatchObject({
        adapter: "openai-compatible",
        preset,
      });
    }
  });

  it("maps REFS_TAGGER module paths ending in .js", () => {
    vi.stubEnv("REFS_TAGGER", "adapter.js");
    expect(loadConfig(lib).tagger.adapter).toBe("adapter.js");
  });

  it("maps REFS_TAGGER legacy claude and codex", () => {
    vi.stubEnv("REFS_TAGGER", "claude");
    expect(loadConfig(lib).tagger.adapter).toBe("claude-cli");
    vi.stubEnv("REFS_TAGGER", "codex");
    expect(loadConfig(lib).tagger.adapter).toBe("codex-cli");
  });

  it("maps REFS_TAGGER none", () => {
    vi.stubEnv("REFS_TAGGER", "none");
    expect(loadConfig(lib).tagger.adapter).toBe("none");
  });

  it("detects module path in REFS_TAGGER", () => {
    vi.stubEnv("REFS_TAGGER", "./my-tagger.ts");
    expect(loadConfig(lib).tagger.adapter).toBe("./my-tagger.ts");
    vi.stubEnv("REFS_TAGGER", "/abs/tagger.mjs");
    expect(loadConfig(lib).tagger.adapter).toBe("/abs/tagger.mjs");
  });

  it("overrides model from REFS_TAGGER_MODEL", () => {
    writeFileSync(
      configPath(lib),
      YAML.stringify({ tagger: { adapter: "none", model: "from-file" } }),
    );
    vi.stubEnv("REFS_TAGGER_MODEL", "from-env");
    expect(loadConfig(lib).tagger.model).toBe("from-env");
  });
});
