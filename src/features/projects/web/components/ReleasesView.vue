<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { formatDay, PageHead, UiAvatar, UiTabs, type TabOption } from '../../../../shared/ui';
import BumpVersionMenu from './BumpVersionMenu.vue';
import PriorityBars from './PriorityBars.vue';
import ProjectTopBar from './ProjectTopBar.vue';
import StatusBar from './StatusBar.vue';
import VersionText from './VersionText.vue';
import { formatVersion, STATUS_COLOR, STATUS_LABEL, totalCount } from '../format';
import type { BatchSummary, BatchVersion, BumpKind, ProjectSummary, ReleaseDetail, ReleaseSummary } from '../view';

/**
 * Rilis, presentational: every batch is a release. The active batch on top,
 * shipped ones below (SUDAH RILIS), the selected release's numbers, changelog
 * and contributors on the right. The parent loads the data and owns the URL.
 */
const CHANGELOG_PREVIEW = 8;

const props = withDefaults(
  defineProps<{
    projectId: string;
    project?: ProjectSummary | null;
    activeBatch?: BatchSummary | null;
    /** The project's highest batch version, for Bump versi; `null` before its first batch. */
    latest?: BatchVersion | null;
    releases?: ReleaseSummary[];
    /** Id of the release shown on the right. */
    selectedId?: string | null;
    detail?: ReleaseDetail | null;
    /** Why the right panel has no release (it failed to load, or the URL names a batch that is gone). */
    detailError?: string;
    canBump?: boolean;
    busy?: boolean;
  }>(),
  {
    project: null,
    activeBatch: null,
    latest: null,
    releases: () => [],
    selectedId: null,
    detail: null,
    detailError: '',
    canBump: false,
    busy: false,
  },
);
const emit = defineEmits<{ 'update:selectedId': [id: string]; bump: [kind: BumpKind] }>();

