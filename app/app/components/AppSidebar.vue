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
      <NuxtLink to="/boards" :class="{ selected: currentKind === 'boards' }">
        <span>All boards</span>
        <span class="count">{{ countBoards(tree) }}</span>
      </NuxtLink>
    </nav>
    <div class="board-tree">
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
        @input="onNewBoardInput"
        @keydown.enter="submitNewBoard"
        @keydown.esc.stop="cancelNewBoard"
      />
      <p v-if="newBoardError" class="form-error new-board-error">{{ newBoardError }}</p>
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
