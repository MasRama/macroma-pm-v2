<script setup lang="ts">
import UiIcon from './UiIcon.vue';

withDefaults(defineProps<{ label?: string; tone?: 'page' | 'block' }>(), { label: 'Tutup', tone: 'page' });
</script>

<template>
  <button type="button" class="x focus-ring" :class="`x--${tone}`" :aria-label="label">
    <UiIcon name="x" :size="16" :stroke="2" />
  </button>
</template>

<style scoped>
.x {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.x--block {
  border-color: var(--block-raise-line);
  color: var(--block-fg);
}
</style>
