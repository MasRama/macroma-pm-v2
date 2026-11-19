<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
  accountHasPassword,
  AUTH_TOKENS_CHANGED_EVENT,
  authFieldTexts,
  authRefusalText,
  createSecurityClient,
  toApiTokenView,
  type ApiTokenScope,
  type ApiTokenView,
  type SecurityClient,
  useAuthSession,
} from '../../features/auth/web';
import { onServerEvent } from '../../shared/realtime/browser';
import { ConfirmDialog, formatAgoLong, PageHead, SegmentedControl, SelectField, ShellTopBar, TextField, TopCrumb, UiButton, UiIcon } from '../../shared/ui';

/**
 * Token API: personal access tokens for the public API. The secret of a new
 * token is shown once, right after it is made, and never again; the list
 * shows each token by name and prefix only. Creating one asks for the
 * current password; an account without one (made through Google) instead
 * must have signed in within the last few minutes, or is asked to sign in
 * again.
 */
type TokensClient = Pick<SecurityClient, 'listTokens' | 'createToken' | 'revokeToken' | 'revokeAllTokens'>;

const props = withDefaults(
  defineProps<{
    client?: TokensClient;
    /** Overrides what the session says (`hasPassword` from GET /api/auth/me). */
    hasPassword?: boolean;
    /** Ends the session and opens the sign-in page, back here afterwards. */
    signInAgain?: () => Promise<void>;
  }>(),
  // An explicit undefined default stops Vue casting a missing boolean prop to false.
  { client: undefined, hasPassword: undefined, signInAgain: undefined },
);
const client: TokensClient = props.client ?? createSecurityClient();
const authSession = useAuthSession();
/**
 * Set when the API asks for a password the session said the account lacks:
 * `hasPassword` from /me can be stale, e.g. a password just set in another tab.
 */
const passwordAsked = ref(false);
const hasPassword = computed(() => passwordAsked.value || (props.hasPassword ?? accountHasPassword(authSession.user.value)));

const EXPIRY_OPTIONS = [
  { value: '7', label: '7 hari' },
  { value: '30', label: '30 hari' },
  { value: '90', label: '90 hari' },
  { value: '365', label: '365 hari' },
  // Last on purpose: a token that never expires is a choice, never the default.
  { value: 'never', label: 'Tidak pernah' },
];
const SCOPE_OPTIONS = [
  { value: 'read', label: 'Baca' },
  { value: 'write', label: 'Baca + tulis' },
];
const SCOPE_LABEL: Record<ApiTokenScope, string> = { read: 'Baca', write: 'Baca + tulis' };
const SCOPE_HINT: Record<ApiTokenScope, string> = {
  read: 'Hanya melihat data: project, task, dan rilis.',
  write: 'Melihat sekaligus membuat dan mengubah data.',
};
const NAME_TEXT = 'Nama token wajib diisi, maksimal 80 karakter.';
const PASSWORD_REQUIRED_TEXT = 'Masukkan password kamu saat ini.';
const PASSWORD_WRONG_TEXT = 'Password salah.';
const NEVER_EXPIRES_WARNING = 'Token ini aktif terus sampai kamu mencabutnya. Pilih ini hanya kalau memang perlu.';

const tokens = ref<ApiTokenView[]>([]);
const loading = ref(true);
const loadError = ref('');

const name = ref('');
const password = ref('');
const expiry = ref('90');
const scope = ref<string>('read');
const createBusy = ref(false);
const createError = ref('');
const fieldErrors = ref<Record<string, string>>({});
/** 403 REAUTH_REQUIRED: the create error offers signing in again. */
const reauthNeeded = ref(false);
const signingIn = ref(false);

/** The new token's secret: only in this page's memory, gone once closed. */
const created = ref<{ name: string; secret: string } | null>(null);
const copied = ref(false);
const copyError = ref('');

const revoking = ref<ApiTokenView | null>(null);
const revokingAll = ref(false);
const revokeBusy = ref(false);
const listError = ref('');
const listNotice = ref('');

const scopeHint = computed(() => SCOPE_HINT[scope.value as ApiTokenScope]);

const dateFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
/** "19 Nov 2026": tokens live for up to a year, so the year is always shown. */
function longDay(iso: string): string {
  return dateFormat.format(new Date(iso)).replace(/\./g, '');
}

function expiryText(token: ApiTokenView): string {
  if (token.expiresAt === null) return 'Tidak pernah kedaluwarsa';
  return `${token.expired ? 'Kedaluwarsa' : 'Berlaku sampai'} ${longDay(token.expiresAt)}`;
}

function lastUsedText(token: ApiTokenView): string {
  if (token.lastUsedAt === null) return 'Belum pernah dipakai';
  return `Terakhir dipakai ${formatAgoLong(token.lastUsedAt).replace(/^(Baru|Kemarin)/, (word) => word.toLowerCase())}`;
}

async function load(): Promise<void> {
  try {
    const response = await client.listTokens();
    if (response.success) {
      tokens.value = response.data.tokens.map(toApiTokenView);
      loadError.value = '';
    } else {
      loadError.value = authRefusalText(response.code);
    }
  } catch (error) {
    console.error(error);
    loadError.value = 'Daftar token belum bisa dimuat.';
  } finally {
    loading.value = false;
  }
}

async function createToken(): Promise<void> {
  createError.value = '';
  fieldErrors.value = {};
  reauthNeeded.value = false;
  const trimmed = name.value.trim();
  const errors: Record<string, string> = {};
  if (!trimmed || trimmed.length > 80) errors.name = NAME_TEXT;
  if (hasPassword.value && !password.value) errors.password = PASSWORD_REQUIRED_TEXT;
  if (Object.keys(errors).length) {
    fieldErrors.value = errors;
    return;
  }

  createBusy.value = true;
  try {
    const response = await client.createToken({
      name: trimmed,
      scope: scope.value as ApiTokenScope,
      expiresInDays: expiry.value === 'never' ? null : Number(expiry.value),
      // Only an account with a password confirms with it; the API ignores the field otherwise.
      ...(hasPassword.value ? { password: password.value } : {}),
    });
    if (!response.success) {
      if (response.code === 'INVALID_PASSWORD') {
        fieldErrors.value = { password: PASSWORD_WRONG_TEXT };
        return;
      }
      if (response.code === 'REAUTH_REQUIRED') reauthNeeded.value = true;
      const texts = authFieldTexts(response.errors);
      fieldErrors.value = { ...texts, ...(texts.name ? { name: NAME_TEXT } : {}) };
      createError.value = authRefusalText(response.code);
      if (texts.password && !hasPassword.value) {
        passwordAsked.value = true;
        await nextTick();
        document.getElementById('token-password')?.focus();
      }
      return;
    }
    const token = toApiTokenView(response.data.token);
    tokens.value = [token, ...tokens.value.filter((existing) => existing.id !== token.id)];
    created.value = { name: token.name, secret: response.data.secret };
    copied.value = false;
    copyError.value = '';
    listNotice.value = '';
    name.value = '';
    password.value = '';
  } catch (error) {
    console.error(error);
    createError.value = 'Token belum bisa dibuat.';
  } finally {
    createBusy.value = false;
  }
}

async function copySecret(): Promise<void> {
  if (!created.value) return;
  copyError.value = '';
  try {
    await navigator.clipboard.writeText(created.value.secret);
    copied.value = true;
  } catch (error) {
    console.error(error);
    copyError.value = 'Belum bisa menyalin otomatis. Pilih tokennya lalu salin manual.';
  }
}

function closeSecret(): void {
  created.value = null;
  password.value = '';
  copied.value = false;
  copyError.value = '';
}

async function defaultSignInAgain(): Promise<void> {
  const response = await authSession.logout();
  if (!response.success) throw new Error(response.message);
  window.location.assign(`/login?redirect=${encodeURIComponent('/settings/tokens')}`);
}

async function signInAgain(): Promise<void> {
  if (signingIn.value) return;
  signingIn.value = true;
  try {
    await (props.signInAgain ?? defaultSignInAgain)();
  } catch (error) {
    console.error(error);
    createError.value = 'Belum bisa keluar. Coba lagi.';
    reauthNeeded.value = false;
  } finally {
    signingIn.value = false;
  }
}

