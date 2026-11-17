<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { onServerEvent } from '../../../../shared/realtime/browser';
import { PROJECTS_BOARD_CHANGED_EVENT, PROJECTS_CHANGED_EVENT } from '../../contract';
import type { ProjectsClient } from '../client';
import DashboardView from '../components/DashboardView.vue';
import NewProjectModal from '../components/NewProjectModal.vue';
import { toDashboard, type DashboardData, type NewProjectInput } from '../view';

/**
 * The dashboard on the Projects API: stats, board health and the latest
 * activity across the account's projects, refreshed on `projects.changed` and
 * `projects.board-changed`. "Project baru" creates the project in the
 * workspace in view; "Workspace baru" is the shell's.
 */
const props = withDefaults(
  defineProps<{
    client: ProjectsClient;
    userName?: string;
    /** The workspace a new project goes to; `null` makes a project outside any workspace. */
    currentWorkspace?: () => { id: string; name: string } | null;
  }>(),
  { userName: '', currentWorkspace: () => null },
);
const emit = defineEmits<{ newWorkspace: [] }>();
const router = useRouter();

const data = ref<DashboardData | null>(null);
const notice = ref('');
const now = ref(new Date());
let latest = 0;

async function load(): Promise<void> {
  const ticket = ++latest;
  try {
    const response = await props.client.dashboard();
    if (ticket !== latest) return;
    now.value = new Date();
    if (response.success) {
      data.value = toDashboard(response.data);
      notice.value = '';
    } else if (response.code !== 'UNAUTHORIZED') {
      notice.value = response.message;
    }
  } catch (cause) {
    console.error(cause);
    if (ticket === latest) notice.value = 'Dashboard belum bisa dimuat. Coba muat ulang halaman.';
  }
}

let stopLive: (() => void) | undefined;
onMounted(() => {
  const stopProjects = onServerEvent(PROJECTS_CHANGED_EVENT, () => void load());
  const stopBoard = onServerEvent(PROJECTS_BOARD_CHANGED_EVENT, () => void load());
  stopLive = () => {
    stopProjects();
    stopBoard();
  };
  void load();
});
onBeforeUnmount(() => stopLive?.());

const newProjectOpen = ref(false);
const newProjectBusy = ref(false);
const newProjectError = ref<string | undefined>();
const workspace = ref<{ id: string; name: string } | null>(null);

function openNewProject(): void {
  workspace.value = props.currentWorkspace();
  newProjectError.value = undefined;
  newProjectOpen.value = true;
}

async function createProject(input: NewProjectInput): Promise<void> {
  if (newProjectBusy.value) return;
  newProjectBusy.value = true;
  newProjectError.value = undefined;
  try {
    const response = await props.client.create({
      name: input.name,
      description: input.description || null,
      workspace_id: workspace.value?.id ?? null,
    });
    if (!response.success) {
      newProjectError.value = response.errors?.name?.[0] ?? response.message;
      return;
    }
    newProjectOpen.value = false;
    await router.push({ name: 'project-board', params: { projectId: response.data.project.id } });
  } catch (cause) {
    console.error(cause);
    newProjectError.value = 'Project belum bisa dibuat. Coba lagi.';
  } finally {
    newProjectBusy.value = false;
  }
}
</script>

<template>
  <DashboardView
    data-testid="dashboard-page"
    :user-name="userName"
    :now="now"
    :workspace-count="data?.workspaceCount ?? 0"
    :stats="data?.stats ?? null"
    :health="data?.health ?? []"
    :activity="data?.activity ?? []"
    :busy="newProjectBusy"
    @new-workspace="emit('newWorkspace')"
    @new-project="openNewProject"
  >
    <template #notice>
      <p v-if="notice" role="alert" class="dash-notice">{{ notice }}</p>
    </template>
  </DashboardView>
  <NewProjectModal
    :open="newProjectOpen"
    :workspace-name="workspace?.name"
    :busy="newProjectBusy"
    :name-error="newProjectError"
    @close="newProjectOpen = false"
    @submit="createProject"
  />
</template>

<style scoped>
.dash-notice {
  margin: 0 28px 14px;
  padding: 10px 12px;
  border: 1px solid var(--alert);
  border-radius: var(--r-small);
  font-size: 13px;
  color: var(--alert);
  background: var(--card);
}
@media (max-width: 760px) {
  .dash-notice {
    margin: 0 16px 14px;
  }
}
</style>
