<script setup lang="ts">
import type { BoardTreeNode } from "../types";

const props = defineProps<{
  tree: BoardTreeNode[];
  allCount: number;
  unsortedCount: number;
  currentKind: "all" | "unsorted" | "board";
  currentBoard?: string;
}>();

const emit = defineEmits<{ refresh: [] }>();

// Inline forms instead of window.prompt/confirm, which embedded browsers block.
type Mode = "new" | "sub" | "rename" | "delete" | null;
const mode = ref<Mode>(null);
const text = ref("");
const error = ref("");
const field = ref<HTMLInputElement | null>(null);

const onBoard = computed(() => props.currentKind === "board" && !!props.currentBoard);

async function start(m: Mode) {
  mode.value = m;
  error.value = "";
  text.value = m === "rename" ? (props.currentBoard ?? "") : "";
  await nextTick();
  field.value?.focus();
}

function cancel() {
  mode.value = null;
  error.value = "";
}

async function submit() {
  const value = text.value.trim().replace(/^\/+|\/+$/g, "");
  if (!value) return;
  try {
    if (mode.value === "rename") {
      if (value !== props.currentBoard) {
        await $fetch("/api/boards", { method: "PATCH", body: { from: props.currentBoard, to: value } });
      }
      emit("refresh");
      cancel();
      await navigateTo(`/b/${value}`);
      return;
    }
    const path = mode.value === "sub" ? `${props.currentBoard}/${value}` : value;
    await $fetch("/api/boards", { method: "POST", body: { path } });
    emit("refresh");
    cancel();
    await navigateTo(`/b/${path}`);
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || "Could not save";
  }
}

async function deleteBoard() {
  if (!props.currentBoard) return;
  try {
    await $fetch("/api/boards", { method: "DELETE", query: { path: props.currentBoard } });
    emit("refresh");
    cancel();
    await navigateTo("/");
  } catch (err: any) {
    error.value = err?.data?.statusMessage || "Could not delete";
  }
}

watch(() => [props.currentKind, props.currentBoard], cancel);

const drag = useBoardDrag();
</script>

<template>
  <aside class="sidebar">
    <NuxtLink to="/" class="app-name">_refs</NuxtLink>
    <nav class="sidebar-nav">
      <NuxtLink to="/" :class="{ selected: currentKind === 'all' }">
        <span>All refs</span>
        <span class="count">{{ allCount }}</span>
      </NuxtLink>
      <NuxtLink to="/unsorted" :class="{ selected: currentKind === 'unsorted' }">
        <span>Unsorted</span>
        <span class="count">{{ unsortedCount }}</span>
      </NuxtLink>
    </nav>
    <div class="board-tree">
      <BoardTreeNode
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :current="currentBoard"
      />
    </div>
    <div
      v-if="drag.dragged.value && drag.canDrop('')"
      class="drop-root"
      :class="{ 'drop-target': drag.over.value === '' }"
      @dragover="drag.hover($event, '')"
      @dragleave="drag.leave('')"
      @drop="drag.drop($event, '')"
    >
      Move to top level
    </div>
    <p v-if="drag.error.value" class="form-error">{{ drag.error.value }}</p>
    <div class="sidebar-actions">
      <template v-if="mode === 'new' || mode === 'sub' || mode === 'rename'">
        <label class="muted">
          {{ mode === "new" ? "New board" : mode === "sub" ? `New board in ${currentBoard}` : "Rename to" }}
        </label>
        <input
          ref="field"
          v-model="text"
          type="text"
          :placeholder="mode === 'rename' ? 'Board path' : 'Board name'"
          @keydown.enter="submit"
          @keydown.esc.stop="cancel"
        />
        <div class="row">
          <button type="button" @click="submit">{{ mode === "rename" ? "Rename" : "Create" }}</button>
          <button type="button" @click="cancel">Cancel</button>
        </div>
      </template>
      <template v-else-if="mode === 'delete'">
        <p class="muted">Delete "{{ currentBoard }}"? Its refs stay in the library.</p>
        <div class="row">
          <button type="button" @click="deleteBoard">Delete</button>
          <button type="button" @click="cancel">Cancel</button>
        </div>
      </template>
      <template v-else>
        <button type="button" @click="start('new')">New board</button>
        <button v-if="onBoard" type="button" @click="start('sub')">New sub-board</button>
        <button v-if="onBoard" type="button" @click="start('rename')">Rename board</button>
        <button v-if="onBoard" type="button" @click="start('delete')">Delete board</button>
      </template>
      <p v-if="error" class="form-error">{{ error }}</p>
    </div>
    <footer class="app-footer">
      <span>© 2026 ccmlabs</span>
      <span>
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener">CC BY 4.0</a>
        · code MIT
      </span>
    </footer>
  </aside>
</template>
