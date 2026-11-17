<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { createAuthClient } from '../../../features/auth/web';
import { TextField, UiButton } from '../../../shared/ui';
import AuthLayout from '../../layouts/AuthLayout.vue';
import { firstErrors } from './redirect';
import './auth-form.css';

/** Ask for a reset link by email. The answer never says whether the email has an account. */
const email = ref('');
const error = ref<string | undefined>();
const formError = ref('');
const sentTo = ref('');
const busy = ref(false);

const authClient = createAuthClient();

async function submit(): Promise<void> {
  if (busy.value) return;
  formError.value = '';
  sentTo.value = '';
  const address = email.value.trim();
  error.value = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? undefined : 'Masukkan email yang valid';
  if (error.value) return;

  busy.value = true;
  try {
    const response = await authClient.forgotPassword({ email: address });
    if (response.success) {
      sentTo.value = address;
      return;
    }
    if (response.code === 'MAIL_DISABLED') {
      formError.value = 'Reset password lewat email belum aktif di server ini. Minta admin untuk reset password kamu.';
      return;
    }
    formError.value = response.message;
    error.value = firstErrors(response.errors).email;
  } catch (failure) {
    console.error(failure);
    formError.value = 'Link reset belum bisa dikirim. Cek koneksi lalu coba lagi.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <h1 class="af-title">Lupa password</h1>
    <p class="af-sub">Masukkan email akun kamu, kami kirim link untuk bikin password baru.</p>
    <form class="af-form af-form--spaced" novalidate @submit.prevent="submit">
      <p v-if="sentTo" role="status" class="af-notice" data-testid="forgot-sent">
        Kalau <b>{{ sentTo }}</b> terdaftar, link reset sudah dikirim ke sana. Link berlaku 1 jam.
      </p>
      <p v-if="formError" role="alert" class="af-alert">{{ formError }}</p>
      <TextField id="forgot-email" v-model="email" type="email" label="Email" size="lg" autocomplete="email" :error="error" />
      <UiButton class="af-submit" variant="primary" size="lg" type="submit" block :disabled="busy">{{ busy ? 'Mengirim…' : 'Kirim link reset' }}</UiButton>
    </form>
    <p class="af-foot">Ingat password-nya? <RouterLink class="link" :to="{ name: 'login' }">Masuk</RouterLink></p>
  </AuthLayout>
</template>
