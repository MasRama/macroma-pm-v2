<script setup lang="ts">
import { STATUS_BAR_COLOR, STATUS_LABEL } from '../format';
import { TASK_STATUSES, type StatusCounts } from '../view';

/** On the ink batch strip the legend text is light; on a white panel it is muted. Counts are optional. */
withDefaults(defineProps<{ counts?: StatusCounts; tone?: 'block' | 'page' }>(), { counts: undefined, tone: 'page' });
</script>

<template>
  <ul class="leg" :class="`leg--${tone}`">
    <li v-for="status in TASK_STATUSES" :key="status">
      <i :style="{ background: STATUS_BAR_COLOR[status] }" />{{ counts ? `${STATUS_LABEL[status]} ${counts[status]}` : STATUS_LABEL[status] }}
    </li>
  </ul>
</template>

<style scoped>
.leg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 11.5px;
}
.leg--block {
  color: var(--block-soft);
}
.leg--page {
  color: var(--mute);
}
.leg li {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.leg i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
</style>
