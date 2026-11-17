<script setup lang="ts">
import { formatAgoLong, UiAvatar, UiButton, UiIcon } from '../../../../shared/ui';
import type { PendingInvite, WorkspaceMember } from '../view';


withDefaults(
  defineProps<{
    members: WorkspaceMember[];
    invites?: PendingInvite[];
    /** Id of the signed-in person, marked "(kamu)". */
    meId?: string | number | null;
    /** Owner: may cancel invitations and remove members. */
    canManage?: boolean;
    /** Any member may invite. */
    canInvite?: boolean;
    busy?: boolean;
    now?: Date;
  }>(),
  { invites: () => [], meId: null, canManage: false, canInvite: false, busy: false, now: () => new Date() },
);
const emit = defineEmits<{ invite: []; cancelInvite: [id: string]; removeMember: [userId: string] }>();

const isMe = (member: WorkspaceMember, meId: string | number | null) => meId !== null && String(member.person.id) === String(meId);

/** "dikirim kemarin", "dikirim 2 hari lalu", "dikirim 4 Nov". */
function sentLabel(iso: string, now: Date): string {
  const ago = formatAgoLong(iso, now);
  return /^[A-Z][a-z]/.test(ago) ? ago[0]!.toLowerCase() + ago.slice(1) : ago;
}
</script>

<template>
  <section class="panel members" aria-labelledby="members-title">
    <div class="members__head">
      <h2 id="members-title" class="h2 members__title">Anggota</h2>
      <UiButton v-if="canInvite" size="sm" icon="mail" class="members__invite" data-testid="invite-member" @click="emit('invite')">Undang</UiButton>
    </div>
    <ul class="members__list">
      <li v-for="member in members" :key="member.person.id" class="member" :data-member-id="member.person.id">
        <UiAvatar :person="member.person" :size="30" />
        <div class="member__who">
          <b>{{ member.person.name }} <span v-if="isMe(member, meId)">(kamu)</span></b>
          <small>{{ member.email }}</small>
          <button
            v-if="member.role !== 'owner' && (isMe(member, meId) || canManage)"
            type="button"
            class="link member__remove"
            :data-testid="isMe(member, meId) ? 'leave-workspace' : `remove-member-${member.person.id}`"
            :disabled="busy"
            @click="emit('removeMember', String(member.person.id))"
          >
            {{ isMe(member, meId) ? 'Keluar dari workspace' : 'Keluarkan' }}
          </button>
        </div>
        <span class="member__role" :class="`member__role--${member.role}`">{{ member.role === 'owner' ? 'Owner' : 'Member' }}</span>
      </li>
    </ul>
    <template v-if="invites.length">
      <h3 class="cap members__cap">UNDANGAN TERTUNDA</h3>
      <ul class="members__list">
        <li v-for="invite in invites" :key="invite.id" class="member member--invite">
          <span class="member__pending"><UiIcon name="mail" :size="15" :stroke="2" /></span>
          <div class="member__who">
            <b>{{ invite.email }}</b>
            <small>dikirim {{ sentLabel(invite.sentAt, now) }}</small>
          </div>
          <button
            v-if="canManage"
            type="button"
            class="link member__cancel"
            :data-testid="`cancel-invite-${invite.id}`"
            :disabled="busy"
            @click="emit('cancelInvite', invite.id)"
          >
            Batal
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.members {
  padding: 16px 18px;
}
.members__head {
  display: flex;
  align-items: center;
}
.members__title {
  font-size: 16px;
}
.members__invite {
  margin-left: auto;
}
.members__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.members__cap {
  margin: 16px 0 0;
}
.member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line-soft);
}
.member--invite {
  border-bottom: 0;
}
.member__who {
  flex: 1;
  min-width: 0;
}
.member__who b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.member__who b span {
  color: var(--mute);
  font-weight: 500;
}
.member__who small {
  display: block;
  font-size: 11.5px;
  color: var(--mute);
}
.member__role {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}
.member__role--owner {
  background: var(--primary-bg);
  color: var(--primary-fg);
}
.member__role--member {
  border: 1px solid var(--line);
  color: var(--ink2);
}
.member__pending {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1.5px dashed var(--dash);
  color: var(--mute);
}
.member__cancel {
  font-size: 12px;
}
.member__remove {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--mute);
}
</style>
