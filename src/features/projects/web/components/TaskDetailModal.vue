<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CloseButton,
  ConfirmDialog,
  formatDay,
  formatDayTime,
  formatStamp,
  TextArea,
  UiAvatar,
  UiButton,
  UiDropzone,
  UiIcon,
  UiModal,
  UiTabs,
  type TabOption,
} from '../../../../shared/ui';
import PriorityBars from './PriorityBars.vue';
import StatusBlock from './StatusBlock.vue';
import TimelineNode from './TimelineNode.vue';
import VersionText from './VersionText.vue';
import { formatVersion } from '../format';
import type { TaskComment, TaskDetailData, TaskDetailTab, TaskImage } from '../view';

const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;

const props = withDefaults(
  defineProps<{
    open: boolean;
    task: TaskDetailData | null;
    /** The task's comments; `null` leaves the Komentar tab out. */
    comments?: TaskComment[] | null;
    /** The task's images; `null` leaves the Gambar tab out. */
    images?: TaskImage[] | null;
    initialTab?: TaskDetailTab;
    canEdit?: boolean;
    canDelete?: boolean;
    deleting?: boolean;
    commentError?: string;
  }>(),
  { comments: null, images: null, initialTab: 'detail', canEdit: true, canDelete: true, deleting: false, commentError: undefined },
);
const emit = defineEmits<{
  close: [];
  move: [];
  edit: [];
  delete: [];
  comment: [body: string];
  upload: [files: File[]];
}>();

const tab = ref<string>(props.initialTab);
const draft = ref('');
const confirmDelete = ref(false);

watch(
  () => [props.open, props.task?.id] as const,
  ([open]) => {
    if (!open) return;
    tab.value = tabs.value.some((option) => option.value === props.initialTab) ? props.initialTab : 'detail';
    draft.value = '';
    confirmDelete.value = false;
  },
);

const tabs = computed<TabOption[]>(() => [
  { value: 'detail', label: 'Detail' },
  ...(props.comments ? [{ value: 'comments', label: 'Komentar', count: props.comments.length }] : []),
  { value: 'history', label: 'Riwayat versi', count: props.task?.logs.length ?? 0 },
  ...(props.images ? [{ value: 'images', label: 'Gambar', count: props.images.length }] : []),
]);
const comments = computed(() => props.comments ?? []);
const images = computed(() => props.images ?? []);

/** Newest version first, the way the timeline reads. */
const logs = computed(() => [...(props.task?.logs ?? [])].sort((a, b) => b.at.localeCompare(a.at)));

function sendComment(): void {
  const body = draft.value.trim();
  if (!body) return;
  emit('comment', body);
  draft.value = '';
}
</script>

