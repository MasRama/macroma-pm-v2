<script setup lang="ts">
import StatusBar from './StatusBar.vue';
import StatusLegend from './StatusLegend.vue';
import VersionText from './VersionText.vue';
import { formatDay } from '../../../../shared/ui';
import { totalCount } from '../format';
import type { BatchSummary } from '../view';

withDefaults(defineProps<{ batch: BatchSummary; compact?: boolean }>(), { compact: false });
</script>

<template>
  <section v-if="!compact" class="batch" :aria-label="`Batch v${batch.major}.${batch.minor}`">
    <VersionText class="batch__ver" :version="batch" />
    <div class="batch__lab">
      <small>{{ batch.isActive ? 'Batch aktif' : 'Batch' }} · dibuka {{ formatDay(batch.openedAt) }}</small>
      <b>{{ batch.label }}</b>
    </div>
    <div class="batch__bar">
      <StatusBar :counts="batch.counts" />
      <StatusLegend :counts="batch.counts" tone="block" />
    </div>
    <div class="batch__stat">
      <b>{{ batch.counts.done }}<em>/{{ totalCount(batch.counts) }}</em></b>
      <small>task selesai</small>
    </div>
  </section>
  <section v-else class="batch batch--compact" :aria-label="`Batch v${batch.major}.${batch.minor}`">
    <div class="batch__row">
      <VersionText class="batch__ver--sm" :version="batch" />
      <span class="batch__label-sm">{{ batch.label }}</span>
      <span class="batch__count-sm"><b>{{ batch.counts.done }}</b><em>/{{ totalCount(batch.counts) }}</em></span>
    </div>
    <StatusBar class="batch__track-sm" :counts="batch.counts" :height="7" :gap="2" />
  </section>
</template>

<style scoped>
.batch {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 16px 22px;
  border-radius: var(--r-panel);
  background: var(--block);
  border: 1px solid var(--block-line);
  color: var(--block-fg);
}
.batch__ver {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.batch__lab {
  flex-shrink: 0;
}
.batch__lab small {
  display: block;
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 500;
  color: var(--block-meta);
}
.batch__lab b {
  font-size: 15px;
  font-weight: 600;
}
.batch__bar {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.batch__stat {
  text-align: right;
  flex-shrink: 0;
}
.batch__stat b {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.batch__stat em {
  font-style: normal;
  font-size: 16px;
  color: var(--block-dim);
}
.batch__stat small {
  display: block;
  font-size: 11.5px;
  color: var(--block-meta);
}
.batch--compact {
  display: block;
  padding: 12px 14px;
}
.batch__row {
  display: flex;
  align-items: center;
}
.batch__ver--sm {
  font-size: 20px;
  font-weight: 700;
}
.batch__label-sm {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.batch__count-sm {
  margin-left: auto;
  padding-left: 10px;
  font-size: 13px;
}
.batch__count-sm em {
  font-style: normal;
  color: var(--block-dim);
}
.batch__track-sm {
  margin-top: 10px;
}
</style>
