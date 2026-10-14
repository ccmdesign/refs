import { BOARD_DRAG_TYPE } from "./useIntake";

// Drag a board in the sidebar onto another board to nest it there, or onto the
// top-level strip to bring it back to the root.
export function useBoardDrag() {
  const dragged = useState<string | null>("board-drag", () => null);
  const over = useState<string | null>("board-drag-over", () => null);
  const error = useState<string>("board-drag-error", () => "");
  const { refresh } = useBoards();
  const route = useRoute();

  const nameOf = (path: string) => path.split("/").pop()!;
  const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

  // `parent` is a board path, or "" for the top level.
  function canDrop(parent: string) {
    const from = dragged.value;
    if (!from) return false;
    if (parent === from || parent.startsWith(`${from}/`)) return false;
    return parentOf(from) !== parent;
  }

  function start(e: DragEvent, path: string) {
    dragged.value = path;
    error.value = "";
    e.dataTransfer?.setData(BOARD_DRAG_TYPE, path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  let suppressClick = false;

  function end() {
    if (dragged.value !== null) suppressClick = true;
    dragged.value = null;
    over.value = null;
  }

  function consumeClick() {
    if (!suppressClick) return false;
    suppressClick = false;
    return true;
  }

  function hover(e: DragEvent, parent: string) {
    if (!canDrop(parent)) return;
    e.preventDefault();
    e.stopPropagation();
    over.value = parent;
  }

  function leave(parent: string) {
    if (over.value === parent) over.value = null;
  }

  async function drop(e: DragEvent, parent: string) {
    const from = dragged.value;
    const allowed = canDrop(parent);
    end();
    if (!from || !allowed) return;
    e.preventDefault();
    e.stopPropagation();
    const to = parent ? `${parent}/${nameOf(from)}` : nameOf(from);
    try {
      await $fetch("/api/boards", { method: "PATCH", body: { from, to } });
      await refresh();
      // Follow the board if the one on screen was inside what moved.
      const current = [route.params.slug].flat().filter(Boolean).join("/");
      if (current === from || current.startsWith(`${from}/`)) {
        await navigateTo(`/b/${to}${current.slice(from.length)}`);
      }
    } catch (err: any) {
      error.value = err?.data?.statusMessage || "Could not move board";
    }
  }

  return { dragged, over, error, start, end, hover, leave, drop, canDrop, consumeClick };
}
