<script setup lang="ts">
import { formatAgo, UiAvatar } from '../../../../shared/ui';
import StatusBlock from './StatusBlock.vue';
import VersionText from './VersionText.vue';
import type { ActivityEntry, ActivityKind } from '../view';

withDefaults(defineProps<{ entry: ActivityEntry; now?: Date }>(), { now: () => new Date() });

/** How a task event reads when the row names its task: "<verb> <b>title</b>". */
const TASK_VERBS: Partial<Record<ActivityKind, string>> = {
  created: 'bikin task',
  moved: 'mindahin',
  completed: 'nyelesaiin',
  commented: 'komentar di',
  edited: 'ngedit',
  deleted: 'hapus task',
  'image-added': 'nambah gambar di',
  'image-removed': 'hapus gambar di',
};
</script>

<template>
  <li class="act">
    <UiAvatar :person="entry.actor" :size="28" />
    <div class="act__body">
      <p class="act__text">
        <b>{{ entry.actor.name }}</b>
        <template v-if="entry.task && TASK_VERBS[entry.kind]">{{ ` ${TASK_VERBS[entry.kind]} ` }}<b>{{ entry.task }}</b>{{ entry.kind === 'moved' ? ' ke' : '' }}</template>
        <template v-else-if="entry.kind === 'moved'"> mindahin task di <b>{{ entry.subject }}</b> ke</template>
        <template v-else-if="entry.kind === 'completed'"> nyelesaiin task di <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'commented'"> komentar di <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'bumped'"> bump <b>{{ entry.subject }}</b> ke batch{{ entry.version ? '' : ' baru' }}</template>
        <template v-else-if="entry.kind === 'batch-created'"> buka batch baru di <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'project-created'"> bikin project <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'edited'"> ngedit task di <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'deleted'"> hapus task di <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'image-added'"> nambah gambar di <b>{{ entry.subject }}</b></template>
        <template v-else-if="entry.kind === 'image-removed'"> hapus gambar di <b>{{ entry.subject }}</b></template>
        <template v-else> bikin task di <b>{{ entry.subject }}</b></template>
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
