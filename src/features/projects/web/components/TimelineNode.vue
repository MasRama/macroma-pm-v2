<script setup lang="ts">
import { formatStamp, UiAvatar, UiIcon } from '../../../../shared/ui';
import StatusBlock from './StatusBlock.vue';
import VersionText from './VersionText.vue';
import type { TaskLogEntry } from '../view';

/** One version in a task's history: square node (filled when latest), from → to, timestamp, note card. */
withDefaults(defineProps<{ entry: TaskLogEntry; latest?: boolean; last?: boolean }>(), { latest: false, last: false });
</script>

<template>
  <li class="node" :class="{ 'node--last': last }">
    <div class="node__rail" aria-hidden="true">
      <i class="node__dot" :class="{ 'node__dot--on': latest }" />
      <i v-if="!last" class="node__line" />
    </div>
    <div class="node__body">
      <div class="node__head">
        <VersionText class="node__ver" :class="{ 'node__ver--latest': latest }" :version="entry.version" />
        <div class="node__move">
          <template v-if="entry.from">
            <StatusBlock :status="entry.from" />
            <span class="node__arrow"><UiIcon name="arrow" :size="14" :stroke="2.2" /></span>
          </template>
          <span v-else class="node__created">Dibuat di</span>
          <StatusBlock :status="entry.to" />
        </div>
        <time class="node__when" :datetime="entry.at">{{ formatStamp(entry.at) }}</time>
      </div>
      <div class="node__note">
        <UiAvatar :person="entry.author" :size="22" />
        <p><b>{{ entry.author.name }}</b> <span>{{ entry.note }}</span></p>
      </div>
    </div>
  </li>
</template>

<style scoped>
.node {
  display: flex;
  gap: 16px;
  padding-bottom: 20px;
  list-style: none;
}
.node--last {
  padding-bottom: 0;
}
.node__rail {
  width: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 6px;
}
.node__dot {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border-radius: 3px;
  border: 2px solid var(--ink);
  background: var(--card);
}
.node__dot--on {
  background: var(--ink);
}
.node__line {
  flex: 1;
  width: 2px;
  margin-top: 4px;
  background: var(--line);
}
.node__body {
  flex: 1;
  min-width: 0;
}
.node__head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.node__ver {
  font-size: 15px;
  font-weight: 700;
}
.node__ver--latest {
  font-size: 18px;
}
.node__move {
  display: flex;
  align-items: center;
  gap: 6px;
}
.node__arrow {
  display: flex;
  color: var(--mute);
}
.node__created {
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
}
.node__when {
  margin-left: auto;
  font-size: 12px;
  color: var(--mute);
}
.node__note {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  font-size: 13.5px;
  line-height: 1.5;
}
.node__note p {
  margin: 0;
}
.node__note b {
  font-weight: 600;
}
.node__note span {
  color: var(--ink2);
}
</style>
