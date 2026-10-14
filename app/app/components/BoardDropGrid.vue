<script setup lang="ts">
import type { BoardTreeNode } from "../types";
import type { RefDragState } from "../composables/useRefDrag";

const props = defineProps<{
  tree: BoardTreeNode[];
  drag: RefDragState;
  currentBoard?: string;
}>();

const cells = computed(() => {
  const out: { path: string; name: string; parent: string; count: number }[] = [];
  const walk = (nodes: BoardTreeNode[]) => {
    for (const n of nodes) {
      const parent = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
      out.push({ path: n.path, name: n.name, parent, count: n.count });
      walk(n.children);
    }
  };
  walk(props.tree);
  return out;
});

const heading = computed(() => {
  const n = props.drag.ids.length;
  return n === 1 ? "Move this ref to" : `Move ${n} refs to`;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="drag.active" class="drop-grid" role="dialog" aria-label="Choose a board">
      <p class="drop-grid-heading">{{ heading }}</p>
      <div class="drop-grid-cells">
        <div
          v-for="c in cells"
          :key="c.path"
          class="drop-cell"
          :class="{ over: drag.over === c.path, current: c.path === currentBoard }"
          :data-drop-board="c.path"
          :aria-disabled="c.path === currentBoard ? 'true' : undefined"
        >
          <span v-if="c.parent" class="drop-cell-parent">{{ c.parent }} /</span>
          <span class="drop-cell-name">{{ c.name }}</span>
          <span class="drop-cell-count">{{ c.path === currentBoard ? "Here now" : c.count }}</span>
        </div>
      </div>
      <p class="drop-grid-hint">Release over a board to move. Release anywhere else, or press Esc, to cancel.</p>
    </div>
    <div
      v-if="drag.active"
      class="drag-stack"
      :class="{ group: drag.ids.length > 1 }"
      :style="{ transform: `translate(${drag.x + 14}px, ${drag.y + 14}px)` }"
      aria-hidden="true"
    >
      <img v-for="(src, i) in drag.thumbs" :key="src" :src="src" alt="" :style="{ '--i': i }" />
      <span v-if="!drag.thumbs.length" class="drag-stack-blank" />
      <span v-if="drag.ids.length > 1" class="drag-stack-count">{{ drag.ids.length }}</span>
    </div>
  </Teleport>
</template>
