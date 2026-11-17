<script setup lang="ts">
import { computed } from 'vue';
import { PageHead, ShellTopBar, TopCrumb, UiButton } from '../../../../shared/ui';
import MembersPanel from './MembersPanel.vue';
import ProjectCard from './ProjectCard.vue';
import type { PendingInvite, WorkspaceMember, WorkspaceProjectCard, WorkspaceSummary } from '../view';

/** A workspace: its project cards on the left, members and pending invitations on the right. Presentational. */
const props = withDefaults(
  defineProps<{
    workspace?: WorkspaceSummary | null;
    projects?: WorkspaceProjectCard[];
    members?: WorkspaceMember[];
    invites?: PendingInvite[];
    meId?: string | number | null;
    /** Owner: edit, delete, cancel invitations, remove members. */
    canManage?: boolean;
    /** Any member may invite. */
    canInvite?: boolean;
    canCreateProject?: boolean;
    busy?: boolean;
    now?: Date;
  }>(),
  {
    workspace: null,
    projects: () => [],
    members: () => [],
    invites: () => [],
    meId: null,
    canManage: false,
    canInvite: false,
    canCreateProject: false,
    busy: false,
    now: () => new Date(),
  },
);
const emit = defineEmits<{
  newProject: [];
  invite: [];
  cancelInvite: [id: string];
  removeMember: [userId: string];
  edit: [];
  delete: [];
}>();

const name = computed(() => props.workspace?.name ?? 'Workspace');
const projectCount = computed(() => props.workspace?.projectCount ?? props.projects.length);
const memberCount = computed(() => props.workspace?.memberCount ?? props.members.length);
const summary = computed(() =>
  [props.workspace?.description, `${memberCount.value} anggota`, `${projectCount.value} project`].filter(Boolean).join(' · '),
);
</script>

<template>
  <div class="ws">
    <ShellTopBar><TopCrumb :trail="['Workspace']" :current="name" /></ShellTopBar>
    <PageHead :title="name" :description="summary">
      <template v-if="canManage" #actions>
        <UiButton size="sm" data-testid="edit-workspace" :disabled="busy" @click="emit('edit')">Edit</UiButton>
        <UiButton variant="ghost" size="sm" icon="trash" data-testid="delete-workspace" :disabled="busy" @click="emit('delete')">Hapus</UiButton>
      </template>
    </PageHead>
    <slot name="notice" />
    <div class="ws__grid">
      <section aria-labelledby="ws-projects">
        <div class="ws__bar">
          <h2 id="ws-projects" class="h2">Project</h2>
          <UiButton
            v-if="canCreateProject"
            class="ws__new"
            variant="primary"
            size="sm"
            icon="plus"
            data-testid="workspace-new-project"
            :disabled="busy"
            @click="emit('newProject')"
          >
            Project baru
          </UiButton>
        </div>
        <div v-if="projects.length" class="ws__cards">
          <ProjectCard v-for="project in projects" :key="project.id" :project="project" />
        </div>
        <p v-else-if="projectCount === 0" class="ws__empty">Belum ada project di workspace ini.</p>
      </section>
      <MembersPanel
        :members="members"
        :invites="invites"
        :me-id="meId"
        :can-manage="canManage"
        :can-invite="canInvite"
        :busy="busy"
        :now="now"
        @invite="emit('invite')"
        @cancel-invite="emit('cancelInvite', $event)"
        @remove-member="emit('removeMember', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.ws {
  padding-bottom: 28px;
}
.ws__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  padding: 0 28px;
  align-items: start;
}
.ws__bar {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}
.ws__new {
  margin-left: auto;
}
.ws__cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.ws__empty {
  margin: 0;
  font-size: 13px;
  color: var(--mute);
}
@media (max-width: 1000px) {
  .ws__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .ws__grid {
    padding: 0 16px;
  }
  .ws__cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
