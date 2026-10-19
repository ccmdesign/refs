import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { BoardData, RefData } from "./types.ts";

const REF_KEY_ORDER = [
  "id",
  "kind",
  "file",
  "poster",
  "url",
  "title",
  "source",
  "note",
  "tags",
  "auto",
  "width",
  "height",
  "duration",
  "added",
] as const;

function orderedRef(doc: RefData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REF_KEY_ORDER) {
    const val = doc[key as keyof RefData];
    if (val === undefined || val === null) continue;
    if (key === "tags" && Array.isArray(val) && val.length === 0) continue;
    if (key === "auto" && typeof val === "object" && val !== null) {
      const auto = val as Record<string, unknown>;
      const autoOut: Record<string, unknown> = {};
      for (const ak of ["tags", "description", "model", "at"] as const) {
        const av = auto[ak];
        if (av === undefined || av === null) continue;
        if (ak === "tags" && Array.isArray(av) && av.length === 0) continue;
        autoOut[ak] = av;
      }
      if (Object.keys(autoOut).length > 0) out.auto = autoOut;
      continue;
    }
    out[key] = val;
  }
  return out;
}

function orderedBoardEntry(entry: {
  id: string;
  note?: string;
  key?: boolean;
  added: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { id: entry.id, added: entry.added };
  if (entry.note) out.note = entry.note;
  if (entry.key) out.key = entry.key;
  return out;
}

function orderedBoard(doc: BoardData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (doc.brief) out.brief = doc.brief;
  out.refs = doc.refs.map(orderedBoardEntry);
  return out;
}

export function stringifyRef(doc: RefData): string {
  return YAML.stringify(orderedRef(doc), { lineWidth: 0 }).trimEnd() + "\n";
}

export function stringifyBoard(doc: BoardData): string {
  return YAML.stringify(orderedBoard(doc), { lineWidth: 0 }).trimEnd() + "\n";
}

export function parseRef(content: string): RefData {
  const raw = YAML.parse(content) as RefData;
  if (!raw?.id) throw new Error("Invalid ref file: missing id");
  return raw;
}

export function parseBoard(content: string): BoardData {
  const raw = YAML.parse(content) as BoardData;
  return {
    brief: raw.brief,
    refs: Array.isArray(raw.refs) ? raw.refs : [],
  };
}

export function readRefFile(path: string): RefData {
  return parseRef(readFileSync(path, "utf8"));
}

export function readBoardFile(path: string): BoardData {
  return parseBoard(readFileSync(path, "utf8"));
}

export function stringifyOutput(doc: Record<string, unknown>): string {
  return YAML.stringify(doc, { lineWidth: 0 }).trimEnd() + "\n";
}
