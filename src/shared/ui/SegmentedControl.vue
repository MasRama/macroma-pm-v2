<script setup lang="ts">
import type { SegmentOption } from './options';

withDefaults(defineProps<{ options: SegmentOption[]; label: string; variant?: 'bar' | 'field' }>(), { variant: 'bar' });
const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="seg" :class="`seg--${variant}`" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="seg__item focus-ring"
      :class="{ 'seg__item--on': option.value === model, mono: option.mono }"
      :aria-checked="option.value === model"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: flex;
  background: var(--card);
  border-radius: var(--r-control);
  padding: 3px;
}
.seg--bar {
  border: 1px solid var(--line);
}
.seg--field {
  border: 1.5px solid var(--line);
  gap: 3px;
  background: var(--field);
}
.seg__item {
  border: 0;
  background: none;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 6px;
  color: var(--ink2);
  white-space: nowrap;
}
.seg--bar .seg__item {
  padding: 6px 12px;
}
.seg--field .seg__item {
  flex: 1;
  padding: 6px 0;
  text-align: center;
}
.seg__item--on {
  background: var(--primary-bg);
  color: var(--primary-fg);
}
.seg--field .seg__item--on {
  font-weight: 700;
}
</style>
