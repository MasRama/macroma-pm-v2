<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AvatarStack, PageHead, SegmentedControl, UiButton, type PersonRef, type SegmentOption } from '../../../../shared/ui';
import BatchStrip from '../components/BatchStrip.vue';
import BoardColumn from '../components/BoardColumn.vue';
import BumpVersionMenu from '../components/BumpVersionMenu.vue';
import MoveTaskModal from '../components/MoveTaskModal.vue';
import NewTaskModal from '../components/NewTaskModal.vue';
import ProjectTopBar from '../components/ProjectTopBar.vue';
import TaskCard from '../components/TaskCard.vue';
import TaskDetailModal from '../components/TaskDetailModal.vue';
import { formatVersion, STATUS_COLOR, STATUS_LABEL } from '../format';
import {
  TASK_STATUSES,
  type BatchSummary,
  type BumpKind,
  type MoveTaskInput,
  type NewTaskInput,
  type ProjectSummary,
  type TaskCardData,
  type TaskDetailData,
  type TaskDetailTab,
  type TaskStatus,
} from '../view';

/**
 * Project board: page head with batch filter, members, Bump versi and Task baru;
 * the active batch strip; five status columns (one status at a time on phones).
 * Opening a task goes to the task route, which renders this page with the detail modal on top.
 */
const props = withDefaults(
  defineProps<{
    projectId: string | number;
    project?: ProjectSummary | null;
    batches?: BatchSummary[];
    tasks?: TaskCardData[];
    members?: PersonRef[];
    /** Selected batch filter: a batch id, or "all". */
    batchFilter?: string;
    canBump?: boolean;
    canCreate?: boolean;
    /** Task shown in the detail modal (task route). */
    taskId?: string | number | null;
    detail?: TaskDetailData | null;
    detailTab?: TaskDetailTab;
    busy?: boolean;
  }>(),
  {
    project: null,
    batches: () => [],
    tasks: () => [],
    members: () => [],
    batchFilter: 'all',
    canBump: false,
    canCreate: true,
    taskId: null,
    detail: null,
    detailTab: 'detail',
    busy: false,
  },
);
const emit = defineEmits<{
  'update:batchFilter': [value: string];
  createTask: [input: NewTaskInput];
  moveTask: [input: MoveTaskInput];
  bump: [kind: BumpKind];
  editTask: [id: number];
  deleteTask: [id: number];
  comment: [taskId: number, body: string];
  upload: [taskId: number, files: File[]];
}>();

const router = useRouter();

const activeBatch = computed(() => props.batches.find((batch) => batch.isActive) ?? null);
const batchOptions = computed<SegmentOption[]>(() => [
  ...[...props.batches]
    .sort((a, b) => a.major - b.major || a.minor - b.minor)
    .slice(-3)
    .map((batch) => ({ value: String(batch.id), label: formatVersion(batch), mono: true })),
  { value: 'all', label: 'Semua' },
]);
const filter = computed({
  get: () => props.batchFilter,
  set: (value: string) => emit('update:batchFilter', value),
});

const byStatus = computed(() => {
  const columns = Object.fromEntries(TASK_STATUSES.map((status) => [status, [] as TaskCardData[]])) as Record<
    TaskStatus,
    TaskCardData[]
  >;
  for (const task of props.tasks) columns[task.status].push(task);
  return columns;
});

const newTaskOpen = ref(false);
const moving = ref<TaskCardData | null>(null);
const moveTarget = ref<TaskStatus | null>(null);
const dragging = ref<number | null>(null);
const dragOver = ref<TaskStatus | null>(null);
const phoneStatus = ref<TaskStatus>('ongoing');

function findTask(id: number): TaskCardData | null {
  return props.tasks.find((task) => task.id === id) ?? null;
}

function openTask(id: number): void {
  void router.push({ name: 'project-task', params: { projectId: props.projectId, taskId: id } });
}
function closeTask(): void {
  void router.push({ name: 'project-board', params: { projectId: props.projectId } });
}

function onDrop(status: TaskStatus): void {
  const task = dragging.value === null ? null : findTask(dragging.value);
  dragging.value = null;
  dragOver.value = null;
  if (!task || task.status === status) return;
  moving.value = task;
  moveTarget.value = status;
}
function onDragTask(id: number | null): void {
  dragging.value = id;
  if (id === null) dragOver.value = null;
}

function startMove(): void {
  if (!props.detail) return;
  moving.value = props.detail;
  moveTarget.value = null;
}
function submitMove(input: MoveTaskInput): void {
  emit('moveTask', input);
  moving.value = null;
}
function submitNewTask(input: NewTaskInput): void {
  emit('createTask', input);
  newTaskOpen.value = false;
}
</script>

