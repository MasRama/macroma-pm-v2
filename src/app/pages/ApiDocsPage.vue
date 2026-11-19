<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { PageHead, ShellTopBar, TopCrumb, UiButton } from '../../shared/ui';
import ApiCode from './api-docs/ApiCode.vue';
import ApiFields from './api-docs/ApiFields.vue';
import ApiText from './api-docs/ApiText.vue';
import { baseUrlOf, curlFor, readApiDocs, type ApiDocs, type DocParam } from './api-docs/openapi-docs';
import { scrollerOf, sectionAt } from './api-docs/scroll-spy';

/**
 * Dokumentasi API: the public API drawn from its own OpenAPI document, so
 * every endpoint the server declares shows up here without a page change.
 */
const SPEC_PATH = '/api/v1/openapi.json';
const SCOPES = [
  { scope: 'read', text: 'Hanya membaca: endpoint GET.' },
  { scope: 'write', text: 'Membaca dan mengubah: semua endpoint, termasuk POST, PATCH, dan DELETE.' },
] as const;
const PARAM_PLACE = { path: 'path', query: 'query' } as const;
/** Where a section counts as reached: below the sticky top bar and the anchors' 72px scroll margin. */
const SPY_LINE = 96;

const docs = ref<ApiDocs | null>(null);
const failed = ref(false);
const loading = ref(true);
const activeId = ref('api-intro');

const baseUrl = computed(() => (docs.value ? baseUrlOf(docs.value, window.location.origin) : ''));
/** The base URL's path, shown muted in front of each endpoint path. */
const basePath = computed(() => (baseUrl.value ? new URL(baseUrl.value).pathname.replace(/\/$/, '') : ''));
const rateWindow = computed(() => {
  const seconds = docs.value?.rateLimit?.windowSeconds;
  if (seconds === 60) return 'per menit';
  if (seconds === 3600) return 'per jam';
  return seconds ? `per ${seconds} detik` : '';
});
const errorJson = computed(() => (docs.value?.errorExample ? JSON.stringify(docs.value.errorExample, null, 2) : ''));
const pageNote = computed(() => {
  const pagination = docs.value?.pagination;
  if (!pagination) return '';
  const { limitMin, limitMax, limitDefault } = pagination;
  const range = limitMin !== undefined && limitMax !== undefined ? ` ${limitMin}–${limitMax}` : '';
  const fallback = limitDefault !== undefined ? `, bawaan ${limitDefault}` : '';
  return `${range}${fallback}`;
});

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const response = await fetch(SPEC_PATH, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    docs.value = readApiDocs(await response.json());
  } catch {
    docs.value = null;
    failed.value = true;
  } finally {
    loading.value = false;
  }
  await nextTick();
  watchScroll();
}

function paramNote(param: DocParam): string {
  return [param.limits, param.fallback !== undefined ? `bawaan ${param.fallback}` : ''].filter(Boolean).join(' · ');
}

// Scroll-spy: the nav and the jump select mark the section in view. A jump
// pins its section until the reader scrolls by hand, so a card near the bottom
// stays selected though it cannot reach the top of the view.
let scroller: HTMLElement | null = null;
let pinned: string | null = null;
const HAND_SCROLL = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

function sectionIds(): string[] {
  return docs.value ? ['api-intro', ...docs.value.groups.flatMap((group) => group.operations.map((operation) => operation.id))] : [];
}