async function revokeOne(): Promise<void> {
  const token = revoking.value;
  if (!token) return;
  revokeBusy.value = true;
  listError.value = '';
  listNotice.value = '';
  try {
    const response = await client.revokeToken(token.id);
    if (response.success) {
      tokens.value = tokens.value.filter((existing) => existing.id !== token.id);
      listNotice.value = `Token ${token.name} dicabut.`;
    } else if (response.code === 'NOT_FOUND') {
      listError.value = 'Token ini sudah dicabut atau tidak ada lagi.';
      await load();
    } else {
      listError.value = authRefusalText(response.code);
    }
  } catch (error) {
    console.error(error);
    listError.value = 'Token belum bisa dicabut.';
  } finally {
    revokeBusy.value = false;
    revoking.value = null;
  }
}

async function revokeAll(): Promise<void> {
  revokeBusy.value = true;
  listError.value = '';
  listNotice.value = '';
  try {
    const response = await client.revokeAllTokens();
    if (response.success) {
      tokens.value = [];
      listNotice.value = `${response.data.revoked} token dicabut.`;
    } else {
      listError.value = authRefusalText(response.code);
    }
  } catch (error) {
    console.error(error);
    listError.value = 'Token belum bisa dicabut.';
  } finally {
    revokeBusy.value = false;
    revokingAll.value = false;
  }
}

onMounted(() => void load());
onUnmounted(onServerEvent(AUTH_TOKENS_CHANGED_EVENT, () => void load()));
</script>

