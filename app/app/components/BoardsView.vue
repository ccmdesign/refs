<script setup lang="ts">
import type { BoardTreeNode } from "../types";

const { data: boards, refresh: refreshBoards } = useBoards();
const { theme, toggle: toggleTheme } = useTheme();
const drag = useBoardDrag();

type Cell = { path: string; label: string; parent?: string; count: number };

const rows = computed(() => {
  const tree = boards.value?.tree ?? [];
  return tree.map((top) => {
    const subs: Cell[] = [];
    const walk = (nodes: BoardTreeNode[]) => {
      for (const n of nodes) {
        const rel = n.path.slice(top.path.length + 1);
        const cut = rel.lastIndexOf("/");
        subs.push({
          path: n.path,
          label: n.name,
          parent: cut > 0 ? rel.slice(0, cut) : undefined,
          count: n.count,
        });
        walk(n.children);
      }
    };
    walk(top.children);
    return { top, board: { path: top.path, label: top.name, count: top.count } as Cell, subs };
  });
});

function descendantCount(node: BoardTreeNode | null | undefined): number {
  if (!node) return 0;
  let n = 0;
  const walk = (nodes: BoardTreeNode[]) => {
    for (const child of nodes) {
      n++;
      walk(child.children);
    }
  };
  walk(node.children);
  return n;
}

function findNode(path: string): BoardTreeNode | null {
  const tree = boards.value?.tree ?? [];
  const walk = (nodes: BoardTreeNode[]): BoardTreeNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n;
      const found = walk(n.children);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
}

const confirming = ref<string | null>(null);
const confirmError = ref("");

function startConfirm(path: string) {
  confirming.value = path;
  confirmError.value = "";
}

function cancelConfirm() {
  confirming.value = null;
  confirmError.value = "";
}

async function confirmDelete(path: string) {
  confirmError.value = "";
  try {
    await $fetch("/api/boards", { method: "DELETE", query: { path } });
    await refreshBoards();
    confirming.value = null;
  } catch (err: any) {
    confirmError.value = err?.data?.statusMessage || "Could not delete";
  }
}

function onConfirmKey(e: KeyboardEvent) {
  if (e.key === "Escape" && confirming.value) cancelConfirm();
}
onMounted(() => window.addEventListener("keydown", onConfirmKey));
onUnmounted(() => window.removeEventListener("keydown", onConfirmKey));

const boardCount = computed(() => countBoards(boards.value?.tree ?? []));

function cellClass(path: string) {
  return {
    over: drag.over.value === path,
    dragging: drag.dragged.value === path,
  };
}

function onCellClick(e: MouseEvent) {
  if (drag.consumeClick()) e.preventDefault();
}

const subDraft = ref<Record<string, string>>({});
const subError = ref<Record<string, string>>({});

function clearSubError(topPath: string) {
  subError.value = { ...subError.value, [topPath]: "" };
}

function cancelSub(topPath: string, e: Event) {
  subDraft.value = { ...subDraft.value, [topPath]: "" };
  subError.value = { ...subError.value, [topPath]: "" };
  (e.target as HTMLInputElement)?.blur();
}

async function createSub(topPath: string) {
  const name = (subDraft.value[topPath] ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!name) return;
  const path = `${topPath}/${name}`;
  try {
    await $fetch("/api/boards", { method: "POST", body: { path } });
    await refreshBoards();
    subDraft.value = { ...subDraft.value, [topPath]: "" };
  } catch (err: any) {
    subError.value = { ...subError.value, [topPath]: err?.data?.statusMessage || "Could not save" };
  }
}

const topDraft = ref("");
const topError = ref("");
const topInput = ref<HTMLInputElement | null>(null);

function clearTopError() {
  topError.value = "";
}

async function createTop() {
  const path = topDraft.value.trim().replace(/^\/+|\/+$/g, "");
  if (!path) return;
  try {
    await $fetch("/api/boards", { method: "POST", body: { path } });
    await refreshBoards();
    topDraft.value = "";
    topInput.value?.blur();
  } catch (err: any) {
    topError.value = err?.data?.statusMessage || "Could not save";
  }
}

function cancelTop() {
  topDraft.value = "";
  topError.value = "";
  topInput.value?.blur();
}

