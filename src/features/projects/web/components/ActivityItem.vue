<script setup lang="ts">
import { formatAgo, UiAvatar } from '../../../../shared/ui';
import StatusBlock from './StatusBlock.vue';
import VersionText from './VersionText.vue';
import type { ActivityEntry } from '../view';

withDefaults(defineProps<{ entry: ActivityEntry; now?: Date }>(), { now: () => new Date() });
</script>

<template>
  <li class="act">
    <UiAvatar :person="entry.actor" :size="28" />
    <div class="act__body">
      <p class="act__text">
        <b>{{ entry.actor.name }}</b>
        <template v-if="entry.kind === 'moved'"> mindahin <b>{{ entry.subject }}</b> ke</template>
        <template v-else-if="entry.kind === 'completed'"> nyelesaiin <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'commented'"> komentar di <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'bumped'"> bump <b>{{ entry.subject }}</b> ke batch</template>
        <template v-else> bikin task <b>{{ entry.subject }}</b></template>
      </p>
      <div class="act__meta">
        <StatusBlock v-if="entry.status" :status="entry.status" />
        <VersionText v-if="entry.version" class="act__ver" :version="entry.version" />
        <time class="act__when" :datetime="entry.at">{{ formatAgo(entry.at, now) }}</time>
      </div>
    </div>
  </li>
</template>

<style scoped>
.act {
  display: flex;
  gap: 11px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
  list-style: none;
}
.act:last-child {
  border-bottom: 0;
}
.act__body {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
}
.act__text {
  margin: 0;
}
.act__text b {
  font-weight: 600;
}
.act__meta {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 5px;
}
.act__ver {
  font-size: 12px;
  font-weight: 700;
}
.act__when {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--mute);
}
</style>
