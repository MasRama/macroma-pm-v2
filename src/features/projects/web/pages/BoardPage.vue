<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { mergeEdit, onServerEvent } from '../../../../shared/realtime/browser';
import type { PersonRef } from '../../../../shared/ui';
import { PROJECTS_BOARD_CHANGED_EVENT, PROJECTS_CHANGED_EVENT, type ProjectsError, type Task } from '../../contract';
import type { ProjectsClient } from '../client';
import BoardView from '../components/BoardView.vue';
import EditTaskModal from '../components/EditTaskModal.vue';
import MoveTaskModal from '../components/MoveTaskModal.vue';
import NewTaskModal from '../components/NewTaskModal.vue';
import TaskDetailModal from '../components/TaskDetailModal.vue';
import { STATUS_LABEL } from '../format';
import {
  nextTaskVersion,
  toBatchSummary,
  toProjectSummary,
  toTaskCard,
  toTaskDetail,
  type BatchSummary,
  type BumpKind,
  type EditTaskField,
  type EditTaskForm,
  type MoveTaskInput,
  type NewTaskInput,
  type ProjectSummary,
  type TaskCardData,
  type TaskDetailData,
  type TaskStatus,
} from '../view';

/**
 * The board on the Projects API: the project with its batches and members,
 * the tasks of the selected batch (`?batch=<id>|all`, the active batch by
 * default) and, on the task route, the task's detail. Follows
 * `projects.changed` and `projects.board-changed`. Runs Task baru, Pindah
 * task, Edit, Hapus and Bump versi; the server decides who may, the page hides
 * what the account's role cannot do and still says why when it refuses.
 */
const props = withDefaults(
  defineProps<{
    projectId: string;
    taskId?: string | null;
    client: ProjectsClient;
    /** Names the project's workspace in the breadcrumb. */
    workspaceNameOf?: (id: string) => string | undefined;
  }>(),
  { taskId: null, workspaceNameOf: () => undefined },
);
const route = useRoute();
const router = useRouter();

type Code = ProjectsError['code'];
const REFUSALS: Partial<Record<Code, string>> = {
  FORBIDDEN: 'Akun kamu tidak boleh melakukan ini di project ini.',
  PROJECT_NOT_FOUND: 'Project ini sudah tidak ada.',
  TASK_NOT_FOUND: 'Task ini sudah tidak ada.',
  BATCH_NOT_FOUND: 'Batch itu sudah tidak ada.',
  TASK_ALREADY_IN_COLUMN: 'Task ini sudah ada di kolom itu.',
};
const say = (response: { code: Code; message: string }) => REFUSALS[response.code] ?? response.message;

const projectRow = ref<ProjectSummary | null>(null);
const batches = ref<BatchSummary[]>([]);
const members = ref<PersonRef[]>([]);
const tasks = ref<TaskCardData[]>([]);
const detail = ref<TaskDetailData | null>(null);
const gone = ref('');
const loading = ref(true);
const busy = ref(false);
const notice = ref('');

const project = computed<ProjectSummary | null>(() => {
  const row = projectRow.value;
  if (!row) return null;
  return { ...row, workspaceName: row.workspaceId ? props.workspaceNameOf(row.workspaceId) : undefined };
});
const isOwner = computed(() => project.value?.role === 'owner');
const activeBatch = computed(() => batches.value.find((batch) => batch.isActive) ?? null);

/** The batch filter: `?batch=` when it names a batch of the project, else the active batch, else every task. */
const batchFilter = computed(() => {
  const asked = typeof route.query.batch === 'string' ? route.query.batch : null;
  if (asked === 'all' || (asked && batches.value.some((batch) => batch.id === asked))) return asked;
  return activeBatch.value?.id ?? 'all';
});
function setBatchFilter(value: string): void {
  void router.replace({ query: { ...route.query, batch: value } });
}

let projectTicket = 0;
async function loadProject(): Promise<void> {
  const ticket = ++projectTicket;
  try {
    const response = await props.client.get(props.projectId);
    if (ticket !== projectTicket) return;
    if (!response.success) {
      if (response.code === 'UNAUTHORIZED') return;
      projectRow.value = null;
      gone.value =
        response.code === 'FORBIDDEN' || response.code === 'PROJECT_NOT_FOUND'
          ? 'Project ini tidak ada, atau kamu tidak punya akses ke sana.'
          : response.message;
      return;
    }
    gone.value = '';
    projectRow.value = toProjectSummary(response.data.project);
    batches.value = response.data.batches.map(toBatchSummary);
    const people = new Map<string, PersonRef>();
    for (const member of response.data.members) {
      people.set(member.user.id, { id: member.user.id, name: member.user.name || member.user.email, avatar: member.user.avatar });
    }
    members.value = [...people.values()];
  } catch (cause) {
    console.error(cause);
    if (ticket === projectTicket) notice.value = 'Project belum bisa dimuat. Coba muat ulang halaman.';
  } finally {
    if (ticket === projectTicket) loading.value = false;
  }
}

