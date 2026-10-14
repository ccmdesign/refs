import { validateBoardPath } from "~~/core/util.ts";

const REF_ID_RE = /^[a-f0-9]{12}$/;

export function assertRefId(id: string): void {
  if (!REF_ID_RE.test(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ref id" });
  }
}

export function assertBoardPath(boardPath: string): void {
  try {
    validateBoardPath(boardPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid board path";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
}

export function parseBoardQuery(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw);
  assertBoardPath(s);
  return s;
}
