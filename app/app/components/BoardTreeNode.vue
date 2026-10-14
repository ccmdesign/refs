<script setup lang="ts">
import type { BoardTreeNode } from "../types";

defineProps<{
  node: BoardTreeNode;
  current?: string;
  depth?: number;
}>();
</script>

<template>
  <div>
    <NuxtLink
      :to="`/b/${node.path}`"
      class="linkish"
      :class="{ selected: current === node.path }"
    >
      <span>{{ node.name }}</span>
      <span class="count">{{ node.count }}</span>
    </NuxtLink>
    <div v-if="node.children.length" class="depth">
      <BoardTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :current="current"
        :depth="(depth ?? 0) + 1"
      />
    </div>
  </div>
</template>