let tasksTicket = 0;
async function loadTasks(): Promise<void> {
  if (!projectRow.value) return;
  const ticket = ++tasksTicket;
  const filter = batchFilter.value;
  try {
    const response = await props.client.tasks(props.projectId, filter === 'all' ? {} : { batch_id: filter });
    if (ticket !== tasksTicket) return;
    if (response.success) tasks.value = response.data.tasks.map(toTaskCard);
    else if (response.code !== 'UNAUTHORIZED') notice.value = say(response);
  } catch (cause) {
    console.error(cause);
    if (ticket === tasksTicket) notice.value = 'Task belum bisa dimuat. Coba muat ulang halaman.';
  }
}

let detailTicket = 0;
async function loadDetail(): Promise<void> {
  const id = props.taskId;
  const ticket = ++detailTicket;
  if (!id) {
    detail.value = null;
    return;
  }
  try {
    const response = await props.client.task(id);
    if (ticket !== detailTicket || id !== props.taskId) return;
    if (response.success) {
      detail.value = toTaskDetail(response.data.task);
      return;
    }
    if (response.code === 'UNAUTHORIZED') return;
    detail.value = null;
    notice.value = say(response);
    closeTask();
  } catch (cause) {
    console.error(cause);
  }
}

async function reload(): Promise<void> {
  await loadProject();
  await Promise.all([loadTasks(), loadDetail()]);
}

let stopLive: (() => void) | undefined;
onMounted(() => {
  const stopProject = onServerEvent(PROJECTS_CHANGED_EVENT, () => void loadProject());
  const stopBoard = onServerEvent(PROJECTS_BOARD_CHANGED_EVENT, () => void reload());
  stopLive = () => {
    stopProject();
    stopBoard();
  };
  void reload();
});
onBeforeUnmount(() => stopLive?.());
watch(
  () => props.projectId,
  () => {
    loading.value = true;
    notice.value = '';
    projectRow.value = null;
    tasks.value = [];
    void reload();
  },
);
watch(batchFilter, () => void loadTasks());
watch(
  () => props.taskId,
  () => void loadDetail(),
);

function openTask(id: string): void {
  void router.push({ name: 'project-task', params: { projectId: props.projectId, taskId: id }, query: route.query });
}
function closeTask(): void {
  void router.push({ name: 'project-board', params: { projectId: props.projectId }, query: route.query });
}

/* Task baru */
const newTaskOpen = ref(false);
const newTaskErrors = ref<Partial<Record<'title' | 'description' | 'assigneeId', string>>>({});
const newTaskError = ref<string | undefined>();
/** The board shows every task of the active batch, so the start version can be read off it. */
const showsActiveBatch = computed(() => batchFilter.value === 'all' || batchFilter.value === activeBatch.value?.id);
const startVersion = computed(() =>
  showsActiveBatch.value ? nextTaskVersion(activeBatch.value, activeBatch.value?.id ?? null, tasks.value) : null,
);
function openNewTask(): void {
  newTaskErrors.value = {};
  newTaskError.value = undefined;
  newTaskOpen.value = true;
}
async function createTask(input: NewTaskInput): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  newTaskErrors.value = {};
  newTaskError.value = undefined;
  try {
    const response = await props.client.createTask(props.projectId, {
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      assignee_id: input.assigneeId || null,
    });
    if (response.success) {
      newTaskOpen.value = false;
    } else if (response.code === 'VALIDATION_ERROR') {
      newTaskErrors.value = {
        title: response.errors?.title?.[0],
        description: response.errors?.description?.[0],
        assigneeId: response.errors?.assignee_id?.[0],
      };
      if (!Object.values(newTaskErrors.value).some(Boolean)) newTaskError.value = response.message;
    } else {
      newTaskError.value = say(response);
    }
  } catch (cause) {
    console.error(cause);
    newTaskError.value = 'Task belum bisa dibuat. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await reload();
}

