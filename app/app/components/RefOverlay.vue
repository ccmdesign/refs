<script setup lang="ts">
import type { RefListItem } from "../types";

const props = defineProps<{
  items: RefListItem[];
  index: number;
  boardPath?: string;
}>();

const emit = defineEmits<{ close: []; change: []; navigate: [index: number] }>();

const current = computed(() => props.items[props.index]);

// The frame takes the image's own proportions; links fall back to 4:3.
const frameStyle = computed(() => {
  const w = current.value?.ref.width;
  const h = current.value?.ref.height;
  return { "--ratio": w && h ? w / h : 4 / 3 };
});

const saved = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;

function markSaved() {
  saved.value = true;
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    saved.value = false;
  }, 1500);
}

const title = ref("");
const source = ref("");
const note = ref("");
const boardNote = ref("");
const keyFlag = ref(false);
const tagsInput = ref("");

watch(
  current,
  (c) => {
    if (!c) return;
    title.value = c.ref.title ?? "";
    source.value = c.ref.source ?? "";
    note.value = c.ref.note ?? "";
    boardNote.value = c.boardNote ?? "";
    keyFlag.value = !!c.key;
    tagsInput.value = (c.ref.tags ?? []).join(", ");
  },
  { immediate: true },
);

async function patchRef() {
  const id = current.value?.ref.id;
  if (!id) return;
  await $fetch(`/api/refs/${id}`, {
    method: "PATCH",
    body: {
      title: title.value,
      source: source.value,
      note: note.value,
      tags: tagsInput.value,
    },
  });
  markSaved();
  emit("change");
}

async function patchBoardRef() {
  const id = current.value?.ref.id;
  if (!id || !props.boardPath) return;
  await $fetch(`/api/refs/${id}/boards`, {
    method: "PATCH",
    body: { board: props.boardPath, note: boardNote.value, key: keyFlag.value },
  });
  markSaved();
  emit("change");
}

async function retag() {
  const id = current.value?.ref.id;
  if (!id) return;
  await $fetch(`/api/refs/${id}/tag`, { method: "POST" });
  emit("change");
}

async function removeBoard(b: string) {
  const id = current.value?.ref.id;
  if (!id) return;
  await $fetch(`/api/refs/${id}/boards`, { method: "DELETE", body: { board: b } });
  emit("change");
}

// Inline pickers instead of window.prompt/confirm, which embedded browsers block.
const { data: boardsData, refresh: refreshBoardList } = useBoards();
const handoff = useHandoff();
const NEW_BOARD = "::new";
const namingBoard = ref(false);
const newBoardName = ref("");
const confirmingDelete = ref(false);
const panelError = ref("");
const newBoardField = ref<HTMLInputElement | null>(null);

const otherBoards = computed(() => {
  const out: string[] = [];
  const walk = (nodes: { path: string; children: any[] }[]) => {
    for (const n of nodes) {
      if (!current.value?.boards.includes(n.path)) out.push(n.path);
      walk(n.children);
    }
  };
  walk(boardsData.value?.tree ?? []);
  return out;
});

async function addToBoard(path: string) {
  const id = current.value?.ref.id;
  if (!id || !path) return;
  await $fetch(`/api/refs/${id}/boards`, { method: "POST", body: { board: path } });
  emit("change");
}

async function onPickBoard(e: Event) {
  const el = e.target as HTMLSelectElement;
  const value = el.value;
  el.value = "";
  panelError.value = "";
  if (value === NEW_BOARD) {
    namingBoard.value = true;
    newBoardName.value = "";
    await nextTick();
    newBoardField.value?.focus();
  } else if (value) {
    await addToBoard(value);
  }
}

async function createAndAdd() {
  const path = newBoardName.value.trim().replace(/^\/+|\/+$/g, "");
  if (!path) return;
  try {
    await $fetch("/api/boards", { method: "POST", body: { path } });
    await refreshBoardList();
    await addToBoard(path);
    namingBoard.value = false;
  } catch (err: any) {
    panelError.value = err?.data?.statusMessage || "Could not create board";
  }
}

async function deleteRef() {
  const id = current.value?.ref.id;
  if (!id) return;
  await $fetch(`/api/refs/${id}`, { method: "DELETE" });
  emit("close");
  emit("change");
}

watch(current, () => {
  namingBoard.value = false;
  confirmingDelete.value = false;
  panelError.value = "";
});

function step(delta: number) {
  const next = props.index + delta;
  if (next < 0 || next >= props.items.length) return;
  emit("navigate", next);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
  // Arrow keys move the caret while typing; only step between refs otherwise.
  const el = e.target as HTMLElement | null;
  if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
}

