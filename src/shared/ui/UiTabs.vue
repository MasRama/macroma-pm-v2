<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { TabOption } from './options';

defineProps<{ tabs: TabOption[]; label: string }>();
const model = defineModel<string>({ required: true });

/* When the row is wider than a phone, keep the chosen tab in sight on open and on every change. */
const list = ref<HTMLElement | null>(null);
function revealActive(): void {
  const active = list.value?.querySelector<HTMLElement>('[aria-selected="true"]');
  active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
}
onMounted(revealActive);
watch(model, () => void nextTick(revealActive));
</script>

<template>
  <div ref="list" class="tabs" role="tablist" :aria-label="label">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      class="tabs__tab focus-ring"
      :class="{ 'tabs__tab--on': tab.value === model }"
      :aria-selected="tab.value === model"
      @click="model = tab.value"
    >
      {{ tab.label }}
      <em v-if="tab.count !== undefined" class="tabs__count mono">{{ tab.count }}</em>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 22px;
  /* One line of tabs; narrow screens scroll them sideways. The rule is a
     shadow so the active tab's underline is not clipped by the scroller. */
  overflow-x: auto;
  scrollbar-width: none;
  box-shadow: inset 0 -1px 0 var(--line);
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tabs__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 11px 0;
  border: 0;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  background: none;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--mute);
}
.tabs__tab--on {
  color: var(--ink);
  border-bottom-color: var(--ink);
}
.tabs__count {
  font-style: normal;
  font-size: 11px;
  color: var(--mute);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 5px;
}
@media (max-width: 420px) {
  .tabs {
    gap: 12px;
  }
  .tabs__tab {
    gap: 4px;
    font-size: 13px;
  }
  .tabs__count {
    font-size: 10.5px;
    padding: 0 4px;
  }
}
.tabs__tab--on .tabs__count {
  background: var(--primary-bg);
  color: var(--primary-fg);
  border-color: var(--primary-bg);
}
</style>
