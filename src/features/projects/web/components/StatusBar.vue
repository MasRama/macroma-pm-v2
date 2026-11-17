<script setup lang="ts">
import { computed } from 'vue';
import { STATUS_BAR_COLOR, STATUS_LABEL, totalCount } from '../format';
import { TASK_STATUSES, type StatusCounts } from '../view';

const props = withDefaults(defineProps<{ counts: StatusCounts; height?: number; gap?: number }>(), { height: 10, gap: 3 });

const segments = computed(() => TASK_STATUSES.filter((status) => props.counts[status] > 0));
const summary = computed(() =>
  TASK_STATUSES.map((status) => `${STATUS_LABEL[status]} ${props.counts[status]}`).join(', '),
);
</script>

<template>
  <div
    class="track"
    :class="{ 'track--empty': totalCount(counts) === 0 }"
    :style="{ height: `${height}px`, gap: `${gap}px` }"
    role="img"
    :aria-label="summary"
  >
    <i v-for="status in segments" :key="status" :style="{ flex: counts[status], background: STATUS_BAR_COLOR[status] }" />
  </div>
</template>

<style scoped>
.track {
  display: flex;
  width: 100%;
}
.track i {
  border-radius: var(--r-bar);
}
.track--empty {
  background: var(--track);
  border-radius: var(--r-bar);
}
</style>