<template>
  <UiModal :open="open && task !== null" variant="sheet" :width="1100" @close="emit('close')">
    <div v-if="task" class="td">
      <header class="td__head">
        <div class="td__titles">
          <div class="td__meta">
            <StatusBlock :status="task.status" />
            <VersionText class="td__ver" :version="task.version" />
            <span class="td__where">· {{ task.projectName }}<template v-if="task.batch"> / batch {{ formatVersion(task.batch) }}</template></span>
          </div>
          <h2 class="td__title">{{ task.title }}</h2>
        </div>
        <CloseButton @click="emit('close')" />
      </header>

      <div class="td__split">
        <section class="td__main">
          <UiTabs v-model="tab" :tabs="tabs" label="Bagian task" />
          <div class="td__pane">
            <template v-if="tab === 'detail'">
              <p v-if="task.description" class="td__desc">{{ task.description }}</p>
              <p v-else class="td__empty">Belum ada deskripsi.</p>
            </template>

            <template v-else-if="tab === 'comments'">
              <ul v-if="comments.length" class="td__comments">
                <li v-for="comment in comments" :key="comment.id" class="td__comment">
                  <UiAvatar :person="comment.author" :size="28" />
                  <div class="td__bubble">
                    <div class="td__who">
                      <b>{{ comment.author.name }}</b>
                      <time :datetime="comment.at">{{ formatStamp(comment.at) }}</time>
                    </div>
                    <p>{{ comment.body }}</p>
                  </div>
                </li>
              </ul>
              <p v-else class="td__empty">Belum ada komentar.</p>
              <form class="td__reply" @submit.prevent="sendComment">
                <TextArea id="task-comment" v-model="draft" label="Komentar" placeholder="Tulis komentar…" :error="commentError" />
                <UiButton variant="primary" type="submit" size="sm" :disabled="!draft.trim()">Kirim</UiButton>
              </form>
            </template>

            <template v-else-if="tab === 'history'">
              <ol class="td__timeline">
                <TimelineNode
                  v-for="(entry, index) in logs"
                  :key="entry.id"
                  :entry="entry"
                  :latest="index === 0"
                  :last="index === logs.length - 1"
                />
              </ol>
            </template>

            <template v-else>
              <ul v-if="images.length" class="td__images">
                <li v-for="image in images" :key="image.id">
                  <a :href="image.url" target="_blank" rel="noopener" class="td__image focus-ring">
                    <img :src="image.url" :alt="image.name" loading="lazy" />
                  </a>
                </li>
              </ul>
              <UiDropzone v-if="canEdit" id="task-detail-images" @files="emit('upload', $event)" />
            </template>
          </div>
        </section>

        <aside class="td__rail">
          <dl class="td__props">
            <div><dt>Status</dt><dd><StatusBlock :status="task.status" /></dd></div>
            <div><dt>Prioritas</dt><dd><PriorityBars :priority="task.priority" />{{ PRIORITY_LABEL[task.priority] }}</dd></div>
            <div>
              <dt>Assignee</dt>
              <dd>
                <template v-if="task.assignee"><UiAvatar :person="task.assignee" :size="22" />{{ task.assignee.name }}</template>
                <span v-else class="td__none">Belum ada</span>
              </dd>
            </div>
            <div><dt>Batch</dt><dd class="mono">{{ task.batch ? formatVersion(task.batch) : '—' }}</dd></div>
            <div><dt>Versi</dt><dd class="mono">{{ formatVersion(task.version) }}</dd></div>
            <div>
              <dt>Pindah ke revisi</dt>
              <dd :class="{ 'td__rev': task.revisiCount > 0 }">{{ task.revisiCount }}x</dd>
            </div>
            <div><dt>Dibuat</dt><dd>{{ formatDay(task.createdAt) }}<template v-if="task.createdBy"> · {{ task.createdBy.name }}</template></dd></div>
            <div><dt>Update</dt><dd>{{ formatDayTime(task.updatedAt) }}</dd></div>
          </dl>
          <div class="td__actions">
            <UiButton variant="primary" block data-testid="task-move" @click="emit('move')">
              <UiIcon name="arrow" :size="14" :stroke="2.2" />Pindah task
            </UiButton>
            <UiButton v-if="canEdit" variant="ghost" block data-testid="task-edit" @click="emit('edit')">Edit task</UiButton>
            <button v-if="canDelete" type="button" class="td__delete focus-ring" data-testid="task-delete" @click="confirmDelete = true">
              Hapus task
            </button>
          </div>
        </aside>
      </div>
    </div>
  </UiModal>
  <ConfirmDialog
    :open="confirmDelete"
    title="Hapus task ini?"
    :message="`“${task?.title ?? ''}” dan seluruh riwayat versinya akan dihapus permanen.`"
    confirm-label="Hapus task"
    :busy="deleting"
    @cancel="confirmDelete = false"
    @confirm="
      confirmDelete = false;
      emit('delete');
    "
  />
</template>

<style scoped>
.td {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.td__head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 28px 0;
}
.td__titles {
  flex: 1;
  min-width: 0;
}
.td__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.td__ver {
  font-size: 13px;
  font-weight: 700;
}
.td__where {
  font-size: 12.5px;
  color: var(--mute);
}
.td__title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.td__split {
  display: flex;
  flex: 1;
  min-height: 0;
  margin-top: 18px;
}
.td__main {
  flex: 1;
  min-width: 0;
  padding: 0 28px;
  display: flex;
  flex-direction: column;
}
.td__pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 0 24px;
}
.td__timeline {
  margin: 0;
  padding: 0;
}
.td__desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ink2);
  white-space: pre-line;
}
.td__empty {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--mute);
}
.td__comments {
  margin: 0 0 18px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.td__comment {
  display: flex;
  gap: 10px;
}
.td__bubble {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  padding: 11px 13px;
  font-size: 13.5px;
  line-height: 1.5;
}
.td__bubble p {
  margin: 4px 0 0;
  color: var(--ink2);
  white-space: pre-line;
}
.td__who {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.td__who b {
  font-weight: 600;
}
.td__who time {
  margin-left: auto;
  font-size: 12px;
  color: var(--mute);
}
.td__reply {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.td__reply > :first-child {
  align-self: stretch;
}
.td__images {
  margin: 0 0 16px;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.td__image {
  display: block;
  aspect-ratio: 4 / 3;
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--fill);
}
.td__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.td__rail {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--line);
  padding: 6px 24px 24px;
  display: flex;
  flex-direction: column;
}
.td__props {
  margin: 0;
}
.td__props > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
}
.td__props dt {
  color: var(--mute);
  font-weight: 500;
}
.td__props dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  text-align: right;
}
.td__none {
  color: var(--mute);
  font-weight: 500;
}
.td__rev {
  color: var(--c-revisi);
}
.td__actions {
  margin-top: auto;
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.td__delete {
  align-self: center;
  margin-top: 6px;
  border: 0;
  background: none;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-revisi);
  cursor: pointer;
}
@media (max-width: 860px) {
  .td__head {
    padding: 20px 18px 0;
  }
  .td__title {
    font-size: 22px;
  }
  .td__split {
    flex-direction: column;
    overflow-y: auto;
  }
  .td__main {
    padding: 0 18px;
  }
  .td__pane {
    overflow: visible;
  }
  .td__rail {
    width: auto;
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 6px 18px 18px;
  }
}
</style>
