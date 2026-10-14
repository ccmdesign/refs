export const BOARD_DRAG_TYPE = "application/x-refs-board";

export function useIntake(
  boardPath: Ref<string | undefined>,
  onAdded?: () => void | Promise<void>,
) {
  const dragging = ref(false);
  const status = ref("");

  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  function flash(msg: string) {
    status.value = msg;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      status.value = "";
    }, 4000);
  }

  async function submitFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    const fd = new FormData();
    for (const f of list) fd.append("file", f);
    if (boardPath.value) fd.append("board", boardPath.value);
    const res = await $fetch<{ results: { id: string; duplicate: boolean }[] }>("/api/add", {
      method: "POST",
      body: fd,
    });
    const dupes = res.results.filter((r) => r.duplicate);
    if (dupes.length) {
      flash("Already in library, added to this board");
    }
    await onAdded?.();
    return res;
  }

  async function submitUrl(url: string, note?: string) {
    const res = await $fetch<{ results: { id: string; duplicate: boolean }[] }>("/api/add", {
      method: "POST",
      body: { url, board: boardPath.value, note },
    });
    if (res.results.some((r) => r.duplicate)) {
      flash("Already in library, added to this board");
    }
    await onAdded?.();
    return res;
  }

  function onDragEnter(e: DragEvent) {
    if (e.dataTransfer?.types.includes("Files")) dragging.value = true;
  }

  function onDragLeave(e: DragEvent) {
    if (e.relatedTarget === null) dragging.value = false;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging.value = false;
    const dt = e.dataTransfer;
    if (!dt) return;
    // Drags that start inside the app (a board in the sidebar, a tile) are not intake.
    if (dt.types.includes(BOARD_DRAG_TYPE)) return;
    const url = dt.getData("text/uri-list") || dt.getData("text/plain");
    if (url && url.trim().startsWith(window.location.origin)) return;
    if (url && /^https?:\/\//i.test(url.trim())) {
      await submitUrl(url.trim());
      return;
    }
    if (dt.files?.length) {
      await submitFiles(dt.files);
    }
  }

  async function onPaste(e: ClipboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select")) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await submitFiles([file]);
          return;
        }
      }
    }
    const text = e.clipboardData?.getData("text")?.trim();
    if (text && /^https?:\/\//i.test(text)) {
      e.preventDefault();
      await submitUrl(text);
    }
  }

  onMounted(() => {
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", (ev) => ev.preventDefault());
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
  });

  onUnmounted(() => {
    window.removeEventListener("dragenter", onDragEnter);
    window.removeEventListener("dragleave", onDragLeave);
    window.removeEventListener("drop", onDrop);
    window.removeEventListener("paste", onPaste);
  });

  return { dragging, status, submitFiles, submitUrl, flash };
}