<template>
  <div class="board-page">
    <ProjectTopBar
      :project-id="projectId"
      :project-name="project?.name ?? 'Project'"
      :workspace-name="project?.workspaceName"
      active="board"
    />

    <PageHead class="board-page__head" :title="project?.name ?? 'Board'" :description="project?.description ?? undefined">
      <template #middle>
        <SegmentedControl v-if="batches.length" v-model="filter" :options="batchOptions" label="Batch" />
      </template>
      <template #actions>
        <AvatarStack v-if="members.length" class="board-page__members" :people="members" />
        <BumpVersionMenu v-if="canBump && activeBatch" :current="activeBatch" @bump="emit('bump', $event)" />
        <UiButton v-if="canCreate" variant="primary" icon="plus" @click="newTaskOpen = true">Task baru</UiButton>
      </template>
    </PageHead>

    <div class="board-page__phone-head">
      <small v-if="project?.workspaceName">{{ project.workspaceName }}</small>
      <h1>{{ project?.name ?? 'Board' }}</h1>
    </div>

    <BatchStrip v-if="activeBatch" class="board-page__strip" :batch="activeBatch" />
    <BatchStrip v-if="activeBatch" class="board-page__strip-phone" :batch="activeBatch" compact />

    <div class="board" @dragend="onDragTask(null)">
      <BoardColumn
        v-for="status in TASK_STATUSES"
        :key="status"
        :status="status"
        :tasks="byStatus[status]"
        :can-add="canCreate"
        :drop-target="dragging !== null && dragOver === status && findTask(dragging)?.status !== status"
        :lifted-task-id="dragging"
        @add="newTaskOpen = true"
        @open="openTask"
        @drag-task="onDragTask"
        @drag-over="dragOver = $event"
        @drop-task="onDrop"
      />
    </div>

    <div class="phone-board">
      <div class="phone-board__tabs" role="tablist" aria-label="Status">
        <button
          v-for="status in TASK_STATUSES"
          :key="status"
          type="button"
          role="tab"
          class="phone-board__tab focus-ring"
          :class="{ 'phone-board__tab--on': status === phoneStatus }"
          :style="status === phoneStatus ? { background: STATUS_COLOR[status] } : undefined"
          :aria-selected="status === phoneStatus"
          @click="phoneStatus = status"
        >
          {{ STATUS_LABEL[status] }} <span class="mono">{{ byStatus[status].length }}</span>
        </button>
      </div>
      <div class="phone-board__list">
        <TaskCard v-for="task in byStatus[phoneStatus]" :key="task.id" :task="task" size="lg" @open="openTask" />
        <p v-if="byStatus[phoneStatus].length === 0" class="phone-board__empty">Belum ada task</p>
      </div>
      <div v-if="canCreate" class="phone-board__bar">
        <UiButton variant="primary" size="lg" block icon="plus" @click="newTaskOpen = true">Task baru</UiButton>
      </div>
    </div>

    <NewTaskModal
      v-if="activeBatch"
      :open="newTaskOpen"
      :batch="activeBatch"
      :members="members"
      :busy="busy"
      @close="newTaskOpen = false"
      @submit="submitNewTask"
    />
    <MoveTaskModal
      :open="moving !== null"
      :task="moving"
      :initial-target="moveTarget"
      :busy="busy"
      @close="moving = null"
      @submit="submitMove"
    />
    <TaskDetailModal
      :open="taskId !== null && detail !== null && moving === null"
      :task="detail"
      :initial-tab="detailTab"
      @close="closeTask"
      @move="startMove"
      @edit="detail && emit('editTask', detail.id)"
      @delete="detail && emit('deleteTask', detail.id)"
      @comment="detail && emit('comment', detail.id, $event)"
      @upload="detail && emit('upload', detail.id, $event)"
    />
  </div>
</template>

<style scoped>
.board-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.board-page__members {
  margin-right: 6px;
}
.board-page__strip {
  margin: 0 28px;
}
.board-page__phone-head,
.board-page__strip-phone,
.phone-board {
  display: none;
}
.board {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  padding: 18px 28px 18px;
  overflow-y: auto;
}

@media (max-width: 760px) {
  .board-page__head,
  .board-page__strip,
  .board {
    display: none;
  }
  .board-page__phone-head {
    display: block;
    padding: 14px 16px 0;
  }
  .board-page__phone-head small {
    display: block;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--mute);
  }
  .board-page__phone-head h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.04em;
  }
  .board-page__strip-phone {
    display: block;
    margin: 12px 16px 0;
  }
  .phone-board {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .phone-board__tabs {
    display: flex;
    gap: 6px;
    padding: 14px 16px 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .phone-board__tab {
    flex-shrink: 0;
    border: 1.5px solid var(--line);
    border-radius: var(--r-small);
    padding: 7px 11px;
    background: none;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink2);
    white-space: nowrap;
    cursor: pointer;
  }
  .phone-board__tab--on {
    border-color: transparent;
    color: #fff;
    font-weight: 700;
  }
  .phone-board__list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .phone-board__empty {
    margin: 24px 0;
    text-align: center;
    font-size: 13px;
    color: var(--mute);
  }
  .phone-board__bar {
    position: sticky;
    bottom: 0;
    padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
}
</style>