/** One column (tablets and phones) puts the panel under the list: bring it into sight when a release is picked. */
const panel = ref<HTMLElement | null>(null);
async function pick(id: string): Promise<void> {
  emit('update:selectedId', id);
  if (!window.matchMedia?.('(max-width: 1100px)').matches) return;
  await nextTick();
  panel.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

const tab = ref('changelog');
const showAll = ref(false);
watch(
  () => props.detail?.id,
  () => {
    tab.value = 'changelog';
    showAll.value = false;
  },
);

const tabs = computed<TabOption[]>(() => [
  { value: 'changelog', label: 'Changelog', count: props.detail?.changelog.length ?? 0 },
  { value: 'contributors', label: 'Kontributor', count: props.detail?.contributors.length ?? 0 },
]);
const changelog = computed(() => {
  const all = props.detail?.changelog ?? [];
  return showAll.value ? all : all.slice(0, CHANGELOG_PREVIEW);
});
const hiddenCount = computed(() => (props.detail?.changelog.length ?? 0) - changelog.value.length);
</script>

<template>
  <div class="rel">
    <ProjectTopBar
      :project-id="projectId"
      :project-name="project?.name ?? 'Project'"
      :workspace-name="project?.workspaceName"
      active="releases"
    />
    <PageHead title="Rilis" description="Tiap batch adalah satu rilis. Bump versi menutup batch aktif dan membuka yang baru.">
      <template v-if="canBump" #actions>
        <BumpVersionMenu :current="latest ?? activeBatch" :closing="activeBatch" :class="{ 'rel__busy': busy }" @bump="emit('bump', $event)" />
      </template>
    </PageHead>
    <slot name="notice" />

    <div class="rel__grid">
      <div class="rel__list">
        <div v-if="activeBatch" class="active" data-testid="release-active">
          <div class="active__row">
            <VersionText class="active__ver" :version="activeBatch" />
            <div class="active__lab">
              <small>Batch aktif · dibuka {{ formatDay(activeBatch.openedAt) }}</small>
              <b>{{ activeBatch.label }}</b>
            </div>
            <div class="active__count">
              <b>{{ activeBatch.counts.done }}</b><span> /{{ totalCount(activeBatch.counts) }}</span>
            </div>
          </div>
          <StatusBar class="active__bar" :counts="activeBatch.counts" :height="8" />
        </div>
        <p v-else-if="project" class="rel__none" data-testid="release-no-active">
          <b>Belum ada batch aktif.</b>
          {{ canBump ? 'Bump versi untuk membuka batch berikutnya.' : 'Owner project membuka batch lewat Bump versi.' }}
        </p>

        <div class="rel__cap cap">SUDAH RILIS</div>
        <p v-if="releases.length === 0" class="rel__empty" data-testid="release-none">Belum ada rilis. Batch masuk ke sini setelah Bump versi menutupnya.</p>
        <button
          v-for="release in releases"
          :key="release.id"
          type="button"
          class="release focus-ring"
          :class="{ 'release--on': release.id === selectedId }"
          :aria-pressed="release.id === selectedId"
          data-testid="release-item"
          :data-release-id="release.id"
          @click="pick(release.id)"
        >
          <VersionText class="release__ver" :version="release" />
          <span class="release__body">
            <span class="release__title">
              <b>{{ release.label }}</b>
              <span v-if="release.isMajor" class="release__major">MAJOR</span>
            </span>
            <span class="release__dates">{{ formatDay(release.openedAt) }} → {{ formatDay(release.closedAt) }}</span>
          </span>
          <span class="release__n"><b>{{ release.taskCount }}</b><small>task</small></span>
        </button>
      </div>

      <section v-if="detail" ref="panel" class="panel detail" data-testid="release-detail" :aria-label="`Rilis ${formatVersion(detail)}`">
        <div class="detail__head">
          <div>
            <div class="detail__ver-row">
              <VersionText class="detail__ver" :version="detail" />
              <span v-if="detail.closedAt" class="detail__shipped">Rilis {{ formatDay(detail.closedAt) }}</span>
              <span v-else-if="detail.isActive" class="detail__shipped detail__shipped--active">Batch aktif</span>
              <span v-else class="detail__shipped detail__shipped--planned">Belum rilis</span>
            </div>
            <div class="detail__label">{{ detail.label }}</div>
          </div>
          <dl class="detail__nums">
            <div><dt>task</dt><dd>{{ detail.taskCount }}</dd></div>
            <div><dt>hari</dt><dd>{{ detail.durationDays ?? '–' }}</dd></div>
            <div><dt>pernah revisi</dt><dd class="detail__rev">{{ detail.revisiTaskCount }}</dd></div>
          </dl>
        </div>
        <UiTabs v-model="tab" class="detail__tabs" :tabs="tabs" label="Isi rilis" />
        <template v-if="tab === 'changelog'">
          <p v-if="detail.changelog.length === 0" class="detail__nothing">Belum ada task di batch ini.</p>
          <ul v-else class="rows">
            <li v-for="entry in changelog" :key="entry.id" class="row" data-testid="changelog-row">
              <span class="row__sq" :style="{ background: STATUS_COLOR[entry.status] }" :title="STATUS_LABEL[entry.status]" />
              <span class="row__title">{{ entry.title }}</span>
              <PriorityBars :priority="entry.priority" />
              <VersionText class="row__ver" :version="entry.version" />
              <UiAvatar v-if="entry.assignee" :person="entry.assignee" :size="22" />
              <span v-else class="row__noone" />
            </li>
          </ul>
          <button v-if="hiddenCount > 0" type="button" class="detail__more" @click="showAll = true">
            +{{ hiddenCount }} task lain
          </button>
        </template>
        <p v-else-if="detail.contributors.length === 0" class="detail__nothing">Belum ada kontributor.</p>
        <ul v-else class="rows">
          <li v-for="contributor in detail.contributors" :key="contributor.person.id" class="row" data-testid="contributor-row">
            <UiAvatar :person="contributor.person" :size="26" />
            <span class="row__title">{{ contributor.person.name }}</span>
            <span class="row__tasks"><b>{{ contributor.taskCount }}</b> task</span>
          </li>
        </ul>
      </section>
      <section v-else ref="panel" class="panel detail detail--empty" data-testid="release-detail-empty">
        <p v-if="detailError" role="alert">{{ detailError }}</p>
        <p v-else-if="releases.length">Pilih rilis di kiri untuk lihat changelog-nya.</p>
        <p v-else>Changelog muncul di sini setelah batch pertama ditutup.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rel {
  padding-bottom: 28px;
}
.rel__grid {
  display: grid;
  grid-template-columns: 440px minmax(0, 1fr);
  gap: 18px;
  padding: 0 28px;
  align-items: start;
}
.rel__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.active {
  background: var(--block);
  border: 1px solid var(--block-line);
  color: var(--block-fg);
  border-radius: var(--r-panel);
  padding: 18px 20px;
}
.active__row {
  display: flex;
  align-items: center;
}
.active__ver {
  font-size: 28px;
  font-weight: 700;
}
.active__lab {
  margin-left: 10px;
  min-width: 0;
}
.active__lab small {
  display: block;
  font-size: 11px;
  color: var(--block-meta);
}
.active__lab b {
  font-size: 15px;
  font-weight: 600;
}
.active__count {
  margin-left: auto;
  text-align: right;
}
.active__count b {
  font-size: 22px;
}
.active__count span {
  color: var(--block-dim);
}
.active__bar {
  margin-top: 14px;
}
.rel__cap {
  padding: 8px 2px 0;
}
.rel__empty,
.detail__nothing {
  margin: 0;
  font-size: 13px;
  color: var(--mute);
}
.detail__nothing {
  padding: 14px 0 0;
}
.rel__none {
  margin: 0;
  padding: 16px 18px;
  border: 1px dashed var(--line);
  border-radius: var(--r-panel);
  font-size: 13px;
  color: var(--mute);
}
.rel__none b {
  color: var(--ink);
}
.rel__busy {
  pointer-events: none;
  opacity: 0.6;
}
.release {
  display: flex;
  align-items: center;
  gap: 18px;
  width: 100%;
  padding: 15px 18px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-panel);
  text-align: left;
  cursor: pointer;
}
.release--on {
  border: 2px solid var(--ink);
  padding: 14px 17px;
}
.release__ver {
  width: 62px;
  flex-shrink: 0;
  font-size: 22px;
  font-weight: 700;
}
.release__body {
  flex: 1;
  min-width: 0;
}
.release__title {
  display: flex;
  align-items: center;
}
.release__title b {
  font-size: 14px;
  font-weight: 600;
}
.release__major {
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--primary-bg);
  color: var(--primary-fg);
  font-size: 11px;
  font-weight: 700;
}
.release__dates {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--mute);
}
.release__n {
  text-align: right;
}
.release__n b {
  font-size: 16px;
}
.release__n small {
  display: block;
  font-size: 11.5px;
  color: var(--mute);
}
.detail {
  padding: 22px 26px;
  scroll-margin-top: 16px;
}
.detail--empty p {
  margin: 0;
  font-size: 13px;
  color: var(--mute);
}
.detail__head {
  display: flex;
  align-items: flex-end;
}
.detail__ver-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.detail__ver {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.detail__shipped {
  padding: 4px 8px;
  border-radius: var(--r-block);
  background: var(--c-done);
  color: var(--on-status);
  font-size: 12px;
  font-weight: 700;
}
.detail__shipped--active {
  background: var(--block);
  color: var(--block-fg);
}
.detail__shipped--planned {
  background: var(--c-backlog);
}
.detail__label {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 600;
}
.detail__nums {
  margin: 0 0 0 auto;
  display: flex;
  gap: 26px;
  text-align: right;
}
.detail__nums div {
  display: flex;
  flex-direction: column-reverse;
}
.detail__nums dt {
  font-size: 11.5px;
  color: var(--mute);
}
.detail__nums dd {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.detail__rev {
  color: var(--c-revisi);
}
.detail__tabs {
  margin-top: 18px;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}
.row__sq {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--c-done);
  flex-shrink: 0;
}
.row__title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 500;
}
.row__ver {
  width: 58px;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
}
.row__noone {
  width: 22px;
}
.row__tasks {
  font-size: 12.5px;
  color: var(--mute);
}
.row__tasks b {
  color: var(--ink);
}
.detail__more {
  padding: 12px 0 0;
  border: 0;
  background: none;
  font-size: 12.5px;
  color: var(--mute);
  cursor: pointer;
}
@media (max-width: 1100px) {
  .rel__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .rel__grid {
    padding: 0 16px;
  }
  .detail {
    padding: 18px;
  }
  .detail__head {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .detail__nums {
    margin: 0;
  }
}
</style>
