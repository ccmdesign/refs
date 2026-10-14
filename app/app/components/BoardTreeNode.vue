<script setup lang="ts">
import type { BoardTreeNode } from "../types";

defineProps<{
  node: BoardTreeNode;
  current?: string;
  depth?: number;
}>();

const drag = useBoardDrag();
</script>

<template>
  <div>
    <NuxtLink
      :to="`/b/${node.path}`"
      class="linkish"
      :class="{
        selected: current === node.path,
        'drop-target': drag.over.value === node.path,
        dragging: drag.dragged.value === node.path,
      }"
      draggable="true"
      @dragstart="drag.start($event, node.path)"
      @dragend="drag.end"
      @dragover="drag.hover($event, node.path)"
      @dragleave="drag.leave(node.path)"
      @drop="drag.drop($event, node.path)"
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