const reducedMotion = import.meta.client
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="current" class="ref-backdrop" @click.self="emit('close')">
  <div
    class="ref-overlay"
    :class="{ 'is-link': !current.ref.file, 'is-video': current.ref.kind === 'video' }"
    :style="frameStyle"
  >
    <video
      v-if="current.ref.kind === 'video' && current.ref.file"
      :key="current.ref.id"
      class="ref-image"
      :src="`/file/${current.ref.id}`"
      :poster="`/thumb/${current.ref.id}?w=1600`"
      :autoplay="!reducedMotion"
      controls
      muted
      loop
      playsinline
      :aria-label="current.ref.title || current.ref.id"
    />
    <img
      v-else-if="current.ref.file"
      class="ref-image"
      :src="`/file/${current.ref.id}`"
      :alt="current.ref.title || current.ref.id"
    />
    <div v-else class="ref-link">{{ current.ref.url }}</div>
    <div class="ref-drawer">
    <div class="ref-panel">
      <div class="panel-head">
        <input
          v-model="title"
          class="title-input"
          type="text"
          aria-label="Title"
          placeholder="Untitled"
          @blur="patchRef"
        />
        <button
          type="button"
          class="agent-button"
          title="Copy a prompt that hands this ref to an agent"
          @click="handoff.copy({ ref: current.ref.id, board: boardPath })"
        >
          {{ handoff.label.value }}
        </button>
      </div>
      <div>
        <div class="field-head">
          <label>Source</label>
          <a v-if="source" :href="source" target="_blank" rel="noopener">Open ↗</a>
        </div>
        <input v-model="source" type="text" placeholder="Where it came from" @blur="patchRef" />
      </div>
      <div>
        <label>Note</label>
        <textarea v-model="note" placeholder="What is true of this ref anywhere" @blur="patchRef" />
      </div>
      <div v-if="boardPath">
        <label>Board note</label>
        <textarea v-model="boardNote" placeholder="What to take from it for this board" @blur="patchBoardRef" />
      </div>
      <div v-if="boardPath">
        <label class="label-inline">
          <input v-model="keyFlag" type="checkbox" @change="patchBoardRef" />
          Key ref
        </label>
      </div>
      <div>
        <label>Tags</label>
        <input v-model="tagsInput" type="text" placeholder="comma-separated" @blur="patchRef" />
      </div>
      <div>
        <label>Machine tags</label>
        <div class="tag-list">
          <span v-for="t in current.ref.auto?.tags ?? []" :key="t">{{ t }}</span>
          <span v-if="!(current.ref.auto?.tags?.length)">—</span>
        </div>
        <button type="button" class="quiet" @click="retag">Re-tag</button>
      </div>
      <div v-if="current.ref.auto?.description">
        <label>Description</label>
        <p class="muted">{{ current.ref.auto.description }}</p>
      </div>
      <div>
        <label>On boards</label>
        <div v-for="b in current.boards" :key="b" class="on-board">
          <span>{{ b }}</span>
          <button type="button" class="quiet" @click="removeBoard(b)">Remove</button>
        </div>
      </div>
      <div v-if="namingBoard" class="actions">
        <input
          ref="newBoardField"
          v-model="newBoardName"
          type="text"
          placeholder="New board name (use / for a sub-board)"
          @keydown.enter="createAndAdd"
          @keydown.esc.stop="namingBoard = false"
        />
        <button type="button" class="quiet" @click="createAndAdd">Create and add</button>
        <button type="button" class="quiet" @click="namingBoard = false">Back</button>
      </div>
      <div v-else-if="confirmingDelete" class="actions">
        <span>Move this ref to trash?</span>
        <button type="button" class="quiet" @click="deleteRef">Delete</button>
        <button type="button" class="quiet" @click="confirmingDelete = false">Cancel</button>
      </div>
      <div v-else class="actions">
        <select @change="onPickBoard">
          <option value="">Add to board…</option>
          <option v-for="p in otherBoards" :key="p" :value="p">{{ p }}</option>
          <option :value="NEW_BOARD">New board…</option>
        </select>
        <button type="button" class="quiet" @click="confirmingDelete = true">Delete</button>
        <button type="button" class="quiet" @click="emit('close')">Close</button>
      </div>
      <p v-if="panelError" class="form-error">{{ panelError }}</p>
      <p class="saved" :class="{ on: saved }" aria-live="polite">{{ saved ? "Saved" : "" }}</p>
    </div>
    </div>
  </div>
  </div>
</template>
