<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  AvatarStack,
  CloseButton,
  formatDayLabel,
  formatTime,
  UiAvatar,
  UiDrawer,
  UiIcon,
  type PersonRef,
} from '../../../../shared/ui';
import type { ChatMessage } from '../view';

/** Workspace chat in a 380px right drawer: ink header, day-grouped bubbles, one-line composer. */
const props = withDefaults(
  defineProps<{
    open: boolean;
    workspaceName: string;
    members?: PersonRef[];
    messages?: ChatMessage[];
    meId?: string | number | null;
    now?: Date;
    sending?: boolean;
    error?: string;
  }>(),
  { members: () => [], messages: () => [], meId: null, now: () => new Date(), sending: false, error: undefined },
);
const emit = defineEmits<{ close: []; send: [body: string] }>();

const draft = ref('');
const scroller = ref<HTMLElement | null>(null);

const days = computed(() => {
  const groups: { label: string; messages: ChatMessage[] }[] = [];
  for (const message of props.messages) {
    const label = formatDayLabel(message.at, props.now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.messages.push(message);
    else groups.push({ label, messages: [message] });
  }
  return groups;
});

function mine(message: ChatMessage): boolean {
  return props.meId !== null && String(message.author.id) === String(props.meId);
}

watch(
  () => [props.open, props.messages.length] as const,
  async () => {
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
);

function send(): void {
  const body = draft.value.trim();
  if (!body || props.sending) return;
  emit('send', body);
  draft.value = '';
}
</script>

<template>
  <UiDrawer :open="open" :label="`Chat ${workspaceName}`" @close="emit('close')">
    <header class="chat__head">
      <div class="chat__titles">
        <small>Chat workspace</small>
        <b>{{ workspaceName }}</b>
      </div>
      <AvatarStack class="chat__people" :people="members" :size="26" :overlap="6" ring="var(--block)" />
      <CloseButton tone="block" @click="emit('close')" />
    </header>
    <div ref="scroller" class="chat__scroll">
      <div class="chat__list">
        <p v-if="messages.length === 0" class="chat__empty">Belum ada pesan. Mulai obrolan tim di sini.</p>
        <template v-for="day in days" :key="day.label">
          <div class="chat__day">{{ day.label }}</div>
          <template v-for="message in day.messages" :key="message.id">
            <div v-if="mine(message)" class="msg msg--mine">
              <div class="msg__col">
                <div class="msg__bubble">{{ message.body }}</div>
                <time class="msg__time" :datetime="message.at">{{ formatTime(message.at) }}</time>
              </div>
            </div>
            <div v-else class="msg">
              <UiAvatar :person="message.author" :size="26" />
              <div class="msg__col">
                <div class="msg__who">
                  {{ message.author.name }} <time :datetime="message.at">{{ formatTime(message.at) }}</time>
                </div>
                <div class="msg__bubble">{{ message.body }}</div>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>
    <form class="chat__compose" @submit.prevent="send">
      <label class="chat__field">
        <span class="sr-only">Pesan</span>
        <input v-model="draft" type="text" placeholder="Tulis pesan…" autocomplete="off" />
        <button type="submit" class="chat__send focus-ring" :disabled="!draft.trim() || sending" aria-label="Kirim">
          <UiIcon name="arrow" :size="15" :stroke="2.2" />
        </button>
      </label>
      <p v-if="error" class="chat__error" role="alert">{{ error }}</p>
      <p class="chat__hint">Enter untuk kirim · update realtime</p>
    </form>
  </UiDrawer>
</template>

<style scoped>
.chat__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  background: var(--block);
  color: var(--block-fg);
  border-bottom: 1px solid var(--block-line);
}
.chat__titles small {
  display: block;
  font-size: 11px;
  color: var(--block-meta);
}
.chat__titles b {
  font-size: 15px;
}
.chat__people {
  margin-left: auto;
}
.chat__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.chat__list {
  margin-top: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chat__empty {
  margin: 0;
  text-align: center;
  font-size: 13px;
  color: var(--mute);
}
.chat__day {
  text-align: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mute);
}
.msg {
  display: flex;
  gap: 8px;
}
.msg--mine {
  justify-content: flex-end;
}
.msg__col {
  max-width: 250px;
  min-width: 0;
}
.msg__who {
  margin-bottom: 3px;
  font-size: 11.5px;
  font-weight: 600;
}
.msg__who time {
  color: var(--mute);
  font-weight: 500;
}
.msg__bubble {
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 3px 12px 12px 12px;
  background: var(--card);
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.msg--mine .msg__bubble {
  border-color: var(--primary-bg);
  border-radius: 12px 12px 3px 12px;
  background: var(--primary-bg);
  color: var(--primary-fg);
}
.msg__time {
  display: block;
  margin-top: 3px;
  text-align: right;
  font-size: 11px;
  color: var(--mute);
}
.chat__compose {
  padding: 14px;
  border-top: 1px solid var(--line);
}
.chat__field {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 7px 0 13px;
  border: 1.5px solid var(--line);
  border-radius: var(--r-control);
  background: var(--field);
}
.chat__field:focus-within {
  border-color: var(--ink);
}
.chat__field input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  font-size: 13.5px;
}
.chat__field input::placeholder {
  color: var(--placeholder);
}
.chat__send {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: var(--primary-bg);
  color: var(--primary-fg);
  cursor: pointer;
}
.chat__send:disabled {
  cursor: default;
}
.chat__error {
  margin: 7px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-revisi);
}
.chat__hint {
  margin: 7px 0 0;
  font-size: 11px;
  color: var(--mute);
}
</style>
