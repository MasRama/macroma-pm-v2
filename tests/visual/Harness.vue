<script setup lang="ts">
import { ref } from 'vue';
import AppFrame from '../../src/app/layouts/AppFrame.vue';
import UsersAdminPage from '../../src/app/pages/admin/UsersAdminPage.vue';
import ForgotPasswordPage from '../../src/app/pages/auth/ForgotPasswordPage.vue';
import LoginPage from '../../src/app/pages/auth/LoginPage.vue';
import RegisterPage from '../../src/app/pages/auth/RegisterPage.vue';
import ResetPasswordPage from '../../src/app/pages/auth/ResetPasswordPage.vue';
import NotFoundPage from '../../src/app/pages/NotFoundPage.vue';
import ProfilePage from '../../src/app/pages/ProfilePage.vue';
import TokensPage from '../../src/app/pages/TokensPage.vue';
import {
  ActivityPage,
  BoardView,
  DashboardView,
  EditTaskModal,
  MoveTaskModal,
  NewTaskModal,
  nextTaskVersion,
  ReleasesView,
  TaskDetailModal,
} from '../../src/features/projects/web';
import { ChatDrawer, WorkspaceView } from '../../src/features/workspaces/web';
import { ConfirmDialog } from '../../src/shared/ui';
import * as f from './fixtures';
import { screenName } from './screens';

const screen = screenName(new URLSearchParams(window.location.search).get('screen'));
const batchFilter = ref('b23');
const selectedRelease = ref('b22');
const editForm = ref({ title: f.detail.title, description: f.detail.description ?? '', priority: f.detail.priority, assigneeId: '1' });
const framed = !['login', 'register', 'forgot-password', 'reset-password', 'not-found'].includes(screen);
const chatOpen = screen === 'chat';
const boardScreens = ['board', 'task-detail', 'task-comments', 'task-images', 'new-task', 'move-task', 'edit-task', 'confirm', 'bump', 'first-bump', 'notifications'];
/** A new project: no batch yet, so the owner opens the first one. */
const firstBump = screen === 'first-bump';
</script>

<template>
  <LoginPage v-if="screen === 'login'" />
  <RegisterPage v-else-if="screen === 'register'" />
  <ForgotPasswordPage v-else-if="screen === 'forgot-password'" />
  <ResetPasswordPage v-else-if="screen === 'reset-password'" />
  <NotFoundPage v-else-if="screen === 'not-found'" />
  <template v-else-if="framed">
    <AppFrame
      :user="f.shellUser"
      :workspaces="f.workspaces"
      :current-workspace-id="'w1'"
      :projects="f.sidebarProjects"
      :chat-unread="3"
      :chat-open="chatOpen"
      :admin-links="[]"
      :notifications="f.notifications"
    >
      <BoardView
        v-if="boardScreens.includes(screen)"
        v-model:batch-filter="batchFilter"
        project-id="p1"
        :project="f.project"
        :batches="firstBump ? [] : f.batches"
        :tasks="firstBump ? [] : f.tasks"
        :members="f.team"
        :can-bump="true"
        :can-create="true"
      />
      <ReleasesView
        v-else-if="screen === 'releases'"
        v-model:selected-id="selectedRelease"
        project-id="p1"
        :project="f.project"
        :active-batch="f.batches[2]"
        :latest="f.batches[2]"
        :releases="f.releases"
        :detail="f.releaseDetail"
        :can-bump="true"
      />
      <DashboardView
        v-else-if="screen === 'dashboard'"
        user-name="Ren"
        :now="f.NOW"
        :workspace-count="3"
        :stats="f.stats"
        :health="f.health"
        :activity="f.activity"
        :can-create-project="true"
      />
      <WorkspaceView
        v-else-if="screen === 'workspace' || screen === 'chat'"
        :workspace="f.workspace"
        :projects="f.wsProjects"
        :members="f.members"
        :invites="f.invites"
        :me-id="1"
        :can-manage="true"
        :can-invite="true"
        :can-create-project="true"
        :now="f.NOW"
      />
      <ActivityPage v-else-if="screen === 'feed'" :entries="f.activity" :now="f.NOW" />
      <ProfilePage v-else-if="screen === 'profile'" />
      <TokensPage v-else-if="screen.startsWith('tokens')" />
      <UsersAdminPage v-else-if="screen === 'users' || screen === 'users-edit'" />
    </AppFrame>
    <ChatDrawer
      :open="chatOpen"
      workspace-name="Wajom Studio"
      :members="f.team"
      :messages="f.messages"
      :me-id="1"
      :now="f.NOW"
    />
    <NewTaskModal
      :open="screen === 'new-task'"
      :batch="{ major: 2, minor: 3 }"
      :start-version="nextTaskVersion({ major: 2, minor: 3 }, 'b23', f.tasks)"
      :members="f.team"
      allow-files
    />
    <MoveTaskModal
      :open="screen === 'move-task'"
      :task="f.tasks[3] ?? null"
      initial-target="review"
      :next-version="nextTaskVersion({ major: 2, minor: 3 }, 'b23', f.tasks)"
      note-error="Catatan wajib diisi"
    />
    <TaskDetailModal
      :open="screen === 'task-detail'"
      :task="f.detail"
      :comments="f.detailComments"
      :images="f.detailImages"
      initial-tab="history"
    />
    <TaskDetailModal
      :open="screen === 'task-comments'"
      :task="f.detail"
      :comments="f.detailComments"
      :images="f.detailImages"
      initial-tab="comments"
      comment-error="Komentar wajib diisi, maksimal 2000 karakter."
    />
    <TaskDetailModal
      :open="screen === 'task-images'"
      :task="f.detail"
      :comments="f.detailComments"
      :images="f.detailImages"
      initial-tab="images"
      :can-remove-image="() => true"
      image-error="big-screenshot.png: maksimal 5 MB."
    />
    <EditTaskModal
      v-model:title="editForm.title"
      v-model:description="editForm.description"
      v-model:priority="editForm.priority"
      v-model:assignee-id="editForm.assigneeId"
      :open="screen === 'edit-task'"
      :members="f.team"
      merge-notice="Task ini disimpan orang lain saat kamu mengedit. Cek isiannya lalu simpan lagi."
      :conflicts="['title']"
      :theirs="{ ...editForm, title: 'Pairing code 8 digit (tanpa QR)' }"
    />
    <ConfirmDialog
      :open="screen === 'confirm'"
      title="Hapus project Wajom Portal?"
      message="Semua task, batch, dan data terkait project ini akan dihapus permanen."
      confirm-label="Hapus permanen"
    />
  </template>
</template>
