<script setup lang="ts">
import type { BoardTreeNode } from "../types";

defineProps<{
  tree: BoardTreeNode[];
  allCount: number;
  unsortedCount: number;
  currentKind: "all" | "unsorted" | "board" | "boards";
  currentBoard?: string;
}>();

const emit = defineEmits<{ refresh: [] }>();

const newBoardText = ref("");
const newBoardError = ref("");
const newBoardInput = ref<HTMLInputElement | null>(null);

function onNewBoardInput() {
  newBoardError.value = "";
}

async function submitNewBoard() {
  const value = newBoardText.value.trim().replace(/^\/+|\/+$/g, "");
  if (!value) return;
  try {
    await $fetch("/api/boards", { method: "POST", body: { path: value } });
    emit("refresh");
    newBoardText.value = "";
    newBoardInput.value?.blur();
    await navigateTo(`/b/${value}`);
  } catch (err: any) {
    newBoardError.value = err?.data?.statusMessage || "Could not save";
  }
}

function cancelNewBoard() {
  newBoardText.value = "";
  newBoardError.value = "";
  newBoardInput.value?.blur();
}
</script>

<template>
  <aside class="app-sidebar stack" data-space="m">
    <NuxtLink to="/" class="app-name">_refs</NuxtLink>
    <nav class="sidebar-nav" aria-label="Views">
      <NuxtLink to="/" :aria-current="currentKind === 'all' ? 'page' : undefined">
        <span>All refs</span>
        <span class="count tone-muted tabular">{{ allCount }}</span>
      </NuxtLink>
      <NuxtLink to="/unsorted" :aria-current="currentKind === 'unsorted' ? 'page' : undefined">
        <span>Unsorted</span>
        <span class="count tone-muted tabular">{{ unsortedCount }}</span>
      </NuxtLink>
      <NuxtLink to="/boards" :aria-current="currentKind === 'boards' ? 'page' : undefined">
        <span>All boards</span>
        <span class="count tone-muted tabular">{{ countBoards(tree) }}</span>
      </NuxtLink>
    </nav>
    <nav class="board-tree" aria-label="Boards">
      <BoardTreeNode
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :current="currentBoard"
      />
      <input
        ref="newBoardInput"
        v-model="newBoardText"
        type="text"
        class="new-board"
        placeholder="New board"
        aria-label="New board"
        @input="onNewBoardInput"
        @keydown.enter="submitNewBoard"
        @keydown.esc.stop="cancelNewBoard"
      />
      <p v-if="newBoardError" class="form-error new-board-error">{{ newBoardError }}</p>
    </nav>
    <footer class="app-footer">
      <span>© 2026 ccmlabs</span>
      <span>
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener">CC BY 4.0</a>
        · code MIT
      </span>
    </footer>
  </aside>
</template>
