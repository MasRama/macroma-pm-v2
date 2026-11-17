<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { TextField, UiButton } from '../../../shared/ui';
import AuthLayout from '../../layouts/AuthLayout.vue';
import './auth-form.css';

/*
 * Set a new password from a reset link. Like Lupa password, this waits for
 * the backend's reset endpoint (phase 2); the form only validates for now.
 */
const password = ref('');
const confirmation = ref('');
const errors = ref<Record<string, string>>({});
const notice = ref('');

function submit(): void {
  notice.value = '';
  const next: Record<string, string> = {};
  if (password.value.length < 8) next.password = 'Password minimal 8 karakter';
  if (confirmation.value !== password.value) next.confirmation = 'Password tidak sama';
  errors.value = next;
  if (Object.keys(next).length === 0) notice.value = 'Reset password lewat email belum tersedia.';
}
</script>

<template>
  <AuthLayout>
    <h1 class="af-title">Password baru</h1>
    <p class="af-sub">Bikin password baru untuk akun kamu.</p>
    <form class="af-form af-form--spaced" novalidate @submit.prevent="submit">
      <p v-if="notice" role="status" class="af-alert">{{ notice }}</p>
      <TextField
        id="reset-password"
        v-model="password"
        type="password"
        label="Password baru"
        size="lg"
        autocomplete="new-password"
        hint="Minimal 8 karakter."
        :error="errors.password"
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
      <UiButton class="af-submit" variant="primary" size="lg" type="submit" block>Simpan password</UiButton>
    </form>
    <p class="af-foot"><RouterLink class="link" :to="{ name: 'login' }">Kembali ke Masuk</RouterLink></p>
  </AuthLayout>
</template>
