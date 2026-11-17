<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { formatLongDate, PageHead, ShellTopBar, TopCrumb, UiButton } from '../../../../shared/ui';
import ActivityItem from '../components/ActivityItem.vue';
import StatusBar from '../components/StatusBar.vue';
import StatusLegend from '../components/StatusLegend.vue';
import { formatVersion, greeting, projectColor } from '../format';
import type { ActivityEntry, BoardHealthRow, DashboardStats } from '../view';

/** Home: greeting, four stat blocks, board health per project, latest activity. */
const props = withDefaults(
  defineProps<{
    userName?: string;
    now?: Date;
    workspaceCount?: number;
    stats?: DashboardStats | null;
    health?: BoardHealthRow[];
    activity?: ActivityEntry[];
    canCreateProject?: boolean;
  }>(),
  {
    userName: '',
    now: () => new Date(),
    workspaceCount: 0,
    stats: null,
    health: () => [],
    activity: () => [],
    canCreateProject: true,
  },
);
const emit = defineEmits<{ newWorkspace: []; newProject: [] }>();

const title = computed(() => (props.userName ? `${greeting(props.now)}, ${props.userName}` : greeting(props.now)));
const summary = computed(
  () => `${formatLongDate(props.now)} · ${props.workspaceCount} workspace, ${props.stats?.activeProjects ?? 0} project jalan.`,
);

const doneDelta = computed(() => {
  const stats = props.stats;
  if (!stats || stats.doneLastWeek === null || stats.doneLastWeek === undefined) return 'minggu ini';
  const delta = stats.doneThisWeek - stats.doneLastWeek;
  if (delta > 0) return `naik ${delta} dari minggu lalu`;
  if (delta < 0) return `turun ${-delta} dari minggu lalu`;
  return 'sama dengan minggu lalu';
});

const blocks = computed(() => {
  const stats = props.stats;
  return [
    { key: 'active', label: 'Task aktif', value: stats?.activeTasks ?? 0, note: `di ${stats?.activeProjects ?? 0} project`, tone: 'ink' },
    {
      key: 'ongoing',
      label: 'Lagi dikerjain',
      value: stats?.ongoing ?? 0,
      note: stats?.ongoingMine != null ? `${stats.ongoingMine} punya kamu` : 'di semua project',
      tone: 'ongoing',
    },
    {
      key: 'revisi',
      label: 'Revisi',
      value: stats?.revisi ?? 0,
      note: stats?.revisiRepeated != null ? `${stats.revisiRepeated} balik lebih dari sekali` : 'perlu dicek ulang',
      tone: 'revisi',
    },
    { key: 'done', label: 'Selesai minggu ini', value: stats?.doneThisWeek ?? 0, note: doneDelta.value, tone: 'card' },
  ];
});

function done(row: BoardHealthRow): number {
  return row.counts.done;
}
function total(row: BoardHealthRow): number {
  const c = row.counts;
  return c.backlog + c.ongoing + c.revisi + c.review + c.done;
}
</script>

