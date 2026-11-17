<script setup lang="ts">
import { UiIcon } from '../../../../shared/ui';
import TaskCard from './TaskCard.vue';
import { STATUS_COLOR, STATUS_LABEL } from '../format';
import type { TaskCardData, TaskStatus } from '../view';

const props = withDefaults(
  defineProps<{
    status: TaskStatus;
    tasks: TaskCardData[];
    /** Show the dashed drop placeholder (a card is being dragged over this column). */
    dropTarget?: boolean;
    liftedTaskId?: string | null;
    canAdd?: boolean;
  }>(),
  { dropTarget: false, liftedTaskId: null, canAdd: true },
);
const emit = defineEmits<{
  add: [status: TaskStatus];
  open: [id: string];
  dragTask: [id: string | null];
  dragOver: [status: TaskStatus];
  dropTask: [status: TaskStatus];
}>();

function onDragStart(event: DragEvent, id: string): void {
  event.dataTransfer?.setData('text/plain', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  emit('dragTask', id);
}
function onDragOver(): void {
  emit('dragOver', props.status);
}
</script>

<template>
  <section class="col" :data-status="status" :aria-label="STATUS_LABEL[status]" @dragover.prevent="onDragOver" @drop.prevent="emit('dropTask', status)">
    <header class="col__head" :style="{ background: STATUS_COLOR[status] }">
      <h2 class="col__name">{{ STATUS_LABEL[status] }}</h2>
      <span class="col__n mono">{{ tasks.length }}</span>
      <button
        v-if="canAdd"
        type="button"
        class="col__plus focus-ring"
        :aria-label="`Task baru di ${STATUS_LABEL[status]}`"
        @click="emit('add', status)"
      >
        <UiIcon name="plus" :size="15" :stroke="2.4" />
      </button>
    </header>
    <template v-for="task in tasks" :key="task.id">
      <TaskCard
        :task="task"
        :lifted="task.id === liftedTaskId"
        draggable
        @open="emit('open', $event)"
        @dragstart="onDragStart($event, task.id)"
        @dragend="emit('dragTask', null)"
      />
      <div v-if="dropTarget && task.id === liftedTaskId" class="col__drop" aria-hidden="true" />
    </template>
    <div v-if="dropTarget && !tasks.some((task) => task.id === liftedTaskId)" class="col__drop" aria-hidden="true" />
    <p v-if="tasks.length === 0 && !dropTarget" class="col__empty">Belum ada task</p>
  </section>
</template>

<style scoped>
.col {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.col__head {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--r-card);
  padding: 11px 13px;
  color: #fff;
}
.col__name {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.col__n {
  margin-left: auto;
  font-size: 13px;
  font-weight: 700;
  background: rgba(0, 0, 0, 0.22);
  border-radius: var(--r-block);
  padding: 1px 7px;
}
.col__plus {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: #fff;
  opacity: 0.85;
  cursor: pointer;
}
.col__drop {
  border: 1.5px dashed var(--dash);
  border-radius: var(--r-card);
  height: 62px;
  flex-shrink: 0;
}
.col__empty {
  margin: 4px 2px;
  font-size: 12px;
  color: var(--mute);
}
</style>
