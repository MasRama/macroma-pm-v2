<script setup lang="ts">
import { computed } from 'vue';
import { CountBadge, DropdownMenu, formatAgoLong, UiAvatar, UiButton, UiIcon } from '../../../../shared/ui';
import type { NotificationItem } from '../view';

/** Bell button with a red dot while anything is unread; opens the 380px notification panel. */
const props = withDefaults(defineProps<{ items?: NotificationItem[]; now?: Date; busy?: boolean }>(), {
  items: () => [],
  now: () => new Date(),
  busy: false,
});
const emit = defineEmits<{ accept: [invitationId: number]; decline: [invitationId: number]; markAllRead: [] }>();
const open = defineModel<boolean>('open', { default: false });

const unread = computed(() => props.items.filter((item) => item.unread).length);
</script>

<template>
  <DropdownMenu v-model:open="open" :width="380" :padded="false">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="bell focus-ring"
        :aria-label="unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'"
        :aria-expanded="open"
        @click="toggle"
      >
        <UiIcon name="bell" :size="17" />
        <span v-if="unread" class="bell__dot" />
      </button>
    </template>
    <div class="notif">
      <div class="notif__head">
        <b>Notifikasi</b>
        <CountBadge v-if="unread" :count="unread" />
        <button v-if="unread" type="button" class="link notif__read" @click="emit('markAllRead')">Tandai dibaca</button>
      </div>
      <ul v-if="items.length" class="notif__list">
        <li v-for="item in items" :key="item.id" class="notif__item">
          <i class="notif__unread" :class="{ 'notif__unread--on': item.unread }" />
          <UiAvatar :person="item.actor" :size="30" />
          <div class="notif__body">
            <span v-if="item.kind === 'invited'"><b>{{ item.actor.name }}</b> ngundang kamu ke workspace <b>{{ item.subject }}</b></span>
            <span v-else-if="item.kind === 'invite-accepted'"><b>{{ item.actor.name }}</b> nerima undangan ke <b>{{ item.subject }}</b></span>
            <span v-else>
              <b>{{ item.actor.name }}</b> mindahin <b>{{ item.subject }}</b><template v-if="item.target"> ke {{ item.target }}</template>
            </span>
            <time class="notif__when" :datetime="item.at">{{ formatAgoLong(item.at, now) }}</time>
            <div v-if="item.kind === 'invited' && item.invitationId" class="notif__acts">
              <UiButton variant="primary" size="sm" :disabled="busy" @click="emit('accept', item.invitationId)">Terima</UiButton>
              <UiButton variant="ghost" size="sm" :disabled="busy" @click="emit('decline', item.invitationId)">Tolak</UiButton>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="notif__empty">Belum ada notifikasi.</p>
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
