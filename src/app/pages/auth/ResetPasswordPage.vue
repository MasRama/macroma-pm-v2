<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { authFieldTexts, authRefusalText, createAuthClient } from '../../../features/auth/web';
import { TextField, UiButton } from '../../../shared/ui';
import AuthLayout from '../../layouts/AuthLayout.vue';
import './auth-form.css';

/** Set a new password from the emailed link (`/reset-password?token=…`). A reset signs out every device. */
const route = useRoute();
const router = useRouter();
const authClient = createAuthClient();

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token.trim() : ''));
const password = ref('');
const confirmation = ref('');
const errors = ref<Record<string, string>>({});
const formError = ref('');
/** The link is missing, used, or older than an hour: only a new one helps. */
const linkInvalid = ref(false);
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  formError.value = '';
  const next: Record<string, string> = {};
  if (password.value.length < 8) next.password = 'Password minimal 8 karakter';
  if (confirmation.value !== password.value) next.confirmation = 'Password tidak sama';
  errors.value = next;
  if (Object.keys(next).length) return;

  busy.value = true;
  try {
    const response = await authClient.resetPassword({ token: token.value, password: password.value });
    if (response.success) {
      await router.replace({ name: 'login', query: { reset: '1' } });
      return;
    }
    if (response.code === 'RESET_TOKEN_INVALID') {
      linkInvalid.value = true;
      return;
    }
    formError.value = authRefusalText(response.code);
    errors.value = { password: authFieldTexts(response.errors).password ?? '' };
  } catch (error) {
    console.error(error);
    formError.value = 'Password belum bisa disimpan. Cek koneksi lalu coba lagi.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <h1 class="af-title">Password baru</h1>
    <template v-if="!token || linkInvalid">
      <p class="af-sub">Link reset ini tidak valid atau sudah kedaluwarsa.</p>
      <div class="af-form af-form--spaced">
        <p role="alert" class="af-alert" data-testid="reset-link-invalid">Link reset cuma berlaku 1 jam dan sekali pakai. Minta link baru untuk lanjut.</p>
      </div>
      <p class="af-foot"><RouterLink class="link" :to="{ name: 'forgot-password' }">Minta link baru</RouterLink> · <RouterLink class="link" :to="{ name: 'login' }">Kembali ke Masuk</RouterLink></p>
    </template>
    <template v-else>
      <p class="af-sub">Bikin password baru untuk akun kamu. Semua perangkat yang sedang masuk akan keluar.</p>
      <form class="af-form af-form--spaced" novalidate @submit.prevent="submit">
        <p v-if="formError" role="alert" class="af-alert">{{ formError }}</p>
        <TextField
          id="reset-password"
          v-model="password"
          type="password"
          label="Password baru"
          size="lg"
          autocomplete="new-password"
          hint="Minimal 8 karakter."
          :error="errors.password || undefined"
        />
        <TextField
          id="reset-confirmation"
          v-model="confirmation"
          type="password"
          label="Ulangi password"
          size="lg"
          autocomplete="new-password"
          :error="errors.confirmation"
        />
        <UiButton class="af-submit" variant="primary" size="lg" type="submit" block :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan password' }}</UiButton>
      </form>
      <p class="af-foot"><RouterLink class="link" :to="{ name: 'login' }">Kembali ke Masuk</RouterLink></p>
    </template>
  </AuthLayout>
</template>
