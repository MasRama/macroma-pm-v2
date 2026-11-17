<script setup lang="ts">
import type { TaskPriority } from '../view';

const LABEL: Record<TaskPriority, string> = { low: 'Prioritas low', medium: 'Prioritas medium', high: 'Prioritas high' };
defineProps<{ priority: TaskPriority }>();
</script>

<template>
  <span class="pri" :class="`pri--${priority}`" role="img" :aria-label="LABEL[priority]"><i /><i /><i /></span>
</template>

<style scoped>
.pri {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 11px;
  flex-shrink: 0;
}
.pri i {
  width: 3px;
  background: var(--pri-off);
  border-radius: 1px;
}
.pri i:nth-child(1) {
  height: 5px;
}
.pri i:nth-child(2) {
  height: 8px;
}
.pri i:nth-child(3) {
  height: 11px;
}
.pri--high i {
  background: var(--c-revisi);
}
.pri--medium i:nth-child(-n + 2),
.pri--low i:nth-child(1) {
  background: var(--ink);
}
</style>