<template>
  <div class="tokens">
    <ShellTopBar><TopCrumb :trail="['Profil']" current="Token API" /></ShellTopBar>
    <PageHead class="tokens__head" title="Token API" description="Hubungkan script dan aplikasi lain ke Macroma lewat API publik.">
      <template v-if="tokens.length" #actions>
        <UiButton variant="ghost" data-testid="revoke-all" @click="revokingAll = true">Cabut semua</UiButton>
      </template>
    </PageHead>

    <div class="tokens__body">
      <section v-if="created" class="secret" role="region" aria-label="Token baru" data-testid="new-secret">
        <div class="secret__head">
          <span class="secret__icon"><UiIcon name="key" :size="18" :stroke="2.2" /></span>
          <div>
            <b class="secret__title">Token {{ created.name }} siap dipakai</b>
            <p class="secret__note">Simpan sekarang. Setelah ditutup, token ini tidak bisa dilihat lagi.</p>
          </div>
        </div>
        <div class="secret__row">
          <code class="secret__value mono" data-testid="secret-value">{{ created.secret }}</code>
          <button type="button" class="secret__copy focus-ring" data-testid="copy-secret" @click="copySecret">
            {{ copied ? 'Tersalin' : 'Salin' }}
          </button>
        </div>
        <p v-if="copyError" role="alert" class="secret__err">{{ copyError }}</p>
        <div class="secret__foot">
          <button type="button" class="secret__close focus-ring" data-testid="close-secret" @click="closeSecret">Sudah disimpan, tutup</button>
        </div>
      </section>

      <div class="tokens__grid">
        <section class="panel tokens__card" aria-labelledby="tokens-new">
          <h2 id="tokens-new" class="h2 tokens__h">Buat token</h2>
          <form class="tokens__form" data-testid="token-form" novalidate @submit.prevent="createToken">
            <p v-if="createError" role="alert" class="tokens__err tokens__err--reauth" data-testid="create-error">
              <span>{{ createError }}</span>
              <button v-if="reauthNeeded" type="button" class="link tokens__reauth" data-testid="sign-in-again" :disabled="signingIn" @click="signInAgain">
                Masuk ulang
              </button>
            </p>
            <TextField
              id="token-name"
              v-model="name"
              label="Nama token"
              placeholder="mis. Script deploy"
              autocomplete="off"
              :error="fieldErrors.name"
            />
            <div>
              <SelectField id="token-expiry" v-model="expiry" label="Masa berlaku" :options="EXPIRY_OPTIONS" :error="fieldErrors.expiresInDays" />
              <p v-if="expiry === 'never' && !fieldErrors.expiresInDays" class="tokens__warn" data-testid="never-expires-warning">
                {{ NEVER_EXPIRES_WARNING }}
              </p>
            </div>
            <div>
              <span class="tokens__label">Akses</span>
              <SegmentedControl v-model="scope" :options="SCOPE_OPTIONS" label="Akses" variant="field" />
              <p v-if="fieldErrors.scope" class="tokens__err">{{ fieldErrors.scope }}</p>
              <p v-else class="tokens__hint">{{ scopeHint }}</p>
            </div>
            <TextField
              v-if="hasPassword"
              id="token-password"
              v-model="password"
              type="password"
              label="Password saat ini"
              autocomplete="current-password"
              hint="Konfirmasi bahwa ini memang kamu."
              :error="fieldErrors.password"
            />
            <div class="tokens__foot">
              <UiButton variant="primary" type="submit" :disabled="createBusy">{{ createBusy ? 'Membuat…' : 'Buat token' }}</UiButton>
            </div>
          </form>
        </section>

        <section class="panel tokens__card" aria-labelledby="tokens-list">
          <div class="tokens__list-head">
            <h2 id="tokens-list" class="h2 tokens__h">Token kamu</h2>
            <span v-if="tokens.length" class="tokens__count mono" data-testid="token-count">{{ tokens.length }}</span>
          </div>
          <p class="tokens__note" data-testid="password-note">Ganti atau reset password akan mencabut semua token.</p>
          <p v-if="listError" role="alert" class="tokens__err">{{ listError }}</p>
          <p v-if="listNotice" role="status" class="tokens__ok">{{ listNotice }}</p>
          <p v-if="loadError" role="alert" class="tokens__err" data-testid="load-error">{{ loadError }}</p>
          <p v-else-if="loading" class="tokens__muted">Memuat token…</p>
          <div v-else-if="tokens.length === 0" class="empty" data-testid="tokens-empty">
            <span class="empty__icon"><UiIcon name="key" :size="20" :stroke="2" /></span>
            <b>Belum ada token</b>
            <p>Buat token untuk menghubungkan script atau aplikasi lain ke Macroma.</p>
          </div>
          <ul v-else class="list">
            <li
              v-for="token in tokens"
              :key="token.id"
              class="row"
              :class="{ 'row--expired': token.expired }"
              :data-token-id="token.id"
              data-testid="token-row"
            >
              <div class="row__main">
                <div class="row__title">
                  <b class="row__name">{{ token.name }}</b>
                  <span class="tag" :class="`tag--${token.scope}`">{{ SCOPE_LABEL[token.scope] }}</span>
                  <span v-if="token.expired" class="tag tag--expired">Kedaluwarsa</span>
                </div>
                <div class="row__meta">
                  <code class="row__prefix mono">{{ token.prefix }}…</code>
                  <span>Dibuat {{ longDay(token.createdAt) }}</span>
                  <span :class="{ 'row__dead': token.expired }">{{ expiryText(token) }}</span>
                  <span>{{ lastUsedText(token) }}</span>
                </div>
              </div>
              <UiButton size="sm" variant="ghost" :data-testid="`revoke-${token.id}`" @click="revoking = token">Cabut</UiButton>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <ConfirmDialog
      :open="revoking !== null"
      :title="`Cabut token ${revoking?.name ?? ''}?`"
      message="Script atau aplikasi yang memakai token ini langsung kehilangan akses. Ini tidak bisa dibatalkan."
      confirm-label="Cabut token"
      :busy="revokeBusy"
      @confirm="revokeOne"
      @cancel="revoking = null"
    />
    <ConfirmDialog
      :open="revokingAll"
      title="Cabut semua token?"
      :message="`Semua ${tokens.length} token langsung berhenti bekerja, termasuk yang dipakai script yang sedang jalan. Ini tidak bisa dibatalkan.`"
      confirm-label="Cabut semua"
      :busy="revokeBusy"
      @confirm="revokeAll"
      @cancel="revokingAll = false"
    />
  </div>
</template>

