const HOLD_MS = 220;
const MOVE_TOLERANCE = 6;
const EDGE = 72; // px from the drop grid's top or bottom where it scrolls itself

export type RefDragState = {
  active: boolean;
  ids: string[];
  thumbs: string[];
  over: string | null;
  landing: string | null;
};

// Press and hold a tile to pick it (or the whole selection) up, then release
// over a board in the drop grid. A press that moves early, or a plain click,
// is left alone so scrolling and opening still work.
//
// The card in hand is moved by a requestAnimationFrame loop that eases it
// toward the pointer and tilts it with its speed; nothing reactive changes per
// frame, so Vue only re-renders when the board under the pointer changes.
export function useRefDrag(options: {
  idsFor: (id: string) => string[];
  thumbFor: (id: string) => string | null;
  onDrop: (ids: string[], board: string) => Promise<void>;
}) {
  const state = reactive<RefDragState>({ active: false, ids: [], thumbs: [], over: null, landing: null });
  let ghost: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let pressed: HTMLElement | null = null;
  let origin = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const pos = { x: 0, y: 0, tilt: 0, scale: 0.85 };
  let last = 0;
  let suppressClick = false;

  function bindGhost(el: unknown) {
    ghost = (el as HTMLElement | null) ?? null;
  }

  function reduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function cleanup() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    cancelAnimationFrame(frame);
    pressed?.classList.remove("pressing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", onKey);
    document.body.classList.remove("ref-dragging");
  }

  function press(e: PointerEvent, id: string) {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".tile-check")) return;
    pressed = (e.currentTarget as HTMLElement | null) ?? (e.target as HTMLElement).closest(".tile");
    pressed?.classList.add("pressing");
    origin = { x: e.clientX, y: e.clientY };
    target.x = e.clientX;
    target.y = e.clientY;
    timer = setTimeout(() => begin(id), HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
  }

  function begin(id: string) {
    timer = undefined;
    pressed?.classList.remove("pressing");
    const ids = options.idsFor(id);
    state.ids = ids;
    state.thumbs = ids.map(options.thumbFor).filter((t): t is string => !!t).slice(0, 3);
    state.over = null;
    state.landing = null;
    state.active = true;
    suppressClick = true;
    document.body.classList.add("ref-dragging");
    window.addEventListener("keydown", onKey);
    Object.assign(pos, { x: target.x, y: target.y, tilt: 0, scale: 0.85 });
    last = performance.now();
    frame = requestAnimationFrame(tick);
    if (ids.length > 1) gather(ids);
  }

  function tick(now: number) {
    const dt = Math.min(now - last, 64);
    last = now;
    // Frame-rate independent easing toward the pointer.
    const k = reduced() ? 1 : 1 - Math.pow(1 - 0.32, dt / 16.7);
    const dx = target.x - pos.x;
    pos.x += dx * k;
    pos.y += (target.y - pos.y) * k;
    pos.tilt += (Math.max(-12, Math.min(12, dx * 0.35)) - pos.tilt) * k;
    pos.scale += (1 - pos.scale) * k;
    if (ghost) {
      ghost.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${pos.tilt}deg) scale(${pos.scale})`;
    }
    hitTest();
    autoScroll();
    frame = requestAnimationFrame(tick);
  }

  function hitTest() {
    const el = document.elementFromPoint(target.x, target.y)?.closest<HTMLElement>("[data-drop-board]");
    const over = el && !el.hasAttribute("aria-disabled") ? el.dataset.dropBoard ?? null : null;
    if (over !== state.over) state.over = over;
  }

  function autoScroll() {
    const grid = document.querySelector<HTMLElement>(".drop-grid");
    if (!grid) return;
    const r = grid.getBoundingClientRect();
    if (target.y < r.top + EDGE) grid.scrollTop -= Math.ceil((r.top + EDGE - target.y) / 6);
    else if (target.y > r.bottom - EDGE) grid.scrollTop += Math.ceil((target.y - (r.bottom - EDGE)) / 6);
  }

  // Cards fly from their places in the grid into the pointer.
  function gather(ids: string[]) {
    if (reduced()) return;
    ids.slice(0, 12).forEach((id, i) => {
      const img = document.querySelector<HTMLImageElement>(`[data-ref-id="${id}"] img`);
      if (!img) return;
      const r = img.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      const flyer = img.cloneNode() as HTMLImageElement;
      Object.assign(flyer.style, {
        position: "fixed",
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        zIndex: "95",
        pointerEvents: "none",
        objectFit: "cover",
        willChange: "transform, opacity",
      });
      document.body.appendChild(flyer);
      const dx = target.x - r.left - r.width / 2;
      const dy = target.y - r.top - r.height / 2;
      flyer
        .animate(
          [
            { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
            { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.12)`, opacity: 0 },
          ],
          { duration: 300, delay: i * 18, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
        )
        .finished.finally(() => flyer.remove());
    });
  }

  function onMove(e: PointerEvent) {
    target.x = e.clientX;
    target.y = e.clientY;
    if (!state.active && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_TOLERANCE) cancel();
  }

  // The card in hand travels to `to` and fades, then the grid closes.
  async function settle(to: { x: number; y: number }, shrink: number) {
    if (!ghost || reduced()) return;
    const from = ghost.style.transform;
    await ghost
      .animate(
        [
          { transform: from, opacity: 1 },
          { transform: `translate3d(${to.x}px, ${to.y}px, 0) rotate(0deg) scale(${shrink})`, opacity: 0 },
        ],
        { duration: 220, easing: "cubic-bezier(0.32, 0, 0.67, 0)", fill: "forwards" },
      )
      .finished.catch(() => {});
  }

  async function onUp() {
    const { active, over, ids } = state;
    cleanup();
    setTimeout(() => (suppressClick = false), 0);
    if (!active) return;
    if (over) {
      state.landing = over;
      const cell = document.querySelector<HTMLElement>(`[data-drop-board="${CSS.escape(over)}"]`);
      const r = cell?.getBoundingClientRect();
      const center = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : target;
      await Promise.all([settle(center, 0.25), options.onDrop(ids, over)]);
    } else {
      await settle(origin, 0.6);
    }
    state.active = false;
    state.over = null;
    state.landing = null;
  }

  function cancel() {
    const wasActive = state.active;
    cleanup();
    setTimeout(() => (suppressClick = false), 0);
    if (!wasActive) return;
    state.active = false;
    state.over = null;
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

  return { state, press, consumeClick, bindGhost };
}
