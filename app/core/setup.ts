import { existsSync, readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import {
  configPath,
  loadConfig,
  taggerFromName,
  type TaggerConfig,
} from "./config.ts";
import { checkTagger } from "./tagger.ts";
import { createClaudeCliAdapter } from "./tagger/adapters/claude-cli.ts";
import { createCodexCliAdapter } from "./tagger/adapters/codex-cli.ts";
import { createOpenAiCompatibleAdapter } from "./tagger/adapters/openai-compatible.ts";
import type { TaggerAdapter } from "./tagger/adapters/index.ts";
import { ensureLibraryDirs } from "./paths.ts";

export type Detected = {
  tagger: string;
  adapter: string;
  preset?: string;
  ok: boolean;
  detail: string;
  models?: string[];
};

export type SetupResult = {
  library: string;
  configPath: string;
  created: boolean;
  tagger: TaggerConfig;
  detected: Detected[];
  next: string[];
};

export type SetupOpts = {
  tagger?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
};

export type DetectProbe = {
  tagger: string;
  adapter: "openai-compatible" | "claude-cli" | "codex-cli";
  preset?: string;
  base_url?: string;
};

const DEFAULT_CONFIG_TEMPLATE = `# Tagger — see README "Tagging"
tagger:
  adapter: none
output:
  # links | copies | auto (try symlink, then hard link, then copy)
  mode: auto
`;

function requiresModel(mapped: Pick<TaggerConfig, "adapter">): boolean {
  return mapped.adapter === "openai-compatible";
}

function adapterForProbe(probe: DetectProbe): TaggerAdapter {
  if (probe.adapter === "openai-compatible") {
    return createOpenAiCompatibleAdapter({
      adapter: "openai-compatible",
      preset: probe.preset,
      base_url: probe.base_url,
    });
  }
  if (probe.adapter === "claude-cli") return createClaudeCliAdapter({ adapter: "claude-cli" });
  return createCodexCliAdapter({ adapter: "codex-cli" });
}

function defaultProbes(): DetectProbe[] {
  return [
    { tagger: "omlx", adapter: "openai-compatible", preset: "omlx" },
    { tagger: "ollama", adapter: "openai-compatible", preset: "ollama" },
    { tagger: "lmstudio", adapter: "openai-compatible", preset: "lmstudio" },
    { tagger: "claude", adapter: "claude-cli" },
    { tagger: "codex", adapter: "codex-cli" },
  ];
}

export async function detectTaggers(probes?: DetectProbe[]): Promise<Detected[]> {
  const list = probes ?? defaultProbes();
  const results = await Promise.all(
    list.map(async (probe) => {
      const adapter = adapterForProbe(probe);
      const check = await adapter.check();
      return {
        tagger: probe.tagger,
        adapter: probe.adapter,
        preset: probe.preset,
        ok: check.ok,
        detail: check.detail,
        models: check.models,
      };
    }),
  );
  return results;
}

function writeDefaultConfig(path: string): void {
  writeFileSync(path, DEFAULT_CONFIG_TEMPLATE, "utf8");
}

// Replaces the tagger section with exactly what was asked for, so switching
// tagger never carries over a model or URL meant for the previous one.
function updateTaggerInConfig(
  path: string,
  mapped: Pick<TaggerConfig, "adapter" | "preset">,
  opts: SetupOpts,
): void {
  const raw = readFileSync(path, "utf8");
  const doc = YAML.parseDocument(raw);

  const taggerNode = doc.get("tagger") as YAML.YAMLMap | undefined;
  if (!taggerNode || !(taggerNode instanceof YAML.YAMLMap)) {
    doc.set("tagger", new YAML.YAMLMap());
  }

  const fields: Record<string, string | undefined> = {
    adapter: mapped.adapter,
    preset: mapped.preset,
    base_url: opts.baseUrl,
    model: opts.model,
    api_key_env: opts.apiKeyEnv,
  };

  const tagger = doc.get("tagger") as YAML.YAMLMap;
  for (const key of ["adapter", "preset", "base_url", "model", "api_key_env"]) {
    const val = fields[key];
    if (val === undefined) {
      tagger.delete(key);
    } else {
      tagger.set(key, val);
    }
  }

  writeFileSync(path, String(doc), "utf8");
}

async function buildNext(
  lib: string,
  detected: Detected[],
  tagger: TaggerConfig,
): Promise<string[]> {
  const next: string[] = [];
  let configuredReachable = false;
  if (tagger.adapter !== "none") {
    const check = await checkTagger(lib);
    configuredReachable = check.ok;
  }
  if (!configuredReachable) {
    for (const d of detected) {
      if (d.ok && d.models && d.models.length > 0) {
        next.push(
          `pnpm refs setup --tagger ${d.tagger} --model ${d.models[0]}`,
        );
      }
    }
  }
  next.push("pnpm refs doctor");
  next.push("pnpm dev");
  return next;
}

export async function runSetup(
  lib: string,
  opts: SetupOpts = {},
): Promise<SetupResult> {
  ensureLibraryDirs(lib);
  const cfgPath = configPath(lib);
  let created = false;
  if (!existsSync(cfgPath)) {
    writeDefaultConfig(cfgPath);
    created = true;
  }

  if (opts.tagger !== undefined) {
    const mapped = taggerFromName(opts.tagger);
    if (requiresModel(mapped) && !opts.model) {
      let modelHint = "";
      if (mapped.adapter === "openai-compatible") {
        const probe: DetectProbe = {
          tagger: opts.tagger,
          adapter: "openai-compatible",
          preset: mapped.preset,
          base_url: opts.baseUrl,
        };
        const check = await adapterForProbe(probe).check();
        if (check.models && check.models.length > 0) {
          modelHint = `: ${check.models.join(", ")}`;
        }
      }
      throw new Error(`--tagger ${opts.tagger} requires --model${modelHint}`);
    }
    updateTaggerInConfig(cfgPath, mapped, opts);
  }

  const detected = await detectTaggers();
  const tagger = loadConfig(lib).tagger;
  const next = await buildNext(lib, detected, tagger);

  return {
    library: lib,
    configPath: cfgPath,
    created,
    tagger,
    detected,
    next,
  };
}
