// Copies an agent hand-off prompt for a board or a ref to the clipboard.
export function useHandoff() {
  const state = ref<"idle" | "copied" | "failed">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function write(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Embedded browsers can refuse the async clipboard; fall back to a selection copy.
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) throw new Error("copy refused");
    }
  }

  async function copy(query: { board?: string; ref?: string }) {
    try {
      const { prompt } = await $fetch<{ prompt: string }>("/api/handoff", { query });
      await write(prompt);
      state.value = "copied";
    } catch {
      state.value = "failed";
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (state.value = "idle"), 1800);
  }

  const label = computed(() =>
    state.value === "copied" ? "Copied" : state.value === "failed" ? "Copy failed" : "Agent",
  );

  return { state, label, copy };
}
