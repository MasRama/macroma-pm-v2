<script setup lang="ts">
import { computed } from 'vue';
import { formatDayLabel, PageHead, ShellTopBar, TopCrumb } from '../../../../shared/ui';
import ActivityItem from '../components/ActivityItem.vue';
import ProjectTopBar from '../components/ProjectTopBar.vue';
import type { ActivityEntry, ProjectSummary } from '../view';

/** Activity feed grouped by day. With a project it is that project's Aktivitas tab, without one the sidebar feed. */
const props = withDefaults(
  defineProps<{
    projectId?: string | number | null;
    project?: ProjectSummary | null;
    entries?: ActivityEntry[];
    now?: Date;
  }>(),
  { projectId: null, project: null, entries: () => [], now: () => new Date() },
);

const groups = computed(() => {
  const days: { label: string; entries: ActivityEntry[] }[] = [];
  for (const entry of props.entries) {
    const label = formatDayLabel(entry.at, props.now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }
  return days;
});
</script>

<template>
  <div class="feed">
    <ProjectTopBar
      v-if="projectId !== null"
      :project-id="projectId"
      :project-name="project?.name ?? 'Project'"
      :workspace-name="project?.workspaceName"
      active="activity"
    />
    <ShellTopBar v-else><TopCrumb current="Aktivitas" /></ShellTopBar>
    <PageHead
      title="Aktivitas"
      :description="projectId !== null ? 'Semua perpindahan, komentar, dan bump di project ini.' : 'Yang terjadi di semua project kamu.'"
    />
    <div class="feed__body">
      <section v-for="group in groups" :key="group.label" class="panel feed__day">
        <h2 class="cap feed__label">{{ group.label }}</h2>
        <ul class="feed__list">
          <ActivityItem v-for="entry in group.entries" :key="entry.id" :entry="entry" :now="now" />
        </ul>
      </section>
      <p v-if="groups.length === 0" class="feed__empty">Belum ada aktivitas.</p>
    </div>
  </div>
</template>

<style scoped>
.feed {
  padding-bottom: 28px;
}
.feed__body {
  max-width: 760px;
  padding: 0 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.feed__day {
  padding: 16px 20px 6px;
}
.feed__label {
  margin: 0 0 2px;
}
.feed__list {
  margin: 0;
  padding: 0;
}
.feed__empty {
  margin: 0;
  font-size: 13px;
  color: var(--mute);
}
@media (max-width: 760px) {
  .feed__body {
    padding: 0 16px;
  }
}
</style>
