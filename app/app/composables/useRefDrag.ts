const HOLD_MS = 280;
const MOVE_TOLERANCE = 6;

export type RefDragState = {
  active: boolean;
  ids: string[];
  thumbs: string[];
  over: string | null;
  x: number;
  y: number;
};

// Press and hold a tile to pick it (or the whole selection) up, then release
// over a board in the drop grid. A press that moves early, or a plain click,
// is left alone so scrolling and opening still work.
export function useRefDrag(options: {
  idsFor: (id: string) => string[];
  thumbFor: (id: string) => string | null;
  onDrop: (ids: string[], board: string) => Promise<void>;
}) {
  const state = reactive<RefDragState>({ active: false, ids: [], thumbs: [], over: null, x: 0, y: 0 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startX = 0;
  let startY = 0;
  let suppressClick = false;

  function cleanup() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", onKey);
    document.body.classList.remove("ref-dragging");
  }

  function press(e: PointerEvent, id: string) {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".tile-check")) return;
    startX = state.x = e.clientX;
    startY = state.y = e.clientY;
    timer = setTimeout(() => begin(id), HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
  }

  function begin(id: string) {
    timer = undefined;
    const ids = options.idsFor(id);
    state.ids = ids;
    state.thumbs = ids.map(options.thumbFor).filter((t): t is string => !!t).slice(0, 3);
    state.over = null;
    state.active = true;
    suppressClick = true;
    document.body.classList.add("ref-dragging");
    window.addEventListener("keydown", onKey);
    if (ids.length > 1) gather(ids);
  }

  // Cards fly from their places in the grid into the pointer.
  function gather(ids: string[]) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ids.slice(0, 12).forEach((id, i) => {
      const img = document.querySelector<HTMLImageElement>(`[data-ref-id="${id}"] img`);
      if (!img) return;
      const r = img.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      const ghost = img.cloneNode() as HTMLImageElement;
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        zIndex: "95",
        pointerEvents: "none",
        objectFit: "cover",
      });
      document.body.appendChild(ghost);
      const dx = state.x - r.left - r.width / 2;
      const dy = state.y - r.top - r.height / 2;
      ghost
        .animate(
          [
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0.2 },
          ],
          { duration: 360, delay: i * 25, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
        )
        .finished.finally(() => ghost.remove());
    });
  }

  function onMove(e: PointerEvent) {
    if (!state.active) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE) cancel();
      return;
    }
    state.x = e.clientX;
    state.y = e.clientY;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-board]");
    state.over = target && !target.hasAttribute("aria-disabled") ? target.dataset.dropBoard ?? null : null;
  }

  async function onUp() {
    const { active, over, ids } = state;
    cleanup();
    state.active = false;
    state.over = null;
    // The click that follows this release belongs to the drag, not the tile.
    setTimeout(() => (suppressClick = false), 0);
    if (active && over) await options.onDrop(ids, over);
  }

  function cancel() {
    cleanup();
    state.active = false;
    state.over = null;
    setTimeout(() => (suppressClick = false), 0);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") cancel();
  }

  function consumeClick() {
    if (!suppressClick) return false;
    suppressClick = false;
    return true;
  }

  onUnmounted(cleanup);

  return { state, press, consumeClick };
}
