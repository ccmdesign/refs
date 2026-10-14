<script setup lang="ts">
import type { BoardTreeNode } from "../types";
import type { RefDragState } from "../composables/useRefDrag";

const props = defineProps<{
  tree: BoardTreeNode[];
  drag: RefDragState;
  bindGhost: (el: unknown) => void;
  currentBoard?: string;
}>();

type Cell = { path: string; label: string; parent?: string; count: number };

// One row per top-level board: the board itself, then every board below it,
// in tree order, as columns.
const rows = computed(() =>
  props.tree.map((top) => {
    const subs: Cell[] = [];
    const walk = (nodes: BoardTreeNode[]) => {
      for (const n of nodes) {
        const rel = n.path.slice(top.path.length + 1);
        const cut = rel.lastIndexOf("/");
        subs.push({ path: n.path, label: n.name, parent: cut > 0 ? rel.slice(0, cut) : undefined, count: n.count });
        walk(n.children);
      }
    };
    walk(top.children);
    return { board: { path: top.path, label: top.name, count: top.count } as Cell, subs };
  }),
);

const heading = computed(() => {
  const n = props.drag.ids.length;
  return n === 1 ? "Move this ref to" : `Move ${n} refs to`;
});

function cellClass(path: string) {
  return {
    over: props.drag.over === path,
    landing: props.drag.landing === path,
    current: path === props.currentBoard,
  };
}
</script>

<template>
  <Teleport to="body">
    <div v-if="drag.active" class="drop-grid" role="dialog" aria-label="Choose a board">
      <p class="drop-grid-heading">{{ heading }}</p>
      <div class="drop-rows">
        <div v-for="(row, r) in rows" :key="row.board.path" class="drop-row" :style="{ '--row': r }">
          <div
            class="drop-cell drop-cell-board"
            :class="cellClass(row.board.path)"
            :data-drop-board="row.board.path"
            :aria-disabled="row.board.path === currentBoard ? 'true' : undefined"
          >
            <span class="drop-cell-name">{{ row.board.label }}</span>
            <span class="drop-cell-count">{{ row.board.path === currentBoard ? "Here now" : row.board.count }}</span>
          </div>
          <div class="drop-row-subs">
            <div
              v-for="c in row.subs"
              :key="c.path"
              class="drop-cell"
              :class="cellClass(c.path)"
              :data-drop-board="c.path"
              :aria-disabled="c.path === currentBoard ? 'true' : undefined"
            >
              <span v-if="c.parent" class="drop-cell-parent">{{ c.parent }} /</span>
              <span class="drop-cell-name">{{ c.label }}</span>
              <span class="drop-cell-count">{{ c.path === currentBoard ? "Here now" : c.count }}</span>
            </div>
            <p v-if="!row.subs.length" class="drop-row-empty">No sub-boards</p>
          </div>
        </div>
      </div>
      <p class="drop-grid-hint">Release over a board to move. Release anywhere else, or press Esc, to cancel.</p>
    </div>
    <div
      v-if="drag.active"
      :ref="bindGhost"
      class="drag-stack"
      :class="{ group: drag.ids.length > 1 }"
      aria-hidden="true"
    >
      <img v-for="(src, i) in drag.thumbs" :key="src" :src="src" alt="" :style="{ '--i': i }" />
      <span v-if="!drag.thumbs.length" class="drag-stack-blank" />
      <span v-if="drag.ids.length > 1" class="drag-stack-count">{{ drag.ids.length }}</span>
    </div>
  </Teleport>
</template>
