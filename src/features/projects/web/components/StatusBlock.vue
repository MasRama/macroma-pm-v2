<script setup lang="ts">
import { STATUS_COLOR, STATUS_LABEL } from '../format';
import type { TaskStatus } from '../view';

defineProps<{ status: TaskStatus }>();
</script>

<template>
  <span class="blk" :style="{ background: STATUS_COLOR[status] }">{{ STATUS_LABEL[status] }}</span>
</template>

<style scoped>
.blk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--on-status);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  border-radius: var(--r-block);
  padding: 4px 8px;
  white-space: nowrap;
}
</style>
