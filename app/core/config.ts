import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import YAML from "yaml";

export type TaggerConfig = {
  adapter: string;
  preset?: string;
  base_url?: string;
  model?: string;
  api_key_env?: string;
  options?: Record<string, unknown>;
};

export type OutputMode = "links" | "copies" | "auto";

export type RefsConfig = {
  tagger: TaggerConfig;
  output: { mode: OutputMode };
};

const OUTPUT_MODES = new Set<OutputMode>(["links", "copies", "auto"]);

const TAGGER_KEYS = new Set([
  "adapter",
  "preset",
  "base_url",
  "model",
  "api_key_env",
  "options",
]);

const DEFAULT_CONFIG: RefsConfig = {
  tagger: { adapter: "none" },
  output: { mode: "auto" },
};

export function configPath(lib: string): string {
  return join(lib, "config.yaml");
}

function isModulePathAdapter(value: string): boolean {
  return (
    value.startsWith(".") ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    value.endsWith(".ts") ||
    value.endsWith(".js") ||
    value.endsWith(".mjs")
  );
}

function assertNoApiKeyInTagger(obj: unknown, fileLabel: string): void {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "api_key") {
      throw new Error(
        `${fileLabel}: put the key in an environment variable and name it with tagger.api_key_env`,
      );
    }
    assertNoApiKeyInTagger(val, fileLabel);
  }
}

function parseTaggerFromFile(
  raw: Record<string, unknown>,
  fileLabel: string,
): TaggerConfig {
  assertNoApiKeyInTagger(raw, fileLabel);
  for (const key of Object.keys(raw)) {
    if (!TAGGER_KEYS.has(key)) {
      throw new Error(`${fileLabel}: unknown field tagger.${key}`);
    }
  }
  const adapter = raw.adapter;
  if (adapter !== undefined && typeof adapter !== "string") {
    throw new Error(`${fileLabel}: tagger.adapter must be a string`);
  }
  if (typeof raw.preset !== "undefined" && typeof raw.preset !== "string") {
    throw new Error(`${fileLabel}: tagger.preset must be a string`);
  }
  if (typeof raw.base_url !== "undefined" && typeof raw.base_url !== "string") {
    throw new Error(`${fileLabel}: tagger.base_url must be a string`);
  }
  if (typeof raw.model !== "undefined" && typeof raw.model !== "string") {
    throw new Error(`${fileLabel}: tagger.model must be a string`);
  }
  if (
    typeof raw.api_key_env !== "undefined" &&
    typeof raw.api_key_env !== "string"
  ) {
    throw new Error(`${fileLabel}: tagger.api_key_env must be a string`);
  }
  if (raw.options !== undefined) {
    if (
      raw.options === null ||
      typeof raw.options !== "object" ||
      Array.isArray(raw.options)
    ) {
      throw new Error(`${fileLabel}: tagger.options must be an object`);
    }
  }
  const tagger: TaggerConfig = {
    adapter: typeof adapter === "string" ? adapter : DEFAULT_CONFIG.tagger.adapter,
  };
  if (typeof raw.preset === "string") tagger.preset = raw.preset;
  if (typeof raw.base_url === "string") tagger.base_url = raw.base_url;
  if (typeof raw.model === "string") tagger.model = raw.model;
  if (typeof raw.api_key_env === "string") tagger.api_key_env = raw.api_key_env;
  if (raw.options && typeof raw.options === "object" && !Array.isArray(raw.options)) {
    tagger.options = raw.options as Record<string, unknown>;
  }
  return tagger;
}

function parseFileConfig(lib: string): RefsConfig {
  const path = configPath(lib);
  const fileLabel = "config.yaml";
  if (!existsSync(path)) {
    return {
      tagger: { ...DEFAULT_CONFIG.tagger },
      output: { ...DEFAULT_CONFIG.output },
    };
  }
  let doc: unknown;
  try {
    doc = YAML.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${fileLabel}: ${msg}`);
  }
  if (doc === null || doc === undefined) {
    return {
      tagger: { ...DEFAULT_CONFIG.tagger },
      output: { ...DEFAULT_CONFIG.output },
    };
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`${fileLabel}: root must be an object`);
  }
  const root = doc as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (key !== "tagger" && key !== "output") {
      throw new Error(`${fileLabel}: unknown field ${key}`);
    }
  }
  const tagger =
    root.tagger !== undefined
      ? parseTaggerFromFile(
          typeof root.tagger === "object" && root.tagger !== null && !Array.isArray(root.tagger)
            ? (root.tagger as Record<string, unknown>)
            : (() => {
                throw new Error(`${fileLabel}: tagger must be an object`);
              })(),
          fileLabel,
        )
      : { ...DEFAULT_CONFIG.tagger };

  let mode: OutputMode = DEFAULT_CONFIG.output.mode;
  if (root.output !== undefined) {
    if (
      typeof root.output !== "object" ||
      root.output === null ||
      Array.isArray(root.output)
    ) {
      throw new Error(`${fileLabel}: output must be an object`);
    }
    const out = root.output as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      if (key !== "mode") {
        throw new Error(`${fileLabel}: unknown field output.${key}`);
      }
    }
    if (out.mode !== undefined) {
      if (typeof out.mode !== "string" || !OUTPUT_MODES.has(out.mode as OutputMode)) {
        throw new Error(`${fileLabel}: output.mode must be links, copies, or auto`);
      }
      mode = out.mode as OutputMode;
    }
  }

  return { tagger, output: { mode } };
}

const PRESETS = ["omlx", "ollama", "lmstudio", "openrouter", "openai"];

// The short names accepted by REFS_TAGGER and `refs setup --tagger`: a preset,
// claude, codex, none, an adapter id, or a module path.
export function taggerFromName(name: string): Pick<TaggerConfig, "adapter" | "preset"> {
  const value = name.trim();
  const lower = value.toLowerCase();
  if (PRESETS.includes(lower)) return { adapter: "openai-compatible", preset: lower };
  if (lower === "claude") return { adapter: "claude-cli" };
  if (lower === "codex") return { adapter: "codex-cli" };
  if (lower === "none") return { adapter: "none" };
  return { adapter: value };
}

function applyEnvTagger(tagger: TaggerConfig): TaggerConfig {
  const raw = process.env.REFS_TAGGER;
  if (!raw) return tagger;
  const { adapter, preset } = taggerFromName(raw);
  return { ...tagger, adapter, preset };
}

export function loadConfig(lib: string): RefsConfig {
  const fromFile = parseFileConfig(lib);
  let tagger = applyEnvTagger(fromFile.tagger);

  if (process.env.REFS_TAGGER_MODEL) {
    tagger = { ...tagger, model: process.env.REFS_TAGGER_MODEL };
  }
  if (process.env.REFS_TAGGER_BASE_URL) {
    tagger = { ...tagger, base_url: process.env.REFS_TAGGER_BASE_URL };
  }
  if (process.env.REFS_TAGGER_API_KEY_ENV) {
    tagger = { ...tagger, api_key_env: process.env.REFS_TAGGER_API_KEY_ENV };
  }

  let mode = fromFile.output.mode;
  if (process.env.REFS_OUTPUT) {
    const m = process.env.REFS_OUTPUT;
    if (!OUTPUT_MODES.has(m as OutputMode)) {
      throw new Error(`config.yaml: output.mode must be links, copies, or auto`);
    }
    mode = m as OutputMode;
  }

  return { tagger, output: { mode } };
}

export { isModulePathAdapter };
