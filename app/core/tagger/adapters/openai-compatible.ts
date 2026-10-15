import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaggerConfig } from "../../config.ts";
import type { TaggerAdapter } from "./types.ts";

const PRESET_URLS: Record<string, { base: string; defaultKeyEnv?: string }> = {
  omlx: { base: "http://127.0.0.1:9999/v1" },
  ollama: { base: "http://127.0.0.1:11434/v1" },
  lmstudio: { base: "http://127.0.0.1:1234/v1" },
  openrouter: { base: "https://openrouter.ai/api/v1", defaultKeyEnv: "OPENROUTER_API_KEY" },
  openai: { base: "https://api.openai.com/v1", defaultKeyEnv: "OPENAI_API_KEY" },
};

function readOmlxSettingsKey(): string | undefined {
  try {
    const path = join(homedir(), ".omlx", "settings.json");
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      auth?: { api_key?: string };
    };
    const key = raw.auth?.api_key;
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

function resolveBaseUrl(cfg: TaggerConfig): { base: string; label: string } {
  if (cfg.base_url) {
    const base = cfg.base_url.replace(/\/$/, "");
    return { base, label: base };
  }
  const preset = cfg.preset?.toLowerCase();
  if (preset === "omlx") {
    const base = (process.env.OMLX_BASE_URL ?? PRESET_URLS.omlx.base).replace(/\/$/, "");
    return { base, label: `omlx at ${base}` };
  }
  if (preset && PRESET_URLS[preset]) {
    const base = PRESET_URLS[preset].base.replace(/\/$/, "");
    return { base, label: `${preset} at ${base}` };
  }
  throw new Error("tagger.base_url or tagger.preset is required");
}

function resolveApiKey(cfg: TaggerConfig): string | undefined {
  const envName = cfg.api_key_env;
  if (envName) {
    const v = process.env[envName];
    if (v) return v;
  }
  const preset = cfg.preset?.toLowerCase();
  if (preset === "omlx") {
    const fromOmlx = process.env.OMLX_API_KEY;
    if (fromOmlx) return fromOmlx;
    return readOmlxSettingsKey();
  }
  if (preset && PRESET_URLS[preset]?.defaultKeyEnv && !cfg.api_key_env) {
    const v = process.env[PRESET_URLS[preset].defaultKeyEnv!];
    if (v) return v;
  }
  return undefined;
}

export function createOpenAiCompatibleAdapter(cfg: TaggerConfig): TaggerAdapter {
  let resolvedBase: { base: string; label: string } | undefined;

  function getBase(): { base: string; label: string } {
    if (!resolvedBase) resolvedBase = resolveBaseUrl(cfg);
    return resolvedBase;
  }

  return {
    id: "openai-compatible",
    async check() {
      const { base, label } = getBase();
      try {
        const headers: Record<string, string> = {};
        const apiKey = resolveApiKey(cfg);
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

        const res = await fetch(`${base}/models`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          return {
            ok: false,
            detail: `cannot reach ${base}: HTTP ${res.status}`,
          };
        }
        const data = (await res.json()) as {
          data?: Array<{ id?: string }>;
        };
        const models = (data.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string");
        if (cfg.model && !models.includes(cfg.model)) {
          return {
            ok: false,
            detail: `model "${cfg.model}" not found; available: ${models.join(", ")}`,
            models,
          };
        }
        return {
          ok: true,
          detail: `${label}: ${models.length} models`,
          models,
        };
      } catch (err) {
        // fetch() wraps network errors; the useful code (ECONNREFUSED…) is on the cause.
        const e = err as { code?: unknown; cause?: { code?: unknown }; message?: string };
        const code = String(e?.cause?.code ?? e?.code ?? e?.message ?? err);
        return { ok: false, detail: `cannot reach ${base}: ${code}` };
      }
    },
    async describe(input) {
      const model = input.model ?? cfg.model;
      if (!model) {
        throw new Error("tagger.model is required for openai-compatible");
      }
      const { base } = getBase();
      const apiKey = resolveApiKey(cfg);
      const jpeg = await readFile(input.imagePath);
      const b64 = jpeg.toString("base64");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1500,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: input.prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${b64}` },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`openai-compatible request failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: {
          message?: { content?: string | Array<{ type?: string; text?: string }> };
        }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((p) => (p && typeof p.text === "string" ? p.text : ""))
          .join("\n");
      }
      throw new Error("openai-compatible response had no message content");
    },
  };
}
