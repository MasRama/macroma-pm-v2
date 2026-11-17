<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CountBadge, DropdownMenu, formatAgoLong, UiAvatar, UiButton, UiIcon } from '../../../../shared/ui';
import type { NotificationItem } from '../view';

/**
 * Bell button with a red dot while anything is unread; opens the 380px
 * notification panel. Clicking an unread row marks it read; invitation rows
 * answer with Terima/Tolak.
 */
const props = withDefaults(
  defineProps<{
    items?: readonly NotificationItem[];
    /** Unread count from the server; defaults to the unread rows shown. */
    unreadCount?: number | null;
    now?: Date | null;
    busy?: boolean;
    error?: string;
  }>(),
  { items: () => [], unreadCount: null, now: null, busy: false, error: '' },
);
const emit = defineEmits<{ accept: [token: string]; decline: [token: string]; read: [id: string]; markAllRead: [] }>();
const open = defineModel<boolean>('open', { default: false });

const unread = computed(() => props.unreadCount ?? props.items.filter((item) => item.unread).length);
// "5 menit lalu" counts from when the panel opened, not from when the page loaded.
const openedAt = ref(new Date());
watch(open, (value) => {
  if (value) openedAt.value = new Date();
});
const now = computed(() => props.now ?? openedAt.value);
</script>

<template>
  <DropdownMenu v-model:open="open" :width="380" :padded="false">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="bell focus-ring"
        data-testid="notifications-bell"
        :aria-label="unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'"
        :aria-expanded="open"
        @click="toggle"
      >
        <UiIcon name="bell" :size="17" />
        <span v-if="unread" class="bell__dot" data-testid="notifications-dot" />
      </button>
    </template>
    <div class="notif" data-testid="notifications-menu">
      <div class="notif__head">
        <b>Notifikasi</b>
        <CountBadge v-if="unread" :count="unread" />
        <button v-if="unread" type="button" class="link notif__read" data-testid="notifications-read-all" :disabled="busy" @click="emit('markAllRead')">
          Tandai dibaca
        </button>
      </div>
      <p v-if="error" role="alert" class="notif__error">{{ error }}</p>
      <ul v-if="items.length" class="notif__list">
        <li v-for="item in items" :key="item.id" class="notif__item" :data-notification-id="item.id" :data-unread="item.unread">
          <i class="notif__unread" :class="{ 'notif__unread--on': item.unread }" />
          <UiAvatar :person="item.actor" :size="30" />
          <div class="notif__body">
            <component
              :is="item.unread ? 'button' : 'div'"
              :type="item.unread ? 'button' : undefined"
              class="notif__text"
              :class="{ 'notif__text--unread focus-ring': item.unread }"
              :title="item.unread ? 'Tandai dibaca' : undefined"
              :disabled="item.unread ? busy : undefined"
              @click="item.unread && emit('read', item.id)"
            >
              <span v-if="item.kind === 'invited'"><b>{{ item.actor.name }}</b> ngundang kamu ke workspace <b>{{ item.subject }}</b></span>
              <span v-else><b>{{ item.actor.name }}</b> nerima undangan ke <b>{{ item.subject }}</b></span>
              <time class="notif__when" :datetime="item.at">{{ formatAgoLong(item.at, now) }}</time>
            </component>
            <div v-if="item.kind === 'invited' && item.invitationToken" class="notif__acts">
              <UiButton variant="primary" size="sm" data-testid="invite-accept" :disabled="busy" @click="emit('accept', item.invitationToken)">Terima</UiButton>
              <UiButton variant="ghost" size="sm" data-testid="invite-decline" :disabled="busy" @click="emit('decline', item.invitationToken)">Tolak</UiButton>
            </div>
          </div>
        </li>
      </ul>
      <p v-else-if="!error" class="notif__empty">Belum ada notifikasi.</p>
    </div>
  </DropdownMenu>
</template>

<style scoped>
.bell {
  position: relative;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: var(--r-small);
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
}
.bell__dot {
  position: absolute;
  top: 6px;
  right: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--alert);
  border: 1.5px solid var(--card);
}
.notif__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--line);
}
.notif__head b {
  font-size: 15px;
}
.notif__read {
  margin-left: auto;
  font-size: 12px;
}
.notif__list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: min(480px, 70vh);
  overflow-y: auto;
}
.notif__item {
  display: flex;
  gap: 11px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.notif__item:last-child {
  border-bottom: 0;
}
.notif__unread {
  width: 8px;
  height: 8px;
  margin-top: 9px;
  flex-shrink: 0;
  border-radius: 50%;
}
.notif__unread--on {
  background: var(--alert);
}
.notif__body {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.45;
}
.notif__text {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
.notif__text--unread {
  cursor: pointer;
  border-radius: var(--r-small);
}
.notif__text--unread:disabled {
  cursor: default;
}
.notif__error {
  margin: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 12.5px;
  color: var(--alert);
}
.notif__when {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--mute);
}
.notif__acts {
  display: flex;
  gap: 6px;
  margin-top: 9px;
}
.notif__empty {
  margin: 0;
  padding: 18px 14px;
  font-size: 13px;
  color: var(--mute);
}
</style>
