import { join } from "node:path";
import { getBoard, listBoards } from "~~/core/board.ts";
import { getGeneratedBoardPath, rebuildBoardOutput } from "~~/core/output.ts";
import { appDir } from "~~/core/paths.ts";
import { getRef } from "~~/core/ref.ts";
import { isSubBoardPath } from "~~/core/util.ts";
import { boardsContainingRef } from "../utils/boards.ts";
import { assertRefId, parseBoardQuery } from "../utils/validate.ts";
import { library } from "../utils/lib.ts";

const CAUTION =
  "These are other people's work. Use them to understand the direction; do not reproduce any one of them.";
const ASK = "What I want you to do:\n";

function cli() {
  return `node "${join(appDir(), "bin", "refs.ts")}"`;
}

async function boardPrompt(lib: string, board: string): Promise<string> {
  const data = getBoard(lib, board);
  await rebuildBoardOutput(lib, board);
  const subs = listBoards(lib).filter((b) => isSubBoardPath(board, b));
  const count = data.refs.length;
  const lines = [
    "Use these design references for the work I describe at the end.",
    "",
    `Board: ${board} (${count} ${count === 1 ? "ref" : "refs"})`,
    `Folder: ${getGeneratedBoardPath(lib, board)}`,
    "",
    "Read refs.yaml in that folder first, in this order: parent_briefs (constraints from the boards above), brief (what this board is for), then refs, where key refs come first. Then look at the images in the folder, starting with the key refs.",
    "For each ref, board_note says what to take from it for this board and outranks note. machine_tags and description were written by a model; treat them as hints.",
  ];
  if (subs.length) {
    lines.push(
      "",
      count
        ? "Sub-boards, each with its own folder and refs.yaml:"
        : "This board holds no refs of its own. They are on its sub-boards, each with its own folder and refs.yaml:",
    );
    for (const sub of subs) {
      await rebuildBoardOutput(lib, sub);
      lines.push(`- ${sub} (${getBoard(lib, sub).refs.length}): ${getGeneratedBoardPath(lib, sub)}`);
    }
  }
  lines.push("", CAUTION, "", `To add a reference you find along the way: ${cli()} add <file|url> --board "${board}" --board-note "<what to take from it>"`, "", ASK);
  return lines.join("\n");
}

function refPrompt(lib: string, id: string, board?: string): string {
  const ref = getRef(lib, id);
  const lines = ["Use this design reference for the work I describe at the end.", ""];
  if (ref.title) lines.push(`Title: ${ref.title}`);
  if (ref.file) lines.push(`Image: ${join(lib, ref.file)}`);
  if (ref.url) lines.push(`Link: ${ref.url}`);
  if (ref.source) lines.push(`Source: ${ref.source}`);
  if (ref.note) lines.push(`Note: ${ref.note}`);
  const entry = board ? getBoard(lib, board).refs.find((r) => r.id === id) : undefined;
  if (entry?.note) lines.push(`Note for the board ${board} (outranks the note above): ${entry.note}`);
  if (entry?.key) lines.push(`It is marked as a key ref on ${board}.`);
  if (ref.tags?.length) lines.push(`Tags: ${ref.tags.join(", ")}`);
  if (ref.auto?.tags?.length) lines.push(`Model-written tags (hints): ${ref.auto.tags.join(", ")}`);
  if (ref.auto?.description) lines.push(`Model-written description (a hint): ${ref.auto.description}`);
  const boards = boardsContainingRef(lib, id);
  if (boards.length) lines.push(`On boards: ${boards.join(", ")}`);
  lines.push(
    "",
    ref.file ? "Look at the image itself before relying on the text above." : "Open the link before relying on the text above.",
    "This is someone else's work. Use it to understand the direction; do not reproduce it.",
    "",
    ASK,
  );
  return lines.join("\n");
}

// A prompt the user pastes into an agent to hand over a board or a single ref.
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const lib = library();
  const board = parseBoardQuery(query.board);
  try {
    if (query.ref) {
      const id = String(query.ref);
      assertRefId(id);
      return { prompt: refPrompt(lib, id, board) };
    }
    if (!board) throw new Error("board or ref is required");
    return { prompt: await boardPrompt(lib, board) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not build the prompt";
    throw createError({ statusCode: 400, statusMessage: msg });
  }
});
