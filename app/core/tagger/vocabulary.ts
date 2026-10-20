import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { vocabularyPath } from "../paths.ts";

export function readVocabulary(lib: string): string[] {
  const path = vocabularyPath(lib);
  if (!existsSync(path)) return [];
  const doc = YAML.parse(readFileSync(path, "utf8"));
  if (Array.isArray(doc)) {
    return doc.map((t) => String(t).trim()).filter(Boolean);
  }
  if (doc && typeof doc === "object" && Array.isArray((doc as { tags?: unknown }).tags)) {
    return (doc as { tags: unknown[] }).tags
      .map((t) => String(t).trim())
      .filter(Boolean);
  }
  return [];
}

export function buildTagPrompt(vocabulary: string[], opts: { videoFrame?: boolean } = {}): string {
  const vocabBlock =
    vocabulary.length > 0
      ? `Prefer tags from this vocabulary when they fit:\n${vocabulary.map((t) => `- ${t}`).join("\n")}\nAdd a new tag only when none of these fit.\n`
      : "";
  const subject = opts.videoFrame
    ? "You are tagging a design reference video from one frame of it. Describe the video as far as the frame shows it."
    : "You are tagging a design reference image.";
  return `${subject}

Respond with JSON only, no other text, in this exact shape:
{"tags": ["tag1", "tag2"], "description": "One sentence here."}

Requirements:
- Provide 4 to 8 lowercase tags covering visual style, layout, typography, colour and medium.
- Write one sentence describing what is visually distinctive about the reference.
${vocabBlock}`.trim();
}
