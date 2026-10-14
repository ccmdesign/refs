import type { RefsResponse, ViewKind } from "../types";

export function useRefsView(
  kind: Ref<ViewKind>,
  boardPath: Ref<string | undefined>,
  recursive: Ref<boolean>,
  activeTags: Ref<string[]>,
) {
  const data = ref<RefsResponse | null>(null);
  const loading = ref(false);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    loading.value = true;
    try {
      const tags = [...activeTags.value];
      const q: Record<string, string | string[]> = {};
      if (kind.value === "unsorted") q.unsorted = "true";
      else if (kind.value === "board" && boardPath.value) {
        q.board = boardPath.value;
        if (recursive.value) q.recursive = "true";
      }
      if (tags.length) q.tag = tags;
      data.value = await $fetch<RefsResponse>("/api/refs", { query: q });
    } finally {
      loading.value = false;
    }
    setupPoll();
  }

  function setupPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (data.value && data.value.pending > 0) {
      pollTimer = setInterval(() => {
        refresh();
      }, 3000);
    }
  }

  watch([kind, boardPath, recursive, activeTags], () => refresh(), { deep: true });

  onMounted(() => refresh());
  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  return { data, loading, refresh };
}
