<script setup lang="ts">
/** Breadcrumb in the top bar: muted trail, current page bold. */
defineProps<{ trail?: string[]; current: string }>();
</script>

<template>
  <nav class="crumb" aria-label="Breadcrumb">
    <template v-for="item in trail ?? []" :key="item">{{ item }}<span class="crumb__sep">/</span></template>
    <b aria-current="page">{{ current }}</b>
  </nav>
</template>

<style scoped>
.crumb {
  font-size: 13px;
  font-weight: 500;
  color: var(--mute);
  white-space: nowrap;
}
.crumb__sep {
  padding: 0 0.55em;
}
.crumb b {
  color: var(--ink);
  font-weight: 600;
}
</style>