/* Pindah task: from the detail, or by dropping a card on another column */
const moving = ref<TaskCardData | null>(null);
const moveTarget = ref<TaskStatus | null>(null);
const moveNoteError = ref<string | undefined>();
const moveError = ref<string | undefined>();
const moveVersion = computed(() => {
  const task = moving.value;
  if (!task || !tasks.value.some((shown) => shown.id === task.id)) return null;
  const batch = batches.value.find((candidate) => candidate.id === task.batchId) ?? null;
  return nextTaskVersion(batch, task.batchId ?? null, tasks.value);
});
function startMove(task: TaskCardData | null, target: TaskStatus | null): void {
  if (!task) return;
  moveNoteError.value = undefined;
  moveError.value = undefined;
  moving.value = task;
  moveTarget.value = target;
}
function dropTask(id: string, status: TaskStatus): void {
  startMove(tasks.value.find((task) => task.id === id) ?? null, status);
}
async function moveTask(input: MoveTaskInput): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  moveNoteError.value = undefined;
  moveError.value = undefined;
  try {
    const response = await props.client.moveTask(input.taskId, { column_id: input.to, note: input.note });
    if (response.success) {
      moving.value = null;
    } else if (response.code === 'VALIDATION_ERROR' && response.errors?.note) {
      moveNoteError.value = response.errors.note[0];
    } else if (response.code === 'TASK_ALREADY_IN_COLUMN') {
      moveError.value = `Task ini sudah ada di ${STATUS_LABEL[input.to]}.`;
    } else {
      moveError.value = say(response);
    }
  } catch (cause) {
    console.error(cause);
    moveError.value = 'Task belum bisa dipindah. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await reload();
}

/* Bump versi: opens the next batch and makes it the active one */
async function bump(kind: BumpKind): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    const response = await props.client.createBatch(props.projectId, { bump_major: kind === 'major', activate: true });
    if (response.success) {
      const query = { ...route.query };
      delete query.batch;
      await router.replace({ query });
    } else {
      notice.value = say(response);
    }
  } catch (cause) {
    console.error(cause);
    notice.value = 'Versi belum bisa dinaikkan. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await reload();
}

/* Edit task, merging a save made elsewhere instead of overwriting it */
const FIELD_LABELS: Record<EditTaskField, string> = { title: 'Judul', description: 'Deskripsi', priority: 'Prioritas', assigneeId: 'Assignee' };
const editOpen = ref(false);
const editTaskId = ref('');
const form = ref<EditTaskForm>({ title: '', description: '', priority: 'medium', assigneeId: '' });
const base = ref<EditTaskForm>({ ...form.value });
const theirs = ref<EditTaskForm | null>(null);
const revision = ref(0);
const conflicts = ref<EditTaskField[]>([]);
const mergeNotice = ref('');
const editErrors = ref<Partial<Record<EditTaskField, string>>>({});
const editError = ref<string | undefined>();

