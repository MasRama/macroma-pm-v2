<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { AvatarStack } from '../../../../shared/ui';
import { projectColor, VersionText } from '../../../projects/web';
import type { WorkspaceProjectCard } from '../view';

const props = defineProps<{ project: WorkspaceProjectCard }>();
const percent = computed(() => (props.project.total === 0 ? 0 : Math.round((props.project.done / props.project.total) * 100)));
</script>

<template>
  <RouterLink class="pcard panel focus-ring" :to="{ name: 'project-board', params: { projectId: project.id } }">
    <div class="pcard__head" :style="{ background: projectColor(project.id) }">
      <b>{{ project.name }}</b>
      <VersionText v-if="project.batch" class="pcard__ver" :version="project.batch" />
    </div>
    <div class="pcard__body">
      <p class="pcard__desc">{{ project.description || 'Belum ada deskripsi.' }}</p>
      <div
        class="pcard__track"
        role="progressbar"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`${project.done} dari ${project.total} task selesai`"
      >
        <div class="pcard__fill" :style="{ width: `${percent}%` }" />
      </div>
      <div class="pcard__foot">
        <span class="pcard__count"><b>{{ project.done }}</b><span>/{{ project.total }} selesai</span></span>
        <AvatarStack class="pcard__people" :people="project.members" :size="24" :overlap="6" ring="var(--card)" />
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.pcard {
  display: block;
  overflow: hidden;
  color: var(--ink);
  text-decoration: none;
}
.pcard__head {
  display: flex;
  align-items: flex-start;
  padding: 14px 16px;
  color: #fff;
}
.pcard__head b {
  font-size: 16px;
  letter-spacing: -0.01em;
}
.pcard__ver {
  margin-left: auto;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}
.pcard__body {
  padding: 13px 16px;
}
.pcard__desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--mute);
}
.pcard__track {
  height: 6px;
  margin-top: 12px;
  border-radius: var(--r-bar);
  background: var(--track);
}
.pcard__fill {
  height: 6px;
  border-radius: var(--r-bar);
  background: var(--ink);
}
.pcard__foot {
  display: flex;
  align-items: center;
  margin-top: 11px;
}
.pcard__count {
  font-size: 12.5px;
}
.pcard__count span {
  color: var(--mute);
}
.pcard__people {
  margin-left: auto;
}
</style>