<style scoped>
.tokens {
  padding-bottom: 28px;
}
/* Head and content share the 08-profile 1100px column, so Cabut semua lines up with the cards. */
.tokens__head {
  max-width: 1100px;
}
.tokens__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1100px;
  padding: 0 28px;
}
.tokens__grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  align-items: start;
  gap: 18px;
}
.tokens__card {
  padding: 22px;
}
.tokens__h {
  margin: 0;
  font-size: 16px;
}
.tokens__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 14px;
}
.tokens__label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
}
.tokens__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--mute);
}
.tokens__warn {
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-revisi);
}
.tokens__note {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--mute);
}
/* Flex, not inline text: the link sits after the message, or wraps to its own line unindented. */
.tokens__err--reauth {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 6px;
  row-gap: 2px;
}
.tokens__reauth {
  font-size: 12.5px;
}
.tokens__foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
.tokens__err {
  margin: 6px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-revisi);
}
.tokens__ok {
  margin: 10px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-done);
}
.tokens__muted {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--mute);
}
.tokens__list-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tokens__count {
  min-width: 22px;
  padding: 1px 6px;
  border-radius: var(--r-block);
  background: var(--primary-bg);
  color: var(--primary-fg);
  font-size: 11.5px;
  font-weight: 700;
  text-align: center;
}

/* The one-time secret: a solid ink block, the loudest thing on the page. */
.secret {
  padding: 20px 22px;
  border: 1px solid var(--block-line);
  border-radius: var(--r-panel);
  background: var(--block);
  color: var(--block-fg);
}
.secret__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.secret__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--r-small);
  background: var(--c-revisi);
  color: #fff;
}
.secret__title {
  display: block;
  font-size: 16px;
  overflow-wrap: anywhere;
}
.secret__note {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--block-soft);
}
.secret__row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-top: 16px;
}
.secret__value {
  flex: 1;
  min-width: 0;
  padding: 11px 13px;
  border: 1px solid var(--block-raise-line);
  border-radius: var(--r-control);
  background: var(--block-raise);
  font-size: 13.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
  user-select: all;
}
.secret__copy,
.secret__close {
  border-radius: var(--r-control);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.secret__copy {
  min-width: 84px;
  padding: 0 16px;
  border: 0;
  background: var(--block-fg);
  color: var(--block);
}
.secret__err {
  margin: 8px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-revisi);
}
.secret__foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
.secret__close {
  padding: 8px 14px;
  border: 1.5px solid var(--block-raise-line);
  background: transparent;
  color: var(--block-fg);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 34px 16px 22px;
  text-align: center;
}
.empty__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  margin-bottom: 6px;
  border-radius: var(--r-card);
  background: var(--primary-bg);
  color: var(--primary-fg);
}
.empty b {
  font-size: 14px;
}
.empty p {
  max-width: 300px;
  margin: 0;
  font-size: 13px;
  color: var(--mute);
}

.list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 0;
  border-top: 1px solid var(--line);
}
.row:first-child {
  border-top: 0;
}
.row__main {
  flex: 1;
  min-width: 0;
}
.row__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.row__name {
  font-size: 13.5px;
  overflow-wrap: anywhere;
}
.row--expired .row__name {
  color: var(--mute);
}
.row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--mute);
}
.row__prefix {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-block);
  background: var(--fill);
  color: var(--ink2);
  font-size: 11.5px;
  font-weight: 600;
}
.row__dead {
  font-weight: 600;
  color: var(--c-revisi);
}
.tag {
  padding: 2px 6px;
  border-radius: var(--r-block);
  font-size: 11px;
  font-weight: 700;
  color: var(--on-status);
  white-space: nowrap;
}
.tag--read {
  background: var(--c-backlog);
}
.tag--write {
  background: var(--c-ongoing);
}
.tag--expired {
  background: var(--c-revisi);
}

@media (max-width: 900px) {
  .tokens__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .tokens__body {
    padding: 0 16px;
  }
  .secret {
    padding: 16px;
  }
  .secret__row {
    flex-direction: column;
  }
  .secret__copy {
    padding: 10px 16px;
  }
  .row {
    align-items: flex-start;
  }
}
</style>
