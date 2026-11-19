<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { formatVersion, projectColor } from '../../features/projects/web';
import { CountBadge, DropdownMenu, UiAvatar, UiIcon } from '../../shared/ui';
import MacromaLogo from './MacromaLogo.vue';
import type { ShellLink, ShellProject, ShellUser, ShellWorkspace } from './shell-types';

const props = withDefaults(
  defineProps<{
    user: ShellUser | null;
    workspaces?: ShellWorkspace[];
    currentWorkspaceId?: string | null;
    projects?: ShellProject[];
    chatUnread?: number;
    chatOpen?: boolean;
    adminLinks?: ShellLink[];
    loggingOut?: boolean;
  }>(),
  { workspaces: () => [], currentWorkspaceId: null, projects: () => [], chatUnread: 0, chatOpen: false, adminLinks: () => [], loggingOut: false },
);
const emit = defineEmits<{ chat: []; newWorkspace: []; logout: [] }>();

const route = useRoute();
const switcherOpen = ref(false);
const current = computed(() => props.workspaces.find((workspace) => workspace.id === props.currentWorkspaceId) ?? null);
const activeProject = computed(() => String(route.params.projectId ?? ''));

function isActive(path: string): boolean {
  return !props.chatOpen && route.path === path;
}
</script>

<template>
  <nav class="side" aria-label="Navigasi utama">
    <RouterLink to="/dashboard" class="side__logo" aria-label="Macroma, ke Dashboard"><MacromaLogo /></RouterLink>

    <DropdownMenu v-model:open="switcherOpen" class="side__switch" :width="204" align="left">
      <template #trigger="{ toggle }">
        <button type="button" class="ws focus-ring" :aria-expanded="switcherOpen" @click="toggle">
          <span class="ws__text">
            <small>Workspace</small>
            {{ current?.name ?? 'Pilih workspace' }}
          </span>
          <UiIcon name="updown" :size="14" :stroke="2" class="ws__icon" />
        </button>
      </template>
      <template #default="{ close }">
        <RouterLink
          v-for="workspace in workspaces"
          :key="workspace.id"
          class="menu-item"
          :class="{ 'menu-item--on': workspace.id === currentWorkspaceId }"
          role="menuitem"
          :to="{ name: 'workspace', params: { workspaceId: workspace.id } }"
          @click="close()"
        >
          {{ workspace.name }}
        </RouterLink>
        <p v-if="workspaces.length === 0" class="menu-empty">Belum ada workspace.</p>
        <button
          type="button"
          class="menu-item menu-item--add"
          role="menuitem"
          @click="
            close();
            emit('newWorkspace');
          "
        >
          <UiIcon name="plus" :size="14" :stroke="2" />Workspace baru
        </button>
      </template>
    </DropdownMenu>

    <div class="nav">
      <RouterLink to="/dashboard" class="nav__a" :class="{ 'nav__a--on': isActive('/dashboard') }">
        <UiIcon name="dashboard" />Dashboard
      </RouterLink>
      <RouterLink to="/feed" class="nav__a" :class="{ 'nav__a--on': isActive('/feed') }"><UiIcon name="activity" />Aktivitas</RouterLink>
      <button type="button" class="nav__a" :class="{ 'nav__a--on': chatOpen }" :aria-pressed="chatOpen" @click="emit('chat')">
        <UiIcon name="chat" />Chat
        <CountBadge v-if="chatUnread > 0" class="nav__badge" :count="chatUnread" :label="`${chatUnread} pesan belum dibaca`" />
      </button>
    </div>

    <div class="side__scroll">
      <div class="sec">PROJECT</div>
      <div class="proj">
        <RouterLink
          v-for="project in projects"
          :key="project.id"
          class="proj__a"
          :class="{ 'proj__a--on': String(project.id) === activeProject }"
          :to="{ name: 'project-board', params: { projectId: project.id } }"
        >
          <i :style="{ background: projectColor(project.id) }" />
          <span class="proj__name">{{ project.name }}</span>
          <span v-if="project.batch" class="proj__v mono">{{ formatVersion(project.batch) }}</span>
        </RouterLink>
        <p v-if="projects.length === 0" class="proj__empty">Belum ada project.</p>
      </div>

      <template v-if="adminLinks.length">
        <div class="sec">ADMIN</div>
        <div class="proj">
          <RouterLink v-for="link in adminLinks" :key="link.to" :to="link.to" class="proj__a proj__a--admin" active-class="proj__a--on">
            {{ link.label }}
          </RouterLink>
        </div>
      </template>
    </div>

    <div v-if="user" class="me">
      <RouterLink to="/profile" class="me__who" :aria-label="`Profil ${user.name}`">
        <UiAvatar :person="user" :size="26" ring="var(--side-bg)" />
        <span class="me__text">
          <b>{{ user.name }}</b>
          <small v-if="user.caption">{{ user.caption }}</small>
        </span>
      </RouterLink>
      <RouterLink to="/settings/tokens" class="me__out focus-ring" aria-label="Token API" title="Token API">
        <UiIcon name="key" :size="16" />
      </RouterLink>
      <button type="button" class="me__out focus-ring" aria-label="Keluar" :disabled="loggingOut" @click="emit('logout')">
        <UiIcon name="logout" :size="16" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.side {
  width: 232px;
  height: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  background: var(--side-bg);
  color: var(--side-fg);
}
.side__logo {
  display: block;
  padding: 2px 8px 22px;
  text-decoration: none;
}
.side__switch {
  display: flex;
  margin-bottom: 22px;
}
.ws {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--r-control);
  background: var(--side-raise);
  color: var(--side-fg);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.ws__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws__text small {
  display: block;
  margin-bottom: 1px;
  font-size: 11px;
  font-weight: 500;
  color: var(--side-meta);
}
.ws__icon {
  color: var(--side-meta);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--r-small);
  background: none;
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.menu-item:hover,
.menu-item--on {
  background: var(--fill);
}
.menu-item--on {
  font-weight: 700;
}
.menu-item--add {
  margin-top: 4px;
  border-top: 1px solid var(--line);
  border-radius: 0 0 var(--r-small) var(--r-small);
  font-weight: 600;
}
.menu-empty {
  margin: 0;
  padding: 9px 10px;
  font-size: 12.5px;
  color: var(--mute);
}
.nav__a {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--r-small);
  background: none;
  color: var(--side-text);
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.nav__a:hover {
  background: var(--side-raise);
}
.nav__a--on,
.nav__a--on:hover {
  background: var(--side-on-bg);
  color: var(--side-on-fg);
  font-weight: 700;
}
.nav__badge {
  margin-left: auto;
}
.side__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -4px;
  padding: 0 4px;
  scrollbar-width: thin;
}
.sec {
  padding: 20px 10px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--side-sec);
}
.proj__a {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r-small);
  color: var(--side-text);
  font-size: 13.5px;
  font-weight: 500;
  text-decoration: none;
}
.proj__a:hover {
  background: var(--side-raise);
}
.proj__a i {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: 2px;
}
.proj__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proj__v {
  margin-left: auto;
  font-size: 11px;
  color: var(--side-meta);
}
.proj__a--on,
.proj__a--on:hover {
  background: var(--side-on-bg);
  color: var(--side-on-fg);
  font-weight: 700;
}
.proj__a--on .proj__v {
  color: var(--mute);
}
.proj__empty {
  margin: 0;
  padding: 4px 10px;
  font-size: 12.5px;
  color: var(--side-meta);
}
.me {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 16px 4px 0 10px;
  border-top: 1px solid var(--side-line);
}
.me__who {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--side-fg);
  text-decoration: none;
}
.me__text {
  min-width: 0;
}
.me__text b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.me__text small {
  display: block;
  font-size: 11px;
  color: var(--side-meta);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.me__out {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--r-small);
  background: none;
  color: var(--side-meta);
  cursor: pointer;
}
.me__out:hover {
  background: var(--side-raise);
  color: var(--side-fg);
}
</style>
