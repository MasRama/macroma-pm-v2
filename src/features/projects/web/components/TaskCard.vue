<script setup lang="ts">
import { UiAvatar, UiIcon } from '../../../../shared/ui';
import PriorityBars from './PriorityBars.vue';
import VersionText from './VersionText.vue';
import type { TaskCardData } from '../view';

withDefaults(
  defineProps<{
    task: TaskCardData;
    /** Being dragged: tilted, ink border, deep shadow. */
    lifted?: boolean;
    /** Larger type for the one-column mobile board. */
    size?: 'md' | 'lg';
    draggable?: boolean;
  }>(),
  { lifted: false, size: 'md', draggable: false },
);
defineEmits<{ open: [id: string] }>();
</script>

<template>
  <article
    class="card"
    :class="{
      'card--rev': task.status === 'revisi',
      'card--done': task.status === 'done',
      'card--lift': lifted,
      'card--lg': size === 'lg',
    }"
    :draggable="draggable"
    tabindex="0"
    :data-task-id="task.id"
    @click="$emit('open', task.id)"
    @keydown.enter="$emit('open', task.id)"
  >
    <div class="card__r1">
      <VersionText class="card__ver" :version="task.version" :mute-patch="task.status !== 'done'" />
      <PriorityBars class="card__pri" :priority="task.priority" />
    </div>
    <h3 class="card__title">{{ task.title }}</h3>
    <p v-if="task.description" class="card__desc">{{ task.description }}</p>
    <div v-if="task.status === 'revisi' && task.revisiCount > 0" class="card__flag">
      <UiIcon name="revert" :size="13" :stroke="2.2" />Balik dari review · {{ task.revisiCount }}x
    </div>
    <div class="card__r3">
      <span v-if="task.commentCount > 0" class="card__meta" :aria-label="`${task.commentCount} komentar`">
        <UiIcon name="chat" :size="13" :stroke="1.9" />{{ task.commentCount }}
      </span>
      <span v-if="task.attachmentCount > 0" class="card__meta" :aria-label="`${task.attachmentCount} gambar`">
        <UiIcon name="image" :size="13" :stroke="1.9" />{{ task.attachmentCount }}
      </span>
      <UiAvatar v-if="task.assignee" class="card__av" :person="task.assignee" :size="size === 'lg' ? 24 : 22" />
    </div>
  </article>
</template>

<style scoped>
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  padding: 12px 13px 11px;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  outline: none;
}
.card:focus-visible {
  border-color: var(--ink);
}
.card__r1 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}
.card__ver {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink);
}
.card__pri {
  margin-left: auto;
}
.card__title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.005em;
}
.card__desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--mute);
  line-height: 1.4;
}
.card__flag {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--c-revisi);
}
.card__r3 {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-top: 11px;
  min-height: 22px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--mute);
}
.card__meta {
  display: flex;
  align-items: center;
  gap: 4px;
}
.card__av {
  margin-left: auto;
}
.card--rev {
  border-left: 4px solid var(--c-revisi);
}
.card--done .card__title {
  color: var(--ink2);
}
.card--done .card__ver {
  color: var(--c-done);
}
.card--lift {
  transform: rotate(-1.6deg);
  box-shadow: var(--shadow-lift);
  border-color: var(--ink);
}
.card--lg .card__title {
  font-size: 15px;
}
.card--lg .card__desc {
  font-size: 13px;
}
</style>
