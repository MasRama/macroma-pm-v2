<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_FILE_SIZE_BYTES,
  AVATAR_MAX_FILE_SIZE_MB,
  createUsersClient,
  STALE_REVISION,
  USERS_CHANGED_EVENT,
  type UpdateProfileResponse,
  type UserProfile,
} from '../../features/users/web';
import { mergeEdit, onServerEvent, sameValue } from '../../shared/realtime/browser';
import { PageHead, ShellTopBar, TextField, TopCrumb, UiAvatar, UiButton } from '../../shared/ui';
import { usersWebHost } from '../bindings/users.web';
import { useTheme, type ThemeMode } from '../theme';

/** Profil: photo, name and email, password change, and the per-browser theme. */
const usersClient = createUsersClient({ csrf: usersWebHost.csrf });
const router = useRouter();
const theme = useTheme();

const profile = ref<UserProfile | null>(null);
const name = ref('');
const email = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const loadError = ref('');
const profileBusy = ref(false);
const profileError = ref('');
const profileNotice = ref('');
const profileErrors = ref<Record<string, string>>({});
const passwordBusy = ref(false);
const passwordError = ref('');
const passwordNotice = ref('');
const passwordErrors = ref<Record<string, string>>({});
const avatarBusy = ref(false);
const avatarMessage = ref('');

type Fields = { name: string; email: string };
const FIELD_LABEL: Record<keyof Fields, string> = { name: 'Nama', email: 'Email' };
const conflicts = ref<Array<keyof Fields>>([]);

const person = computed(() => {
  const user = profile.value ?? usersWebHost.currentSessionUser();
  return user ? { id: user.id, name: user.name, avatar: user.avatar } : { id: 'me', name: '?' };
});

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Terang' },
  { value: 'dark', label: 'Gelap' },
  { value: 'system', label: 'Ikut sistem' },
];

function first(errors: Record<string, string[]> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(errors ?? {})) if (messages[0]) result[key] = messages[0];
  return result;
}

function fields(user: UserProfile): Fields {
  return { name: user.name, email: user.email };
}

function adopt(user: UserProfile): void {
  profile.value = user;
  name.value = user.name;
  email.value = user.email;
  usersWebHost.syncSessionUser({ id: user.id, name: user.name, email: user.email, avatar: user.avatar });
}

/** Folds a newer saved profile into the form: untouched fields follow it, fields both sides changed wait for a choice. */
function followSaved(user: UserProfile): void {
  if (!profile.value) return adopt(user);
  const theirs = fields(user);
  const result = mergeEdit(fields(profile.value), { name: name.value, email: email.value }, theirs);
  name.value = result.merged.name;
  email.value = result.merged.email;
  const open = new Set([...conflicts.value, ...result.conflicts]);
  conflicts.value = [...open].filter((field) => !sameValue(result.merged[field], theirs[field]));
  profile.value = user;
  usersWebHost.syncSessionUser({ id: user.id, name: user.name, email: user.email, avatar: user.avatar });
  if (result.adopted.length) {
    profileNotice.value = `Ikut perubahan dari tempat lain: ${result.adopted.map((field) => FIELD_LABEL[field]).join(', ')}.`;
  }
}

function resolve(field: keyof Fields, keep: 'mine' | 'theirs'): void {
  if (keep === 'theirs' && profile.value) {
    if (field === 'name') name.value = profile.value.name;
    else email.value = profile.value.email;
  }
  conflicts.value = conflicts.value.filter((open) => open !== field);
}

function isStale(response: UpdateProfileResponse): response is Extract<UpdateProfileResponse, { current: UserProfile }> {
  return !response.success && response.code === STALE_REVISION && 'current' in response;
}

async function load(): Promise<void> {
  loadError.value = '';
  try {
    const response = await usersClient.me();
    if (response.success) return adopt(response.data.user);
    if (response.code === 'UNAUTHORIZED' && !(await usersWebHost.refreshSession().catch(() => false))) {
      await router.replace({ name: 'login', query: { redirect: '/profile' } });
      return;
    }
    loadError.value = response.message;
  } catch (error) {
    console.error(error);
    loadError.value = 'Profil belum bisa dimuat.';
  }
}

async function followChanges(): Promise<void> {
  try {
    const response = await usersClient.me();
    if (!response.success || !profile.value || profileBusy.value) return;
    if (response.data.user.revision > profile.value.revision) followSaved(response.data.user);
  } catch (error) {
    console.error(error);
  }
}

