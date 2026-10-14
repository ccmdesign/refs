<script setup lang="ts">
import type { RefListItem } from "../types";

defineProps<{
  items: RefListItem[];
  columns: number;
  viewBoardPath?: string;
  selectedIds: string[];
}>();

const emit = defineEmits<{
  open: [index: number];
  zoom: [delta: number];
  select: [index: number, range: boolean];
  press: [index: number, e: PointerEvent];
}>();

function onWheel(e: WheelEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  emit("zoom", e.deltaY > 0 ? -1 : 1);
}
</script>

<template>
  <div
    class="masonry"
    :style="{ columnCount: columns }"
    @wheel="onWheel"
  >
    <RefTile
      v-for="(item, i) in items"
      :key="item.ref.id"
      :item="item"
      :columns="columns"
      :view-board-path="viewBoardPath"
      :selected="selectedIds.includes(item.ref.id)"
      :selecting="selectedIds.length > 0"
      @open="emit('open', i)"
      @select="(range) => emit('select', i, range)"
      @press="(e) => emit('press', i, e)"
    />
  </div>
</template>
