<script setup lang="ts">
import { ref } from 'vue';
import AppFrame from '../../src/app/layouts/AppFrame.vue';
import LoginPage from '../../src/app/pages/auth/LoginPage.vue';
import NotFoundPage from '../../src/app/pages/NotFoundPage.vue';
import ProfilePage from '../../src/app/pages/ProfilePage.vue';
import {
  ActivityPage,
  BoardPage,
  DashboardPage,
  MoveTaskModal,
  NewTaskModal,
  ReleasesPage,
} from '../../src/features/projects/web';
import { ChatDrawer, WorkspacePage } from '../../src/features/workspaces/web';
import { ConfirmDialog } from '../../src/shared/ui';
import * as f from './fixtures';
import { screenName } from './screens';

const screen = screenName(new URLSearchParams(window.location.search).get('screen'));
const batchFilter = ref('23');
const selectedRelease = ref(22);
const framed = !['login', 'not-found'].includes(screen);
const chatOpen = screen === 'chat';
const boardScreens = ['board', 'task-detail', 'new-task', 'move-task', 'confirm', 'bump', 'notifications'];
</script>

<template>
  <LoginPage v-if="screen === 'login'" />
  <NotFoundPage v-else-if="screen === 'not-found'" />
  <template v-else-if="framed">
    <AppFrame
      :user="f.shellUser"
      :workspaces="f.workspaces"
      :current-workspace-id="1"
      :projects="f.sidebarProjects"
      :chat-unread="3"
      :chat-open="chatOpen"
      :admin-links="[]"
      :notifications="f.notifications"
    >
      <BoardPage
        v-if="boardScreens.includes(screen)"
        v-model:batch-filter="batchFilter"
        project-id="1"
        :project="f.project"
        :batches="f.batches"
        :tasks="f.tasks"
        :members="f.team"
        :can-bump="true"
        :can-create="true"
        :task-id="screen === 'task-detail' ? 4 : null"
        :detail="screen === 'task-detail' ? f.detail : null"
        detail-tab="history"
      />
      <ReleasesPage
        v-else-if="screen === 'releases'"
        v-model:selected-id="selectedRelease"
        project-id="1"
        :project="f.project"
        :active-batch="f.batches[2]"
        :releases="f.releases"
        :detail="f.releaseDetail"
        :can-bump="true"
      />
      <DashboardPage
        v-else-if="screen === 'dashboard'"
        user-name="Ren"
        :now="f.NOW"
        :workspace-count="3"
        :stats="f.stats"
        :health="f.health"
        :activity="f.activity"
        :can-create-project="true"
      />
      <WorkspacePage
        v-else-if="screen === 'workspace' || screen === 'chat'"
        workspace-id="1"
        :workspace="f.workspace"
        :projects="f.wsProjects"
        :members="f.members"
        :invites="f.invites"
        :me-id="1"
        :can-manage="true"
        :now="f.NOW"
      />
      <ActivityPage v-else-if="screen === 'feed'" :entries="f.activity" :now="f.NOW" />
      <ProfilePage v-else-if="screen === 'profile'" />
    </AppFrame>
    <ChatDrawer
      :open="chatOpen"
      workspace-name="Wajom Studio"
      :members="f.team"
      :messages="f.messages"
      :me-id="1"
      :now="f.NOW"
    />
    <NewTaskModal :open="screen === 'new-task'" :batch="{ major: 2, minor: 3 }" :members="f.team" />
    <MoveTaskModal
      :open="screen === 'move-task'"
      :task="f.tasks[3] ?? null"
      initial-target="review"
      note-error="Catatan wajib diisi"
    />
    <ConfirmDialog
      :open="screen === 'confirm'"
      title="Hapus project Wajom Portal?"
      message="Semua task, batch, dan data terkait project ini akan dihapus permanen."
      confirm-label="Hapus permanen"
    />
  </template>
</template>
