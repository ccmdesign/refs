<script setup lang="ts">
const route = useRoute();
const boardPath = computed(() => {
  const slug = route.params.slug;
  if (!slug) return "";
  return Array.isArray(slug) ? slug.join("/") : String(slug);
});
</script>

<template>
  <MainView kind="board" :board-path="boardPath" />
</template>
