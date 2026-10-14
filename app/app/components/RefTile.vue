<script setup lang="ts">
import type { RefListItem } from "../types";

const props = defineProps<{
  item: RefListItem;
  columns: number;
  viewBoardPath?: string;
  selected?: boolean;
  selecting?: boolean;
}>();

const emit = defineEmits<{ open: []; select: [range: boolean]; press: [e: PointerEvent] }>();

// Once anything is selected, a click on a tile selects instead of opening.
function onClick(e: MouseEvent) {
  if (props.selecting || e.metaKey || e.ctrlKey || e.shiftKey) emit("select", e.shiftKey);
  else emit("open");
}

const dpr = import.meta.client ? window.devicePixelRatio || 1 : 1;
// Rounded up to a 200px step so the thumbnail cache is not filled with near-identical sizes.
const thumbW = computed(() => {
  const grid = import.meta.client ? window.innerWidth - 260 : 1200;
  return Math.max(200, Math.ceil((grid / props.columns) * dpr / 200) * 200);
});

const isLink = computed(() => !props.item.ref.file && !!props.item.ref.url);

const host = computed(() => {
  const u = props.item.ref.url ?? props.item.ref.source;
  if (!u) return "";
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
});

const aspectStyle = computed(() => {
  const w = props.item.ref.width;
  const h = props.item.ref.height;
  if (w && h) return { aspectRatio: `${w} / ${h}` };
  return {};
});

const viaBoardLabel = computed(() => {
  const via = props.item.viaBoard;
  const root = props.viewBoardPath;
  if (!via || !root || via === root) return "";
  const prefix = `${root}/`;
  if (via.startsWith(prefix)) return via.slice(prefix.length);
  return via;
});
</script>

<template>
  <article
    class="tile"
    :class="{ selected, selecting }"
    :data-ref-id="item.ref.id"
    @click="onClick"
    @pointerdown="emit('press', $event)"
  >
    <button
      type="button"
      class="tile-check"
      :aria-pressed="selected"
      :aria-label="selected ? 'Deselect' : 'Select'"
      @click.stop="emit('select', $event.shiftKey)"
    />
    <div v-if="isLink" class="tile-wrap tile-link">
      <span v-if="item.key" class="tile-key">KEY</span>
      <div class="host">{{ host }}</div>
      <div class="url">{{ item.ref.url }}</div>
    </div>
    <div v-else class="tile-wrap" :style="aspectStyle">
      <span v-if="item.key" class="tile-key">KEY</span>
      <img
        :src="`/thumb/${item.ref.id}?w=${thumbW}`"
        :alt="item.ref.title || item.ref.id"
        loading="lazy"
        draggable="false"
      />
    </div>
    <p v-if="viaBoardLabel" class="tile-via muted">{{ viaBoardLabel }}</p>
    <p v-if="item.boardNote || item.ref.note" class="tile-note">
      {{ item.boardNote || item.ref.note }}
    </p>
  </article>
</template>
