import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TaggerConfig } from "../../config.ts";
import { isModulePathAdapter } from "../../config.ts";
import { createClaudeCliAdapter } from "./claude-cli.ts";
import { createCodexCliAdapter } from "./codex-cli.ts";
import { createNoneAdapter } from "./none.ts";
import { createOpenAiCompatibleAdapter } from "./openai-compatible.ts";
import type { TaggerAdapter } from "./types.ts";

const BUILTIN_ADAPTERS = ["none", "openai-compatible", "claude-cli", "codex-cli"];

function adapterFromEnvPath(cfg: TaggerConfig): boolean {
  const raw = process.env.REFS_TAGGER?.trim();
  return Boolean(raw && isModulePathAdapter(raw) && cfg.adapter === raw);
}

async function loadModuleAdapter(
  cfg: TaggerConfig,
  lib: string,
): Promise<TaggerAdapter> {
  const rel = cfg.adapter;
  const abs = adapterFromEnvPath(cfg)
    ? resolve(process.cwd(), rel)
    : resolve(lib, rel);
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${rel}: ${msg}`);
  }
  const exported = (mod as { default?: unknown }).default ?? mod;
  const instance =
    typeof exported === "function"
      ? await (exported as (c: TaggerConfig) => TaggerAdapter | Promise<TaggerAdapter>)(cfg)
      : exported;
  if (
    !instance ||
    typeof instance !== "object" ||
    typeof (instance as TaggerAdapter).check !== "function" ||
    typeof (instance as TaggerAdapter).describe !== "function"
  ) {
    throw new Error(`${rel} does not export a tagger adapter`);
  }
  return instance as TaggerAdapter;
}

export async function createAdapter(
  cfg: TaggerConfig,
  lib: string,
): Promise<TaggerAdapter> {
  const name = cfg.adapter;
  if (name === "none") return createNoneAdapter();
  if (name === "openai-compatible") return createOpenAiCompatibleAdapter(cfg);
  if (name === "claude-cli") return createClaudeCliAdapter(cfg);
  if (name === "codex-cli") return createCodexCliAdapter(cfg);
  if (isModulePathAdapter(name)) {
    return loadModuleAdapter(cfg, lib);
  }
  throw new Error(
    `Unknown tagger adapter "${name}". Valid adapters: ${BUILTIN_ADAPTERS.join(", ")}, or a module path`,
  );
}

export type { TaggerAdapter, TaggerCheck, DescribeInput } from "./types.ts";