async function saveProfile(): Promise<void> {
  profileError.value = '';
  profileNotice.value = '';
  profileErrors.value = {};
  if (conflicts.value.length) {
    profileError.value = 'Pilih versi yang mau disimpan untuk tiap field yang berubah di tempat lain.';
    return;
  }
  if (!name.value.trim()) profileErrors.value.name = 'Nama wajib diisi';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) profileErrors.value.email = 'Masukkan email yang valid';
  if (Object.keys(profileErrors.value).length) return;

  profileBusy.value = true;
  try {
    const response = await usersClient.updateProfile({
      revision: profile.value?.revision ?? 0,
      name: name.value.trim(),
      email: email.value.trim(),
    });
    if (response.success) {
      adopt(response.data.user);
      profileNotice.value = 'Data diri disimpan.';
    } else if (isStale(response)) {
      followSaved(response.current);
      profileError.value = conflicts.value.length
        ? 'Profil kamu diubah di tempat lain. Pilih versi yang mau disimpan.'
        : 'Profil kamu diubah di tempat lain. Perubahannya sudah digabung, cek lalu simpan lagi.';
    } else {
      profileErrors.value = first(response.errors);
      profileError.value = response.message;
    }
  } catch (error) {
    console.error(error);
    profileError.value = 'Data diri belum bisa disimpan.';
  } finally {
    profileBusy.value = false;
  }
}

async function changePassword(): Promise<void> {
  passwordError.value = '';
  passwordNotice.value = '';
  passwordErrors.value = {};
  if (!currentPassword.value) passwordErrors.value.currentPassword = 'Password sekarang wajib diisi';
  if (newPassword.value.length < 8) passwordErrors.value.newPassword = 'Password minimal 8 karakter';
  if (Object.keys(passwordErrors.value).length) return;

  passwordBusy.value = true;
  try {
    const response = await usersWebHost.changePassword({ currentPassword: currentPassword.value, newPassword: newPassword.value });
    if (!response.success) {
      passwordErrors.value = first(response.errors);
      passwordError.value = response.message;
      return;
    }
    currentPassword.value = '';
    newPassword.value = '';
    passwordNotice.value = 'Password diganti.';
  } catch (error) {
    console.error(error);
    passwordError.value = 'Password belum bisa diganti.';
  } finally {
    passwordBusy.value = false;
  }
}

async function uploadAvatar(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  avatarMessage.value = '';
  if (!AVATAR_ALLOWED_MIME_TYPES.some((type) => type === file.type)) {
    avatarMessage.value = 'Pilih gambar JPEG, PNG, GIF, atau WebP.';
    return;
  }
  if (file.size > AVATAR_MAX_FILE_SIZE_BYTES) {
    avatarMessage.value = `Ukuran foto maksimal ${AVATAR_MAX_FILE_SIZE_MB}MB.`;
    return;
  }

  avatarBusy.value = true;
  try {
    const response = await usersClient.uploadAvatar(file);
    if (!response.success) {
      avatarMessage.value = response.message;
      return;
    }
    if (profile.value) {
      profile.value = { ...profile.value, avatar: response.data.url };
      usersWebHost.syncSessionUser({ ...fields(profile.value), id: profile.value.id, avatar: response.data.url });
      await followChanges();
    }
  } catch (error) {
    console.error(error);
    avatarMessage.value = 'Foto belum bisa diganti.';
  } finally {
    avatarBusy.value = false;
  }
}

onMounted(() => void load());
onUnmounted(onServerEvent(USERS_CHANGED_EVENT, () => void followChanges()));
</script>

