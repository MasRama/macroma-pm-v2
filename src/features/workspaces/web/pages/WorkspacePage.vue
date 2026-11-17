<script setup lang="ts">
import { computed, ref } from 'vue';
import { PageHead, ShellTopBar, TopCrumb, UiButton } from '../../../../shared/ui';
import { NewProjectModal, type NewProjectInput } from '../../../projects/web';
import InviteMemberModal from '../components/InviteMemberModal.vue';
import MembersPanel from '../components/MembersPanel.vue';
import ProjectCard from '../components/ProjectCard.vue';
import type { PendingInvite, WorkspaceMember, WorkspaceProjectCard, WorkspaceSummary } from '../view';

/** A workspace: its project cards on the left, members and pending invitations on the right. */
const props = withDefaults(
  defineProps<{
    workspaceId: string | number;
    workspace?: WorkspaceSummary | null;
    projects?: WorkspaceProjectCard[];
    members?: WorkspaceMember[];
    invites?: PendingInvite[];
    meId?: string | number | null;
    canManage?: boolean;
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
    busy: false,
    now: () => new Date(),
  },
);
const emit = defineEmits<{ createProject: [input: NewProjectInput]; invite: [email: string]; cancelInvite: [id: number] }>();

const newProjectOpen = ref(false);
const inviteOpen = ref(false);

const name = computed(() => props.workspace?.name ?? 'Workspace');
const summary = computed(() =>
  [props.workspace?.description, `${props.members.length} anggota`, `${props.projects.length} project`].filter(Boolean).join(' · '),
);
</script>

<template>
  <div class="ws">
    <ShellTopBar><TopCrumb :trail="['Workspace']" :current="name" /></ShellTopBar>
    <PageHead :title="name" :description="summary" />
    <div class="ws__grid">
      <section aria-labelledby="ws-projects">
        <div class="ws__bar">
          <h2 id="ws-projects" class="h2">Project</h2>
          <UiButton v-if="canManage" class="ws__new" variant="primary" size="sm" icon="plus" @click="newProjectOpen = true">
            Project baru
          </UiButton>
        </div>
        <div v-if="projects.length" class="ws__cards">
          <ProjectCard v-for="project in projects" :key="project.id" :project="project" />
        </div>
        <p v-else class="ws__empty">Belum ada project di workspace ini.</p>
      </section>
      <MembersPanel
        :members="members"
        :invites="invites"
        :me-id="meId"
        :can-manage="canManage"
        :now="now"
        @invite="inviteOpen = true"
        @cancel-invite="emit('cancelInvite', $event)"
      />
    </div>
    <NewProjectModal
      :open="newProjectOpen"
      :workspace-name="workspace?.name"
      :busy="busy"
      @close="newProjectOpen = false"
      @submit="
        emit('createProject', $event);
        newProjectOpen = false;
      "
    />
    <InviteMemberModal
      :open="inviteOpen"
      :workspace-name="name"
      :busy="busy"
      @close="inviteOpen = false"
      @submit="
        emit('invite', $event);
        inviteOpen = false;
      "
    />
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
