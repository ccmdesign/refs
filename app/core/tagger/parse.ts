export type ParsedTagResult = {
  tags: string[];
  description: string;
};

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/redacted_thinking>/gi;
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("Tagger response contains no JSON object");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("Tagger response JSON object is incomplete");
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("Tagger JSON must include a tags array");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 10) break;
  }
  if (out.length === 0) {
    throw new Error("Tagger JSON must include at least one tag");
  }
  return out;
}

export function parseTaggerResponse(text: string): ParsedTagResult {
  let cleaned = text.replace(THINK_BLOCK_RE, "");
  cleaned = cleaned.replace(FENCE_RE, (_m, inner: string) => inner);
  const jsonText = extractFirstJsonObject(cleaned);
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("Tagger response JSON is invalid");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Tagger JSON must be an object");
  }
  const obj = data as Record<string, unknown>;
  const tags = normalizeTags(obj.tags);
  if (typeof obj.description !== "string" || !obj.description.trim()) {
    throw new Error("Tagger JSON must include a non-empty description string");
  }
  return { tags, description: obj.description.trim() };
}
