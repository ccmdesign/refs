<script setup lang="ts">
import type { BoardTreeNode, ViewKind } from "../types";

const props = defineProps<{
  kind: ViewKind;
  boardPath?: string;
}>();

const { data: boards, refresh: refreshBoards } = useBoards();
const recursive = ref(true);
const activeTags = ref<string[]>([]);
const kindRef = toRef(props, "kind");
const boardRef = toRef(props, "boardPath");

const { data: refsData, refresh: refreshRefs } = useRefsView(
  kindRef,
  boardRef,
  recursive,
  activeTags,
);

const { columns, options, setColumns, step } = useZoom();
const { theme, toggle: toggleTheme } = useTheme();
const handoff = useHandoff();
const intakeBoard = computed(() => (props.kind === "board" ? props.boardPath : undefined));
async function onIntakeDone() {
  await refreshRefs();
  await refreshBoards();
}

const { dragging, status, flash } = useIntake(intakeBoard, onIntakeDone);

const openIndex = ref<number | null>(null);

const allTags = computed(() => {
  const set = new Set<string>();
  for (const item of refsData.value?.refs ?? []) {
    for (const t of item.ref.tags ?? []) set.add(t);
    for (const t of item.ref.auto?.tags ?? []) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

const title = computed(() => {
  if (props.kind === "all") return "All refs";
  if (props.kind === "unsorted") return "Unsorted";
  return props.boardPath?.split("/").pop() ?? "";
});

// Parent boards of the one on screen, outermost first, as links.
const parents = computed(() => {
  if (props.kind !== "board" || !props.boardPath) return [];
  const segments = props.boardPath.split("/").slice(0, -1);
  return segments.map((name, i) => ({ name, path: segments.slice(0, i + 1).join("/") }));
});

const TAGS_COLLAPSED = 24;
const showAllTags = ref(false);
const visibleTags = computed(() => {
  if (showAllTags.value || allTags.value.length <= TAGS_COLLAPSED) return allTags.value;
  // Active tags stay visible when the list is collapsed.
  const head = allTags.value.slice(0, TAGS_COLLAPSED);
  return [...head, ...activeTags.value.filter((t) => !head.includes(t))];
});

const briefText = ref("");
watch(
  () => refsData.value?.brief,
  (b) => {
    briefText.value = b ?? "";
  },
  { immediate: true },
);

const briefField = ref<HTMLTextAreaElement | null>(null);

// The brief grows with its text; it has no scrollbar of its own.
function fitBrief() {
  const el = briefField.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

async function onDetailsToggle(e: Event) {
  if (!(e.target as HTMLDetailsElement).open) return;
  await nextTick();
  fitBrief();
}

// What the closed panel is hiding, so an active filter is never invisible.
const detailsHint = computed(() => {
  const parts: string[] = [];
  if (props.kind === "board" && !briefText.value.trim()) parts.push("no brief yet");
  const n = activeTags.value.length;
  if (n) parts.push(`${n} tag ${n === 1 ? "filter" : "filters"} on`);
  return parts.join(" · ");
});

async function saveBrief() {
  if (props.kind !== "board" || !props.boardPath) return;
  await $fetch("/api/boards/brief", {
    method: "PUT",
    body: { path: props.boardPath, brief: briefText.value },
  });
}

function toggleTag(tag: string) {
  const i = activeTags.value.indexOf(tag);
  if (i >= 0) activeTags.value.splice(i, 1);
  else activeTags.value.push(tag);
}

async function onRefsChange() {
  await refreshRefs();
  await refreshBoards();
}

// Hold a tile to drag it, or the whole selection, onto a board.
const refDrag = useRefDrag({
  idsFor(id) {
    const refs = refsData.value?.refs ?? [];
    if (selectedIds.value.length > 1 && selectedIds.value.includes(id)) {
      return refs.filter((r) => selectedIds.value.includes(r.ref.id)).map((r) => r.ref.id);
    }
    return [id];
  },
  thumbFor(id) {
    const item = refsData.value?.refs.find((r) => r.ref.id === id);
    return item?.ref.file ? `/thumb/${id}?w=400` : null;
  },
  async onDrop(ids, board) {
    const refs = refsData.value?.refs ?? [];
    const here = props.kind === "board" ? props.boardPath : undefined;
    const items = ids.map((id) => {
      const item = refs.find((r) => r.ref.id === id);
      return { id, from: here ? (item?.viaBoard ?? here) : undefined };
    });
    try {
      await $fetch("/api/refs/bulk", { method: "POST", body: { action: "move", to: board, items } });
      flash(`${ids.length === 1 ? "Moved 1 ref" : `Moved ${ids.length} refs`} to ${board}`);
      clearSelection();
      await onRefsChange();
    } catch (err: any) {
      flash(err?.data?.statusMessage || "Could not move");
    }
  },
});

function pressTile(i: number, e: PointerEvent) {
  const id = refsData.value?.refs[i]?.ref.id;
  if (id) refDrag.press(e, id);
}

function openAt(i: number) {
  if (refDrag.consumeClick()) return;
  openIndex.value = i;
}

const selectedIds = ref<string[]>([]);
let lastSelected: number | null = null;

function toggleSelect(i: number, range: boolean) {
  if (refDrag.consumeClick()) return;
  const refs = refsData.value?.refs ?? [];
  const ids = new Set(selectedIds.value);
  if (range && lastSelected !== null) {
    const [a, b] = [Math.min(lastSelected, i), Math.max(lastSelected, i)];
    for (const item of refs.slice(a, b + 1)) ids.add(item.ref.id);
  } else {
    const id = refs[i]?.ref.id;
    if (!id) return;
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
  }
  lastSelected = i;
  selectedIds.value = [...ids];
}

function selectAll() {
  selectedIds.value = (refsData.value?.refs ?? []).map((r) => r.ref.id);
}

function clearSelection() {
  newBoardFor.value = null;
  selectedIds.value = [];
  lastSelected = null;
}

const boardPaths = computed(() => {
  const out: string[] = [];
  const walk = (nodes: BoardTreeNode[]) => {
    for (const n of nodes) {
      out.push(n.path);
      walk(n.children);
    }
  };
  walk(boards.value?.tree ?? []);
  return out;
});

const bulkBusy = ref(false);

async function bulk(action: "move" | "add" | "remove", to?: string) {
  const refs = refsData.value?.refs ?? [];
  const here = props.kind === "board" ? props.boardPath : undefined;
  const items = refs
    .filter((r) => selectedIds.value.includes(r.ref.id))
    .map((r) => ({ id: r.ref.id, from: here ? (r.viaBoard ?? here) : undefined }));
  if (!items.length) return;
  bulkBusy.value = true;
  try {
    await $fetch("/api/refs/bulk", { method: "POST", body: { action, to, items } });
    clearSelection();
    await onRefsChange();
  } finally {
    bulkBusy.value = false;
  }
}

const NEW_BOARD = "::new";
const newBoardFor = ref<"move" | "add" | null>(null);
const newBoardName = ref("");
const bulkError = ref("");
const newBoardField = ref<HTMLInputElement | null>(null);

async function onBulkPick(action: "move" | "add", e: Event) {
  const el = e.target as HTMLSelectElement;
  const to = el.value;
  el.value = "";
  bulkError.value = "";
  if (to === NEW_BOARD) {
    newBoardFor.value = action;
    newBoardName.value = "";
    await nextTick();
    newBoardField.value?.focus();
  } else if (to) {
    bulk(action, to);
  }
}

async function createAndBulk() {
  const path = newBoardName.value.trim().replace(/^\/+|\/+$/g, "");
  const action = newBoardFor.value;
  if (!path || !action) return;
  try {
    await $fetch("/api/boards", { method: "POST", body: { path } });
    await bulk(action, path);
    newBoardFor.value = null;
  } catch (err: any) {
    bulkError.value = err?.data?.statusMessage || "Could not create board";
  }
}

function onSelectionKey(e: KeyboardEvent) {
  if (e.key === "Escape" && openIndex.value === null) clearSelection();
}
onMounted(() => window.addEventListener("keydown", onSelectionKey));
onUnmounted(() => window.removeEventListener("keydown", onSelectionKey));
watch([kindRef, boardRef], clearSelection);

const overlayItem = computed(() =>
  openIndex.value !== null ? refsData.value?.refs[openIndex.value] : null,
);

const titleNameEl = ref<HTMLElement | null>(null);
let skipTitleCommit = false;

// The editable name is filled by hand, not by interpolation, so a re-render
// never moves the caret. Runs after render, when a new board's element exists.
watch(
  [title, titleNameEl],
  () => {
    const el = titleNameEl.value;
    if (el && document.activeElement !== el) {
      el.textContent = title.value;
    }
  },
  { immediate: true, flush: "post" },
);

function onTitleEsc() {
  skipTitleCommit = true;
  const el = titleNameEl.value;
  if (el) el.textContent = title.value;
  el?.blur();
}

async function commitTitle() {
  if (skipTitleCommit) {
    skipTitleCommit = false;
    return;
  }
  const el = titleNameEl.value;
  if (!el || props.kind !== "board" || !props.boardPath) return;
  const newName = (el.textContent ?? "").trim();
  const oldName = props.boardPath.split("/").pop() ?? "";
  if (!newName || newName === oldName || newName.includes("/") || newName.includes("\\")) {
    if (newName && (newName.includes("/") || newName.includes("\\"))) {
      flash("Board names can't contain /");
    }
    el.textContent = oldName;
    return;
  }
  const parent = props.boardPath.includes("/")
    ? props.boardPath.slice(0, props.boardPath.lastIndexOf("/"))
    : "";
  const to = parent ? `${parent}/${newName}` : newName;
  try {
    await $fetch("/api/boards", { method: "PATCH", body: { from: props.boardPath, to } });
    await refreshBoards();
    await navigateTo(`/b/${to}`);
  } catch (err: any) {
    el.textContent = oldName;
    flash(err?.data?.statusMessage || "Could not rename");
  }
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      v-if="boards"
      :tree="boards.tree"
      :all-count="boards.allCount"
      :unsorted-count="boards.unsortedCount"
      :current-kind="kind"
      :current-board="boardPath"
      @refresh="refreshBoards"
    />
    <div v-else class="sidebar" />
    <div class="rule-v" />
    <main class="main">
      <header class="header-row">
        <h1 class="view-title">
          <template v-for="p in parents" :key="p.path">
            <NuxtLink :to="`/b/${p.path}`" class="title-parent">{{ p.name }}</NuxtLink>
            <span class="title-sep" aria-hidden="true">/</span>
          </template>
          <span
            v-if="kind === 'board'"
            ref="titleNameEl"
            :key="boardPath"
            class="title-name"
            contenteditable="plaintext-only"
            spellcheck="false"
            role="textbox"
            aria-label="Board name"
            title="Click to rename"
            @keydown.enter.prevent="titleNameEl?.blur()"
            @keydown.esc.prevent="onTitleEsc"
            @blur="commitTitle"
          />
          <span v-else>{{ title }}</span>
          <span class="title-count">{{ refsData?.count ?? 0 }}</span>
        </h1>
        <div class="header-controls">
          <button
            v-if="kind === 'board'"
            type="button"
            class="agent-button"
            title="Copy a prompt that hands this board to an agent"
            @click="handoff.copy({ board: boardPath })"
          >
            {{ handoff.label.value }}
          </button>
          <label v-if="kind === 'board'">
            <input v-model="recursive" type="checkbox" />
            Include sub-boards
          </label>
          <div class="columns-switch">
            <span>Columns</span>
            <button
              v-for="n in options"
              :key="n"
              type="button"
              :class="{ selected: columns === n }"
              @click="setColumns(n)"
            >
              {{ n }}
            </button>
          </div>
          <span v-if="refsData?.pending" class="muted">{{ refsData.pending }} tagging</span>
          <button type="button" @click="toggleTheme">{{ theme === "dark" ? "Light" : "Dark" }}</button>
        </div>
      </header>

      <details
        v-if="kind === 'board' || allTags.length"
        class="board-details"
        @toggle="onDetailsToggle"
      >
        <summary>
          <span>{{ kind === "board" ? "Brief and tags" : "Tags" }}</span>
          <span v-if="detailsHint" class="muted">{{ detailsHint }}</span>
        </summary>
        <div v-if="kind === 'board'" class="brief-area">
          <textarea
            v-model="briefText"
            rows="1"
            placeholder="Add a brief: what this board is for, what to take from it, what to ignore."
            aria-label="Board brief"
            @blur="saveBrief"
            ref="briefField"
            @input="fitBrief"
          />
        </div>

        <div v-if="allTags.length" class="tag-row">
          <button
            v-for="tag in visibleTags"
            :key="tag"
            type="button"
            :class="{ on: activeTags.includes(tag) }"
            @click="toggleTag(tag)"
          >
            {{ tag }}
          </button>
          <button
            v-if="allTags.length > TAGS_COLLAPSED"
            type="button"
            class="tag-more"
            @click="showAllTags = !showAllTags"
          >
            {{ showAllTags ? "Fewer tags" : `All ${allTags.length} tags` }}
          </button>
        </div>
      </details>

      <p v-if="!refsData?.refs.length" class="empty">
        No refs yet. Drop images or paste a URL.
      </p>
      <RefGrid
        v-else
        :items="refsData!.refs"
        :columns="columns"
        :view-board-path="kind === 'board' ? boardPath : undefined"
        :selected-ids="selectedIds"
        @open="openAt"
        @zoom="step"
        @select="toggleSelect"
        @press="pressTile"
      />

      <BoardDropGrid
        v-if="boards"
        :tree="boards.tree"
        :drag="refDrag.state"
        :bind-ghost="refDrag.bindGhost"
        :current-board="kind === 'board' ? boardPath : undefined"
      />

      <div v-if="selectedIds.length" class="bulk-bar">
        <span>{{ selectedIds.length }} selected</span>
        <template v-if="newBoardFor">
          <input
            ref="newBoardField"
            v-model="newBoardName"
            type="text"
            placeholder="New board name (use / for a sub-board)"
            @keydown.enter="createAndBulk"
            @keydown.esc.stop="newBoardFor = null"
          />
          <button type="button" :disabled="bulkBusy" @click="createAndBulk">
            {{ newBoardFor === "move" && kind === "board" ? "Create and move" : "Create and add" }}
          </button>
          <button type="button" @click="newBoardFor = null">Back</button>
          <span v-if="bulkError" class="form-error">{{ bulkError }}</span>
        </template>
        <template v-else>
        <select :disabled="bulkBusy" @change="onBulkPick('move', $event)">
          <option value="">{{ kind === "board" ? "Move to…" : "Add to…" }}</option>
          <option v-for="p in boardPaths" :key="p" :value="p" :disabled="p === boardPath">{{ p }}</option>
          <option :value="NEW_BOARD">New board…</option>
        </select>
        <select v-if="kind === 'board'" :disabled="bulkBusy" @change="onBulkPick('add', $event)">
          <option value="">Also add to…</option>
          <option v-for="p in boardPaths" :key="p" :value="p" :disabled="p === boardPath">{{ p }}</option>
          <option :value="NEW_BOARD">New board…</option>
        </select>
        <button v-if="kind === 'board'" type="button" :disabled="bulkBusy" @click="bulk('remove')">
          Remove from board
        </button>
        <button type="button" @click="selectAll">Select all</button>
        </template>
        <button type="button" @click="clearSelection">Clear</button>
      </div>

      <RefOverlay
        v-if="openIndex !== null && overlayItem"
        :items="refsData!.refs"
        :index="openIndex"
        :board-path="kind === 'board' ? boardPath : undefined"
        @close="openIndex = null"
        @navigate="(i) => (openIndex = i)"
        @change="onRefsChange"
      />
    </main>
    <div class="drop-overlay" :class="{ active: dragging }" />
    <p v-if="status" class="status-line">{{ status }}</p>
  </div>
</template>
