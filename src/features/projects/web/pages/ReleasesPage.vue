<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onServerEvent } from '../../../../shared/realtime/browser';
import { PROJECTS_BOARD_CHANGED_EVENT, PROJECTS_CHANGED_EVENT } from '../../contract';
import type { ProjectsClient } from '../client';
import ReleasesView from '../components/ReleasesView.vue';
import { refusalText } from '../refusals';
import {
  latestBatchVersion,
  toActiveRelease,
  toBatchSummary,
  toProjectSummary,
  toRelease,
  toReleaseDetail,
  type BatchSummary,
  type BumpKind,
  type ProjectSummary,
  type ReleaseDetail,
  type ReleaseSummary,
} from '../view';

/**
 * Rilis on the Projects API: the project (name, role, batches for Bump versi),
 * its releases view and the selected release's detail. The selection lives in
 * `?release=<batchId>` so it can be linked; without one, the latest closed
 * release is shown. Follows `projects.changed` and `projects.board-changed`.
 */
const props = withDefaults(
  defineProps<{
    projectId: string;
    client: ProjectsClient;
    /** Names the project's workspace in the breadcrumb. */
    workspaceNameOf?: (id: string) => string | undefined;
  }>(),
  { workspaceNameOf: () => undefined },
);
const route = useRoute();
const router = useRouter();

const projectRow = ref<ProjectSummary | null>(null);
const batches = ref<BatchSummary[]>([]);
const active = ref<BatchSummary | null>(null);
const releases = ref<ReleaseSummary[]>([]);
const detail = ref<ReleaseDetail | null>(null);
const detailError = ref('');
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
const latest = computed(() => latestBatchVersion(batches.value));

/** The release on the right: the one `?release=` names, else the latest closed one. */
const selectedId = computed<string | null>(() => {
  const asked = route.query.release;
  if (typeof asked === 'string' && asked) return asked;
  return releases.value[0]?.id ?? null;
});
function select(id: string): void {
  void router.replace({ query: { ...route.query, release: id } });
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
          : refusalText(response.code);
      return;
    }
    gone.value = '';
    projectRow.value = toProjectSummary(response.data.project);
    batches.value = response.data.batches.map(toBatchSummary);
  } catch (cause) {
    console.error(cause);
    if (ticket === projectTicket) notice.value = 'Project belum bisa dimuat. Coba muat ulang halaman.';
  }
}

let releasesTicket = 0;
async function loadReleases(): Promise<void> {
  const ticket = ++releasesTicket;
  try {
    const response = await props.client.releases(props.projectId);
    if (ticket !== releasesTicket) return;
    if (!response.success) {
      if (response.code !== 'UNAUTHORIZED' && !gone.value) notice.value = refusalText(response.code);
      return;
    }
    active.value = response.data.active ? toActiveRelease(response.data.active) : null;
    releases.value = response.data.closed.map(toRelease);
  } catch (cause) {
    console.error(cause);
    if (ticket === releasesTicket) notice.value = 'Rilis belum bisa dimuat. Coba muat ulang halaman.';
  }
}

let detailTicket = 0;
async function loadDetail(): Promise<void> {
  const id = selectedId.value;
  const ticket = ++detailTicket;
  if (!id || gone.value) {
    detail.value = null;
    detailError.value = '';
    return;
  }
  try {
    const response = await props.client.release(props.projectId, id);
    if (ticket !== detailTicket) return;
    if (response.success) {
      detail.value = toReleaseDetail(response.data);
      detailError.value = '';
    } else if (response.code !== 'UNAUTHORIZED') {
      detail.value = null;
      detailError.value = response.code === 'BATCH_NOT_FOUND' ? 'Rilis ini sudah tidak ada. Pilih rilis lain di kiri.' : refusalText(response.code);
    }
  } catch (cause) {
    console.error(cause);
    if (ticket === detailTicket) detailError.value = 'Changelog belum bisa dimuat. Coba lagi.';
  }
}

async function reload(): Promise<void> {
  await loadProject();
  if (gone.value) {
    loading.value = false;
    return;
  }
  await loadReleases();
  loading.value = false;
  await loadDetail();
}

let stopLive: (() => void) | undefined;
onMounted(() => {
  const stopProject = onServerEvent(PROJECTS_CHANGED_EVENT, () => void reload());
  const stopBoard = onServerEvent(PROJECTS_BOARD_CHANGED_EVENT, async () => {
    await loadReleases();
    await loadDetail();
  });
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
    active.value = null;
    releases.value = [];
    detail.value = null;
    void reload();
  },
);
watch(selectedId, (id, before) => {
  if (id !== before) void loadDetail();
});

/* Bump versi: opens the next batch and makes it the active one, which closes the batch that was active */
async function bump(kind: BumpKind): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    const response = await props.client.createBatch(props.projectId, { bump_major: kind === 'major', activate: true });
    if (response.success) {
      // Show the release this bump just closed.
      const query = { ...route.query };
      delete query.release;
      await router.replace({ query });
    } else {
      notice.value = refusalText(response.code);
    }
  } catch (cause) {
    console.error(cause);
    notice.value = 'Versi belum bisa dinaikkan. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await reload();
}
</script>

<template>
  <div v-if="gone" class="rel-gone" data-testid="releases-gone">
    <p>{{ gone }}</p>
    <RouterLink to="/dashboard" class="link">Kembali ke Dashboard</RouterLink>
  </div>
  <p v-else-if="loading && !project" class="rel-loading">Memuat rilis…</p>
  <ReleasesView
    v-else
    data-testid="releases-page"
    :project-id="projectId"
    :project="project"
    :active-batch="active"
    :latest="latest"
    :releases="releases"
    :selected-id="selectedId"
    :detail="detail"
    :detail-error="detailError"
    :can-bump="isOwner"
    :busy="busy"
    @update:selected-id="select"
    @bump="bump"
  >
    <template #notice>
      <p v-if="notice" role="alert" class="rel-notice" data-testid="releases-notice">{{ notice }}</p>
    </template>
  </ReleasesView>
</template>

<style scoped>
.rel-gone,
.rel-loading {
  padding: 32px 28px;
  color: var(--mute);
}
.rel-gone p {
  margin: 8px 0 14px;
}
.rel-notice {
  margin: 0 28px 14px;
  padding: 10px 12px;
  border: 1px solid var(--alert);
  border-radius: var(--r-small);
  font-size: 13px;
  color: var(--alert);
  background: var(--card);
}
@media (max-width: 760px) {
  .rel-notice {
    margin: 0 16px 14px;
  }
}
</style>