const draggedIsNested = computed(() => {
  const d = drag.dragged.value;
  return d ? d.includes("/") : false;
});
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      v-if="boards"
      :tree="boards.tree"
      :all-count="boards.allCount"
      :unsorted-count="boards.unsortedCount"
      current-kind="boards"
      @refresh="refreshBoards"
    />
    <div v-else class="sidebar" />
    <div class="rule-v" />
    <main class="main boards-page">
      <header class="header-row">
        <h1 class="view-title">
          All boards
          <span class="title-count">{{ boardCount }}</span>
        </h1>
        <div class="header-controls">
          <button type="button" @click="toggleTheme">{{ theme === "dark" ? "Light" : "Dark" }}</button>
        </div>
      </header>
      <p v-if="drag.error.value" class="form-error boards-drag-error">{{ drag.error.value }}</p>

      <div
        v-if="draggedIsNested && drag.canDrop('')"
        class="drop-root boards-drop-top"
        :class="{ 'drop-target': drag.over.value === '' }"
        @dragover="drag.hover($event, '')"
        @dragleave="drag.leave('')"
        @drop="drag.drop($event, '')"
      >
        Drop here to make it a top-level board
      </div>

      <p v-if="boards && !boards.tree.length" class="empty">No boards yet.</p>

      <div v-if="boards?.tree.length" class="drop-rows">
        <div v-for="row in rows" :key="row.board.path" class="drop-row">
          <div
            v-if="confirming === row.board.path"
            class="drop-cell drop-cell-board drop-cell-confirm"
          >
            <p>
              Delete {{ row.board.label }}?
              <template v-if="descendantCount(row.top)">
                and its {{ descendantCount(row.top) }} sub-boards
              </template>
              <span class="muted"> Refs stay in the library.</span>
            </p>
            <div class="cell-confirm-actions">
              <button type="button" class="quiet" @click="confirmDelete(row.board.path)">
                Delete
              </button>
              <button type="button" class="quiet" @click="cancelConfirm">Cancel</button>
            </div>
            <p v-if="confirmError" class="form-error">{{ confirmError }}</p>
          </div>
          <NuxtLink
            v-else
            :to="`/b/${row.board.path}`"
            class="drop-cell drop-cell-board"
            :class="cellClass(row.board.path)"
            draggable="true"
            @click="onCellClick"
            @dragstart="drag.start($event, row.board.path)"
            @dragend="drag.end"
            @dragover="drag.hover($event, row.board.path)"
            @dragleave="drag.leave(row.board.path)"
            @drop="drag.drop($event, row.board.path)"
          >
            <button
              type="button"
              class="quiet cell-delete"
              @click.prevent.stop="startConfirm(row.board.path)"
            >
              Delete
            </button>
            <span class="drop-cell-name">{{ row.board.label }}</span>
            <span class="drop-cell-count">{{ row.board.count }}</span>
          </NuxtLink>

          <div class="drop-row-subs">
            <template v-for="c in row.subs" :key="c.path">
              <div
                v-if="confirming === c.path"
                class="drop-cell drop-cell-confirm"
              >
                <p>
                  Delete {{ c.label }}?
                  <template v-if="descendantCount(findNode(c.path))">
                    and its {{ descendantCount(findNode(c.path)) }} sub-boards
                  </template>
                  <span class="muted"> Refs stay in the library.</span>
                </p>
                <div class="cell-confirm-actions">
                  <button type="button" class="quiet" @click="confirmDelete(c.path)">Delete</button>
                  <button type="button" class="quiet" @click="cancelConfirm">Cancel</button>
                </div>
                <p v-if="confirmError" class="form-error">{{ confirmError }}</p>
              </div>
              <NuxtLink
                v-else
                :to="`/b/${c.path}`"
                class="drop-cell"
                :class="cellClass(c.path)"
                draggable="true"
                @click="onCellClick"
                @dragstart="drag.start($event, c.path)"
                @dragend="drag.end"
                @dragover="drag.hover($event, c.path)"
                @dragleave="drag.leave(c.path)"
                @drop="drag.drop($event, c.path)"
              >
                <button type="button" class="quiet cell-delete" @click.prevent.stop="startConfirm(c.path)">
                  Delete
                </button>
                <span v-if="c.parent" class="drop-cell-parent">{{ c.parent }} /</span>
                <span class="drop-cell-name">{{ c.label }}</span>
                <span class="drop-cell-count">{{ c.count }}</span>
              </NuxtLink>
            </template>

            <div class="drop-cell drop-cell-add">
              <input
                v-model="subDraft[row.board.path]"
                type="text"
                class="board-inline-input"
                placeholder="+ Sub-board"
                @input="clearSubError(row.board.path)"
                @keydown.enter="createSub(row.board.path)"
                @keydown.esc.stop="cancelSub(row.board.path, $event)"
              />
              <p v-if="subError[row.board.path]" class="form-error">{{ subError[row.board.path] }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="drop-rows">
        <div class="drop-row drop-row-new-top">
          <div class="drop-cell drop-cell-add">
            <input
              ref="topInput"
              v-model="topDraft"
              type="text"
              class="board-inline-input"
              placeholder="+ New board"
              @input="clearTopError"
              @keydown.enter="createTop"
              @keydown.esc.stop="cancelTop"
            />
            <p v-if="topError" class="form-error">{{ topError }}</p>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
