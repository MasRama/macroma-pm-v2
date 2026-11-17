<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { ShellTopBar, TopCrumb } from '../../../../shared/ui';

/** Workspace / project breadcrumb plus the project tabs (Board, Rilis, Aktivitas) in the shell top bar. */
defineProps<{ projectId: string | number; projectName: string; workspaceName?: string; active: 'board' | 'releases' | 'activity' }>();

const TABS = [
  { key: 'board', label: 'Board', route: 'project-board' },
  { key: 'releases', label: 'Rilis', route: 'project-releases' },
  { key: 'activity', label: 'Aktivitas', route: 'project-activity' },
] as const;
</script>

<template>
  <ShellTopBar>
    <TopCrumb :trail="workspaceName ? [workspaceName] : []" :current="projectName" />
    <nav class="ptabs" aria-label="Project">
      <RouterLink
        v-for="tab in TABS"
        :key="tab.key"
        :to="{ name: tab.route, params: { projectId } }"
        class="ptabs__tab"
        :class="{ 'ptabs__tab--on': tab.key === active }"
        :aria-current="tab.key === active ? 'page' : undefined"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>
  </ShellTopBar>
</template>

<style scoped>
.ptabs {
  display: flex;
  gap: 2px;
  margin-left: 22px;
}
.ptabs__tab {
  padding: 6px 11px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--mute);
  text-decoration: none;
}
.ptabs__tab--on {
  background: var(--primary-bg);
  color: var(--primary-fg);
}
</style>