<template>
  <div class="profile">
    <ShellTopBar><TopCrumb current="Profil" /></ShellTopBar>
    <PageHead title="Profil" description="Akun, keamanan, dan tampilan." />
    <p v-if="loadError" role="alert" class="profile__load-error">{{ loadError }}</p>
    <div class="profile__grid">
      <section class="panel profile__card" aria-labelledby="profile-data">
        <div class="profile__me">
          <UiAvatar :person="person" :size="64" data-testid="profile-avatar" />
          <div>
            <b class="profile__name">{{ person.name }}</b>
            <div class="profile__mail">{{ profile?.email ?? '' }}</div>
            <div class="profile__photo">
              <UiButton size="sm" :disabled="avatarBusy" @click="fileInput?.click()">{{ avatarBusy ? 'Mengunggah…' : 'Ganti foto' }}</UiButton>
              <input id="profile-avatar-file" ref="fileInput" class="sr-only" type="file" :accept="AVATAR_ALLOWED_MIME_TYPES.join(',')" aria-label="Ganti foto" @change="uploadAvatar" />
            </div>
            <p v-if="avatarMessage" role="alert" class="profile__err">{{ avatarMessage }}</p>
          </div>
        </div>
        <h2 id="profile-data" class="h2 profile__h">Data diri</h2>
        <form class="profile__form" data-testid="profile-form" novalidate @submit.prevent="saveProfile">
          <p v-if="profileError" role="alert" class="profile__err">{{ profileError }}</p>
          <TextField id="profile-name" v-model="name" label="Nama" autocomplete="name" :error="profileErrors.name" />
          <TextField id="profile-email" v-model="email" type="email" label="Email" autocomplete="email" :error="profileErrors.email" />
          <div v-if="conflicts.length" class="profile__conflicts" data-testid="profile-conflicts">
            <div
              v-for="field in conflicts"
              :key="field"
              class="profile__conflict"
              role="group"
              :data-conflict-field="field"
              :aria-label="`${FIELD_LABEL[field]} berubah di tempat lain`"
            >
              <span>{{ FIELD_LABEL[field] }} berubah di tempat lain.</span>
              <button type="button" class="link" :data-testid="`use-theirs-${field}`" @click="resolve(field, 'theirs')">Pakai yang tersimpan</button>
              <button type="button" class="link" :data-testid="`keep-mine-${field}`" @click="resolve(field, 'mine')">Pakai punyaku</button>
            </div>
          </div>
          <div class="profile__foot">
            <p v-if="profileNotice" role="status" class="profile__ok">{{ profileNotice }}</p>
            <UiButton variant="primary" type="submit" :disabled="profileBusy">{{ profileBusy ? 'Menyimpan…' : 'Simpan' }}</UiButton>
          </div>
        </form>
      </section>

      <div class="profile__col">
        <section class="panel profile__card" aria-labelledby="profile-password">
          <h2 id="profile-password" class="h2 profile__h profile__h--top">Ganti password</h2>
          <form class="profile__form" data-testid="password-form" novalidate @submit.prevent="changePassword">
            <p v-if="passwordError" role="alert" class="profile__err">{{ passwordError }}</p>
            <TextField
              id="profile-current-password"
              v-model="currentPassword"
              type="password"
              label="Password sekarang"
              autocomplete="current-password"
              :error="passwordErrors.currentPassword"
            />
            <TextField
              id="profile-new-password"
              v-model="newPassword"
              type="password"
              label="Password baru"
              placeholder="Minimal 8 karakter"
              autocomplete="new-password"
              :error="passwordErrors.newPassword"
            />
            <div class="profile__foot">
              <p v-if="passwordNotice" role="status" class="profile__ok">{{ passwordNotice }}</p>
              <RouterLink v-else class="link profile__security" :to="{ name: 'security' }">Verifikasi dua langkah</RouterLink>
              <UiButton type="submit" :disabled="passwordBusy">{{ passwordBusy ? 'Mengganti…' : 'Update password' }}</UiButton>
            </div>
          </form>
        </section>

        <section class="panel profile__card" aria-labelledby="profile-theme">
          <h2 id="profile-theme" class="h2 profile__h profile__h--top">Tampilan</h2>
          <div class="themes" role="radiogroup" aria-labelledby="profile-theme">
            <button
              v-for="option in THEMES"
              :key="option.value"
              type="button"
              role="radio"
              class="theme focus-ring"
              :class="{ 'theme--on': theme.mode.value === option.value }"
              :aria-checked="theme.mode.value === option.value"
              @click="theme.setTheme(option.value)"
            >
              <span class="theme__shot" :class="`theme__shot--${option.value}`" aria-hidden="true"><i /><i /></span>
              <b>{{ option.label }}</b>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile {
  padding-bottom: 28px;
}
.profile__load-error {
  margin: 0 28px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-revisi);
}
.profile__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  max-width: 1100px;
  padding: 0 28px;
}
.profile__col {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.profile__card {
  padding: 22px;
}
.profile__me {
  display: flex;
  align-items: center;
  gap: 16px;
}
.profile__name {
  font-size: 18px;
}
.profile__mail {
  font-size: 13px;
  color: var(--mute);
}
.profile__photo {
  display: flex;
  gap: 6px;
  margin-top: 9px;
}
.profile__h {
  margin-top: 26px;
  font-size: 16px;
}
.profile__h--top {
  margin-top: 0;
}
.profile__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 14px;
}
.profile__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
}
.profile__ok {
  margin: 0 auto 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-done);
}
.profile__security {
  margin-right: auto;
  font-size: 12.5px;
}
.profile__err {
  margin: 6px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-revisi);
}
.profile__conflicts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.profile__conflict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1.5px solid var(--c-revisi);
  border-radius: var(--r-small);
  font-size: 12.5px;
}
.themes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}
.theme {
  padding: 10px;
  border: 1.5px solid var(--line);
  border-radius: var(--r-card);
  background: var(--card);
  text-align: left;
  cursor: pointer;
}
.theme--on {
  border: 2px solid var(--ink);
  padding: 9.5px;
}
.theme b {
  display: block;
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--ink2);
}
.theme--on b {
  color: var(--ink);
}
.theme__shot {
  height: 46px;
  display: flex;
  gap: 4px;
  padding: 6px;
  border-radius: 6px;
}
.theme__shot i {
  border-radius: 2px;
}
.theme__shot i:first-child {
  width: 14px;
}
.theme__shot i:last-child {
  flex: 1;
}
.theme__shot--light {
  background: #eceae4;
}
.theme__shot--light i:first-child {
  background: #0e0e10;
}
.theme__shot--light i:last-child {
  background: #fff;
}
.theme__shot--dark {
  background: #17171a;
}
.theme__shot--dark i:first-child {
  background: #000;
}
.theme__shot--dark i:last-child {
  background: #232327;
}
/* Half light, half dark: two solid halves, not a gradient. */
.theme__shot--system {
  padding: 0;
  gap: 0;
  overflow: hidden;
}
.theme__shot--system i:first-child {
  width: auto;
  flex: 1;
  border-radius: 0;
  background: #eceae4;
}
.theme__shot--system i:last-child {
  border-radius: 0;
  background: #17171a;
}
@media (max-width: 900px) {
  .profile__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .profile__grid {
    padding: 0 16px;
  }
}
</style>