function fromTask(task: TaskCardData): EditTaskForm {
  return { title: task.title, description: task.description ?? '', priority: task.priority, assigneeId: task.assignee ? String(task.assignee.id) : '' };
}
function openEdit(): void {
  const task = detail.value;
  if (!task) return;
  editTaskId.value = task.id;
  form.value = fromTask(task);
  base.value = { ...form.value };
  revision.value = task.revision ?? 0;
  theirs.value = null;
  conflicts.value = [];
  mergeNotice.value = '';
  editErrors.value = {};
  editError.value = undefined;
  editOpen.value = true;
}
function mergeStale(current: Task): void {
  const now = fromTask(toTaskCard(current));
  const result = mergeEdit(base.value, form.value, now);
  form.value = result.merged;
  base.value = now;
  theirs.value = now;
  revision.value = current.revision;
  conflicts.value = result.conflicts;
  mergeNotice.value = result.adopted.length
    ? `Task ini disimpan orang lain saat kamu mengedit. ${result.adopted.map((field) => FIELD_LABELS[field]).join(' dan ')} sudah ikut versi terbaru; cek lalu simpan lagi.`
    : 'Task ini disimpan orang lain saat kamu mengedit. Cek isiannya lalu simpan lagi.';
}
function useTheirs(field: EditTaskField): void {
  if (theirs.value) form.value = { ...form.value, [field]: theirs.value[field] };
  conflicts.value = conflicts.value.filter((name) => name !== field);
}
function keepMine(field: EditTaskField): void {
  conflicts.value = conflicts.value.filter((name) => name !== field);
}
async function saveEdit(): Promise<void> {
  if (busy.value || conflicts.value.length) return;
  editErrors.value = form.value.title.trim() ? {} : { title: 'Judul wajib diisi' };
  if (editErrors.value.title) return;
  busy.value = true;
  editError.value = undefined;
  try {
    const response = await props.client.updateTask(editTaskId.value, {
      revision: revision.value,
      title: form.value.title.trim(),
      description: form.value.description.trim() || null,
      priority: form.value.priority,
      assignee_id: form.value.assigneeId || null,
    });
    if (response.success) {
      editOpen.value = false;
    } else if (response.code === 'STALE_REVISION' && 'current' in response) {
      mergeStale(response.current);
    } else if (response.code === 'VALIDATION_ERROR') {
      editErrors.value = {
        title: response.errors?.title?.[0],
        description: response.errors?.description?.[0],
        assigneeId: response.errors?.assignee_id?.[0],
      };
      if (!Object.values(editErrors.value).some(Boolean)) editError.value = response.message;
    } else {
      editError.value = say(response);
    }
  } catch (cause) {
    console.error(cause);
    editError.value = 'Perubahan belum tersimpan. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await reload();
}

/* Hapus task (owner) */
async function deleteTask(): Promise<void> {
  const task = detail.value;
  if (!task || busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    const response = await props.client.removeTask(task.id);
    if (response.success) closeTask();
    else notice.value = say(response);
  } catch (cause) {
    console.error(cause);
    notice.value = 'Task belum bisa dihapus. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await reload();
}
</script>

<template>
  <div v-if="gone" class="board-gone" data-testid="project-gone">
    <h1 class="h2">Project tidak bisa dibuka</h1>
    <p>{{ gone }}</p>
    <RouterLink to="/dashboard" class="link">Kembali ke Dashboard</RouterLink>
  </div>
  <p v-else-if="loading && !project" class="board-loading">Memuat board…</p>
  <BoardView
    v-else
    data-testid="board-page"
    :project-id="projectId"
    :project="project"
    :batches="batches"
    :tasks="tasks"
    :members="members"
    :batch-filter="batchFilter"
    :can-bump="isOwner"
    :can-create="project !== null"
    :busy="busy"
    @update:batch-filter="setBatchFilter"
    @new-task="openNewTask"
    @open-task="openTask"
    @drop-task="dropTask"
    @bump="bump"
  >
    <template #notice>
      <p v-if="notice" role="alert" class="board-notice" data-testid="board-notice">{{ notice }}</p>
    </template>
  </BoardView>

  <NewTaskModal
    :open="newTaskOpen"
    :batch="activeBatch"
    :start-version="startVersion"
    :members="members"
    :busy="busy"
    :errors="newTaskErrors"
    :error="newTaskError"
    @close="newTaskOpen = false"
    @submit="createTask"
  />
  <MoveTaskModal
    :open="moving !== null"
    :task="moving"
    :initial-target="moveTarget"
    :next-version="moveVersion"
    :busy="busy"
    :note-error="moveNoteError"
    :error="moveError"
    @close="moving = null"
    @submit="moveTask"
  />
  <TaskDetailModal
    :open="taskId !== null && detail !== null && moving === null && !editOpen"
    :task="detail"
    :can-edit="true"
    :can-delete="isOwner"
    :deleting="busy"
    @close="closeTask"
    @move="startMove(detail, null)"
    @edit="openEdit"
    @delete="deleteTask"
  />
  <EditTaskModal
    v-model:title="form.title"
    v-model:description="form.description"
    v-model:priority="form.priority"
    v-model:assignee-id="form.assigneeId"
    :open="editOpen"
    :members="members"
    :busy="busy"
    :errors="editErrors"
    :error="editError"
    :merge-notice="mergeNotice"
    :conflicts="conflicts"
    :theirs="theirs"
    @close="editOpen = false"
    @submit="saveEdit"
    @use-theirs="useTheirs"
    @keep-mine="keepMine"
  />
</template>

<style scoped>
.board-gone,
.board-loading {
  padding: 32px 28px;
  color: var(--mute);
}
.board-gone p {
  margin: 8px 0 14px;
}
.board-notice {
  margin: 12px 28px 0;
  padding: 10px 12px;
  border: 1px solid var(--alert);
  border-radius: var(--r-small);
  font-size: 13px;
  color: var(--alert);
  background: var(--card);
}
@media (max-width: 760px) {
  .board-notice {
    margin: 12px 16px 0;
  }
}
</style>