<template>
  <div class="dash">
    <ShellTopBar><TopCrumb current="Dashboard" /></ShellTopBar>
    <PageHead :title="title" :description="summary">
      <template #actions>
        <UiButton @click="emit('newWorkspace')">Workspace baru</UiButton>
        <UiButton v-if="canCreateProject" variant="primary" icon="plus" @click="emit('newProject')">Project baru</UiButton>
      </template>
    </PageHead>

    <div class="dash__stats">
      <div v-for="block in blocks" :key="block.key" class="stat" :class="`stat--${block.tone}`">
        <div class="stat__label">{{ block.label }}</div>
        <div class="stat__value">{{ block.value }}</div>
        <div class="stat__note">{{ block.note }}</div>
      </div>
    </div>

    <div class="dash__grid">
      <section class="panel health" aria-labelledby="health-title">
        <div class="health__head">
          <h2 id="health-title" class="h2">Board health</h2>
          <span class="health__hint">batch aktif tiap project</span>
        </div>
        <ul v-if="health.length" class="health__rows">
          <li v-for="row in health" :key="row.project.id" class="health__row">
            <span class="health__sq" :style="{ background: projectColor(row.project.id) }" />
            <RouterLink class="health__name" :to="{ name: 'project-board', params: { projectId: row.project.id } }">
              {{ row.project.name }}
            </RouterLink>
            <span class="health__ver mono">{{ formatVersion(row.batch) }}</span>
            <StatusBar class="health__bar" :counts="row.counts" />
            <span class="health__count"><b>{{ done(row) }}</b><span>/{{ total(row) }}</span></span>
          </li>
        </ul>
        <p v-else class="dash__empty">Belum ada project yang jalan.</p>
        <StatusLegend class="health__legend" />
      </section>

      <section class="panel feed" aria-labelledby="feed-title">
        <div class="health__head">
          <h2 id="feed-title" class="h2">Aktivitas</h2>
          <RouterLink class="link feed__all" :to="{ name: 'feed' }">Lihat semua</RouterLink>
        </div>
        <ul v-if="activity.length" class="feed__list">
          <ActivityItem v-for="entry in activity" :key="entry.id" :entry="entry" :now="now" />
        </ul>
        <p v-else class="dash__empty">Belum ada aktivitas.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dash {
  padding-bottom: 28px;
}
.dash__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  padding: 0 28px;
}
.stat {
  border-radius: var(--r-panel);
  padding: 16px 18px;
  color: #fff;
}
.stat--ink {
  background: var(--block);
  border: 1px solid var(--block-line);
  color: var(--block-fg);
}
.stat--ongoing {
  background: var(--c-ongoing);
}
.stat--revisi {
  background: var(--c-revisi);
}
.stat--card {
  background: var(--card);
  border: 1px solid var(--line);
  color: var(--ink);
}
.stat__label {
  font-size: 12.5px;
  font-weight: 600;
  opacity: 0.8;
}
.stat__value {
  margin-top: 8px;
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.1;
}
.stat__note {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
}
.stat--ink .stat__note {
  color: var(--block-meta);
}
.stat--card .stat__note {
  color: var(--mute);
}
.dash__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 14px;
  padding: 14px 28px 0;
  align-items: start;
}
.health {
  padding: 18px 22px;
}
.health__head {
  display: flex;
  align-items: center;
}
.health__hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--mute);
}
.health__rows {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.health__row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 0;
  border-bottom: 1px solid var(--line-soft);
}
.health__sq {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex-shrink: 0;
}
.health__name {
  width: 120px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
}
.health__name:hover {
  text-decoration: underline;
}
.health__ver {
  width: 38px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--mute);
}
.health__bar {
  flex: 1;
}
.health__count {
  width: 58px;
  text-align: right;
  font-size: 12.5px;
}
.health__count span {
  color: var(--mute);
}
.health__legend {
  margin-top: 14px;
}
.feed {
  padding: 18px 20px;
  overflow: hidden;
}
.feed__all {
  margin-left: auto;
  font-size: 12.5px;
}
.feed__list {
  margin: 0;
  padding: 0;
}
.dash__empty {
  margin: 16px 0 4px;
  font-size: 13px;
  color: var(--mute);
}
@media (max-width: 1100px) {
  .dash__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .dash__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: 0 16px;
  }
  .stat__value {
    font-size: 32px;
  }
  .dash__grid {
    padding: 12px 16px 0;
  }
  /* Phones: the status bar gets its own full-width line under name, version and count. */
  .health__row {
    flex-wrap: wrap;
    row-gap: 9px;
  }
  .health__name {
    flex: 1;
    width: auto;
  }
  .health__bar {
    order: 1;
    flex-basis: 100%;
  }
  .health__hint {
    display: none;
  }
}
</style>