/** Scrolls the shell to a section; the URL keeps no hash, so the router never re-navigates. */
function jump(id: string): void {
  activeId.value = id;
  pinned = id;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function spy(): void {
  if (pinned || !scroller) return;
  const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  const sections = sectionIds().flatMap((id) => {
    const element = document.getElementById(id);
    return element ? [{ id, top: element.getBoundingClientRect().top - top }] : [];
  });
  const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  const current = sectionAt(sections, SPY_LINE, atBottom);
  if (current) activeId.value = current;
}

function release(): void {
  pinned = null;
}

/** The page's own scrolling element fires its scroll events on the window. */
function scrollEventsOf(element: HTMLElement): EventTarget {
  return element === document.scrollingElement ? window : element;
}

function unwatchScroll(): void {
  if (scroller) scrollEventsOf(scroller).removeEventListener('scroll', spy);
  for (const type of HAND_SCROLL) scroller?.removeEventListener(type, release);
  scroller = null;
}

function watchScroll(): void {
  unwatchScroll();
  const intro = document.getElementById('api-intro');
  if (!intro) return;
  scroller = scrollerOf(intro);
  scrollEventsOf(scroller).addEventListener('scroll', spy, { passive: true });
  for (const type of HAND_SCROLL) scroller.addEventListener(type, release, { passive: true });
  spy();
}

onMounted(() => void load());
onUnmounted(unwatchScroll);
</script>

<template>
  <div class="docs">
    <ShellTopBar><TopCrumb :trail="['Profil']" current="Dokumentasi API" /></ShellTopBar>
    <PageHead title="Dokumentasi API" description="Endpoint, parameter, dan contoh permintaan API publik Macroma." />

    <section v-if="loading" class="panel docs__state" role="status" data-testid="api-docs-loading">
      <span class="docs__spinner" aria-hidden="true" />
      Memuat dokumentasi API…
    </section>

    <section v-else-if="failed || !docs" class="panel docs__state docs__state--error" role="alert" data-testid="api-docs-error">
      <div>
        <b>Dokumentasi API gagal dimuat.</b>
        <p>Periksa koneksi kamu, lalu coba lagi.</p>
      </div>
      <UiButton variant="primary" data-testid="api-docs-retry" @click="load">Coba lagi</UiButton>
    </section>

    <div v-else class="docs__body">
      <nav class="docs__nav" aria-label="Isi dokumentasi" data-testid="api-docs-nav">
        <a href="#api-intro" class="docs__link" :class="{ 'docs__link--on': activeId === 'api-intro' }" :aria-current="activeId === 'api-intro' ? 'true' : undefined" @click.prevent="jump('api-intro')">
          Mulai
        </a>
        <template v-for="group in docs.groups" :key="group.id">
          <p class="docs__navtag">{{ group.tag }}</p>
          <a
            v-for="operation in group.operations"
            :key="operation.id"
            :href="`#${operation.id}`"
            class="docs__link"
            :class="{ 'docs__link--on': activeId === operation.id }"
            :aria-current="activeId === operation.id ? 'true' : undefined"
            @click.prevent="jump(operation.id)"
          >
            <span class="method method--sm" :class="`method--${operation.method.toLowerCase()}`">{{ operation.method }}</span>
            <span class="docs__linktext">{{ operation.summary }}</span>
          </a>
        </template>
      </nav>

      <div class="docs__jump">
        <label for="api-docs-jump" class="cap">Lompat ke</label>
        <div class="docs__select">
          <select id="api-docs-jump" class="docs__selectctl focus-ring" :value="activeId" data-testid="api-docs-jump" @change="jump(($event.target as HTMLSelectElement).value)">
            <option value="api-intro">Mulai</option>
            <optgroup v-for="group in docs.groups" :key="group.id" :label="group.tag">
              <option v-for="operation in group.operations" :key="operation.id" :value="operation.id">
                {{ operation.method }} {{ operation.path }}
              </option>
            </optgroup>
          </select>
        </div>
      </div>

      <div class="docs__main">
        <section id="api-intro" class="panel docs__card docs__anchor" aria-labelledby="api-intro-title" data-testid="api-docs-intro">
          <h2 id="api-intro-title" class="h2">Mulai</h2>
          <p v-if="docs.description" class="docs__lead"><ApiText :text="docs.description" /></p>

          <div class="docs__fact">
            <h3 class="docs__h3">Base URL</h3>
            <ApiCode :code="baseUrl" label="Base URL" inline data-testid="api-docs-base" />
          </div>

          <div v-if="docs.bearer" class="docs__fact">
            <h3 class="docs__h3">Autentikasi</h3>
            <p class="docs__text">
              Kirim token akses pribadi di setiap permintaan. Token dibuat di halaman
              <RouterLink :to="{ name: 'api-tokens' }" class="link" data-testid="api-docs-tokens">Token API</RouterLink>.
            </p>
            <ApiCode code="Authorization: Bearer mcr_..." label="Header" inline />
          </div>

          <div class="docs__fact">
            <h3 class="docs__h3">Scope token</h3>
            <ul class="docs__scopes">
              <li v-for="item in SCOPES" :key="item.scope">
                <span class="scope" :class="`scope--${item.scope}`">{{ item.scope }}</span>
                <span>{{ item.text }}</span>
              </li>
            </ul>
          </div>

          <div v-if="docs.pagination" class="docs__fact" data-testid="api-docs-pagination">
            <h3 class="docs__h3">Halaman</h3>
            <p class="docs__text">
              Daftar menerima <code class="docs__code">limit</code>{{ pageNote ? ` (${pageNote.trim()})` : '' }} dan
              <code class="docs__code">cursor</code>. Jawabannya membawa <code class="docs__code">next_cursor</code>: kosong
              (<code class="docs__code">null</code>) di halaman terakhir, selain itu kirim balik sebagai
              <code class="docs__code">cursor</code> untuk halaman berikutnya.
            </p>
          </div>

          <div v-if="docs.rateLimit" class="docs__fact" data-testid="api-docs-rate">
            <h3 class="docs__h3">Batas permintaan</h3>
            <p class="docs__text">
              Setiap token boleh mengirim {{ docs.rateLimit.requests }} permintaan {{ rateWindow }}. Lebih dari itu dijawab
              <code class="docs__code">429{{ docs.rateLimit.code ? ` ${docs.rateLimit.code}` : '' }}</code>;
              tunggu sebanyak detik di header <code class="docs__code">Retry-After</code>, lalu coba lagi.
            </p>
          </div>

          <div v-if="errorJson" class="docs__fact" data-testid="api-docs-errors">
            <h3 class="docs__h3">Format error</h3>
            <p class="docs__text">
              Permintaan yang ditolak menjawab dengan <code class="docs__code">success: false</code>. Cek
              <code class="docs__code">code</code>, bukan teks <code class="docs__code">message</code>;
              <code class="docs__code">errors</code> berisi pesan per field saat validasi gagal.
            </p>
            <ApiCode :code="errorJson" label="JSON" />
          </div>

          <p class="docs__text docs__spec">
            Spesifikasi OpenAPI 3.1: <a class="link mono" :href="SPEC_PATH" target="_blank" rel="noopener">{{ SPEC_PATH }}</a>
          </p>
        </section>

        <section v-for="group in docs.groups" :key="group.id" class="docs__group" :aria-labelledby="`${group.id}-title`" data-testid="api-docs-group">
          <h2 :id="`${group.id}-title`" class="docs__tag">{{ group.tag }}</h2>
          <p v-if="group.description" class="docs__text"><ApiText :text="group.description" /></p>

          <article
            v-for="operation in group.operations"
            :id="operation.id"
            :key="operation.id"
            class="panel docs__card docs__anchor docs__op"
            :aria-labelledby="`${operation.id}-title`"
            data-testid="api-docs-operation"
          >
            <div class="docs__endpoint">
              <span class="method" :class="`method--${operation.method.toLowerCase()}`">{{ operation.method }}</span>
              <code class="docs__path" data-testid="api-docs-path"><span class="docs__base">{{ basePath }}</span>{{ operation.path }}</code>
            </div>
            <h3 :id="`${operation.id}-title`" class="docs__summary">{{ operation.summary }}</h3>
            <p v-if="operation.description" class="docs__text"><ApiText :text="operation.description" /></p>
            <p class="docs__needs">
              Butuh scope <span class="scope" :class="`scope--${operation.scope}`" data-testid="api-docs-scope">{{ operation.scope }}</span>
            </p>

            <div v-if="operation.params.length" class="docs__block">
              <h4 class="docs__h4">Parameter</h4>
              <table class="docs__table" data-testid="api-docs-params">
                <thead>
                  <tr>
                    <th scope="col">Nama</th>
                    <th scope="col">Letak</th>
                    <th scope="col">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="param in operation.params" :key="`${param.in}-${param.name}`">
                    <td>
                      <code class="docs__name">{{ param.name }}</code>
                      <span class="docs__type mono">{{ param.type }}</span>
                    </td>
                    <td><span class="docs__place">{{ PARAM_PLACE[param.in] }}</span></td>
                    <td>
                      <span class="docs__need" :class="{ 'docs__need--on': param.required }">{{ param.required ? 'wajib' : 'opsional' }}</span>
                      <span v-if="paramNote(param)" class="docs__meta">{{ paramNote(param) }}</span>
                      <span v-if="param.description" class="docs__desc"><ApiText :text="param.description" /></span>
                      <span v-if="param.values" class="docs__values">
                        <code v-for="value in param.values" :key="value" class="docs__code">{{ value }}</code>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="operation.body" class="docs__block">
              <h4 class="docs__h4">Body JSON</h4>
              <ApiFields :fields="operation.body" marks-required data-testid="api-docs-body" />
            </div>

            <details class="docs__more" data-testid="api-docs-response">
              <summary class="docs__h4 focus-ring">
                Respons <span class="mono docs__status">{{ operation.status }}</span>
                <span class="docs__count">{{ operation.response.length ? `${operation.response.length} field di data` : 'tanpa data' }}</span>
              </summary>
              <ApiFields v-if="operation.response.length" :fields="operation.response" root="data" />
              <p v-else class="docs__text">Jawaban hanya berisi <code class="docs__code">success</code> dan <code class="docs__code">message</code>.</p>
              <h4 v-if="operation.refusals.length" class="docs__h4 docs__h4--gap">Bisa ditolak</h4>
              <ul v-if="operation.refusals.length" class="docs__refusals">
                <li v-for="refusal in operation.refusals" :key="refusal.status">
                  <span class="mono docs__status">{{ refusal.status }}</span>
                  <span class="docs__values">
                    <code v-for="code in refusal.codes" :key="code" class="docs__code">{{ code }}</code>
                  </span>
                </li>
              </ul>
            </details>

            <ApiCode :code="curlFor(operation, baseUrl)" label="curl" data-testid="api-docs-curl" />
          </article>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docs {
  padding-bottom: 40px;
}
.docs__state {
  display: flex;
  align-items: center;
  gap: 14px;
  /* The body column is 1100px with 28px gutters; the state card fills the same width. */
  max-width: 1044px;
  margin: 0 28px;
  padding: 22px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink2);
}
.docs__state--error {
  justify-content: space-between;
  flex-wrap: wrap;
  border: 1.5px solid var(--c-revisi);
}
.docs__state--error b {
  font-size: 15px;
  color: var(--ink);
}
.docs__state--error p {
  margin: 4px 0 0;
  font-weight: 500;
  color: var(--mute);
}
.docs__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--line);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: docs-spin 0.8s linear infinite;
}
@keyframes docs-spin {
  to {
    transform: rotate(360deg);
  }
}
.docs__body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
  max-width: 1100px;
  padding: 0 28px;
}
.docs__nav {
  position: sticky;
  top: 72px;
  max-height: calc(100dvh - 96px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 12px;
}
.docs__navtag {
  margin: 14px 0 4px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mute);
}
.docs__link {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 10px;
  border-radius: var(--r-small);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink2);
  text-decoration: none;
}
.docs__link:hover {
  background: var(--card);
  color: var(--ink);
}
.docs__link--on,
.docs__link--on:hover {
  background: var(--primary-bg);
  color: var(--primary-fg);
  font-weight: 600;
}
.docs__link:focus-visible {
  outline: 2px solid var(--c-ongoing);
  outline-offset: 1px;
}
.docs__linktext {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.docs__jump {
  display: none;
}
.docs__select {
  position: relative;
}
.docs__select::after {
  content: '';
  position: absolute;
  right: 14px;
  top: 50%;
  margin-top: -2px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--ink);
  pointer-events: none;
}
.docs__selectctl {
  width: 100%;
  height: 42px;
  padding: 0 34px 0 12px;
  border: 1.5px solid var(--ink);
  border-radius: var(--r-control);
  background: var(--card);
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
  appearance: none;
}
.docs__main {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}
.docs__card {
  padding: 22px;
  min-width: 0;
}
.docs__anchor {
  scroll-margin-top: 72px;
}
.docs__lead {
  margin: 8px 0 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink2);
}
.docs__fact {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--line-soft);
}
.docs__h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
}
.docs__h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mute);
}
.docs__h4--gap {
  margin-top: 16px;
}
.docs__text {
  margin: 0 0 10px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink2);
}
.docs__spec {
  margin: 20px 0 0;
  font-size: 12.5px;
  overflow-wrap: anywhere;
}
.docs__code {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--ink);
  /* A chip such as `429 RATE_LIMITED` stays on one line; the text breaks between chips. */
  white-space: nowrap;
}
.docs__scopes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13.5px;
  color: var(--ink2);
}
.docs__scopes li {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.docs__scopes .scope {
  flex-shrink: 0;
  width: 46px;
  text-align: center;
}
.docs__group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.docs__tag {
  margin: 12px 0 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.docs__endpoint {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.docs__path {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.docs__base {
  color: var(--mute);
  font-weight: 500;
}
.docs__summary {
  margin: 12px 0 6px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.docs__needs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mute);
}
.docs__block {
  margin-bottom: 16px;
}
.docs__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.docs__table th {
  padding: 0 10px 6px 0;
  border-bottom: 1px solid var(--line);
  text-align: left;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mute);
}
.docs__table td {
  padding: 9px 10px 9px 0;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: top;
}
.docs__table td:first-child {
  width: 34%;
}
.docs__table td:nth-child(2) {
  width: 12%;
}
.docs__name {
  font-family: var(--font-mono);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.docs__type {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--mute);
  overflow-wrap: anywhere;
}
.docs__place {
  font-size: 12px;
  color: var(--ink2);
}
.docs__need {
  margin-right: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
}
.docs__need--on {
  color: var(--c-revisi);
}
.docs__meta {
  font-size: 12px;
  color: var(--mute);
}
.docs__desc {
  display: block;
  margin-top: 3px;
  line-height: 1.5;
  color: var(--ink2);
}
.docs__values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.docs__more {
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-card);
}
.docs__more summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  cursor: pointer;
  list-style: none;
}
.docs__more summary::-webkit-details-marker {
  display: none;
}
.docs__more summary::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 5px solid var(--ink);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.12s ease;
}
.docs__more[open] summary {
  margin-bottom: 12px;
}
.docs__more[open] summary::before {
  transform: rotate(90deg);
}
.docs__status {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0;
}
.docs__count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}
.docs__refusals {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.docs__refusals li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.docs__refusals .docs__values {
  margin-top: 0;
}
/* Method badges: solid blocks in the status colours, white text. */
.method {
  flex-shrink: 0;
  display: inline-block;
  min-width: 54px;
  padding: 4px 7px;
  border-radius: var(--r-block);
  background: var(--c-backlog);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 700;
  text-align: center;
}
.method--sm {
  min-width: 46px;
  padding: 2px 5px;
  font-size: 10px;
}
.method--get {
  background: var(--c-ongoing);
}
.method--post {
  background: var(--c-done);
}
.method--put,
.method--patch {
  background: var(--c-review);
}
.method--delete {
  background: var(--c-revisi);
}
.scope {
  display: inline-block;
  padding: 2px 7px;
  border: 1.5px solid var(--ink);
  border-radius: var(--r-block);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink);
}
.scope--write {
  background: var(--ink);
  color: var(--card);
}
@media (max-width: 760px) {
  .docs__body {
    grid-template-columns: minmax(0, 1fr);
    padding: 0 16px;
  }
  .docs__state {
    margin: 0 16px;
  }
  .docs__nav {
    display: none;
  }
  .docs__jump {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .docs__card {
    padding: 16px;
  }
  .docs__table thead {
    display: none;
  }
  .docs__table,
  .docs__table tbody,
  .docs__table tr,
  .docs__table td {
    display: block;
    width: auto !important;
  }
  /* One row per parameter: name and type on top, then where it goes, whether it is needed, and limits. */
  .docs__table tr {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .docs__table td {
    padding: 0;
    border: 0;
  }
  .docs__table td:first-child {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 3px;
  }
  .docs__table td:first-child .docs__type {
    display: inline;
    margin: 0;
  }
  .docs__table td:nth-child(2) {
    flex-shrink: 0;
  }
  .docs__table td:nth-child(3) {
    flex: 1;
    min-width: 0;
  }
  .docs__count {
    display: none;
  }
}
</style>
