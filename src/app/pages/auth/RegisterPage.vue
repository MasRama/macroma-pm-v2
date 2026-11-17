<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { createAuthClient, useAuthSession } from '../../../features/auth/web';
import { TextField, UiButton } from '../../../shared/ui';
import AuthLayout from '../../layouts/AuthLayout.vue';
import GoogleMark from './GoogleMark.vue';
import { startGoogleSignIn } from './google';
import { isPhone } from './phone';
import { firstErrors, redirectTarget } from './redirect';
import './auth-form.css';

const name = ref('');
const email = ref('');
const phone = ref('');
const password = ref('');
const busy = ref(false);
const googleBusy = ref(false);
const formError = ref('');
const errors = ref<Record<string, string>>({});

const authClient = createAuthClient();
const authSession = useAuthSession();
const route = useRoute();
const router = useRouter();

function validate(): boolean {
  const next: Record<string, string> = {};
  if (!name.value.trim()) next.name = 'Nama wajib diisi';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) next.email = 'Masukkan email yang valid';
  if (!isPhone(phone.value)) next.phone = 'Nomor HP hanya boleh angka, spasi, tanda hubung, dan + di depan';
  if (password.value.length < 8) next.password = 'Password minimal 8 karakter';
  errors.value = next;
  return Object.keys(next).length === 0;
}

async function submit(): Promise<void> {
  if (busy.value) return;
  formError.value = '';
  if (!validate()) return;

  busy.value = true;
  try {
    const response = await authClient.register({
      name: name.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim() || null,
      password: password.value,
    });
    if (!response.success) {
      formError.value = response.message;
      errors.value = firstErrors(response.errors);
      return;
    }
    if (response.data?.user) authSession.setAuthenticated(response.data.user);
    else if (!(await authSession.refresh())) {
      formError.value = 'Akun sudah dibuat, tapi sesi belum bisa dimuat. Silakan masuk.';
      return;
    }
    await router.replace(redirectTarget(route));
  } catch (error) {
    console.error(error);
    formError.value = 'Akun belum bisa dibuat. Cek koneksi lalu coba lagi.';
  } finally {
    busy.value = false;
  }
}

async function google(): Promise<void> {
  if (googleBusy.value) return;
  formError.value = '';
  googleBusy.value = true;
  formError.value = await startGoogleSignIn();
  // Leaving for Google keeps the button busy until the page unloads.
  if (formError.value) googleBusy.value = false;
}
</script>

<template>
  <AuthLayout>
    <h1 class="af-title">Daftar</h1>
    <p class="af-sub">Sudah punya akun? <RouterLink class="link" :to="{ name: 'login', query: route.query.redirect ? { redirect: route.query.redirect } : {} }">Masuk</RouterLink></p>
    <UiButton class="af-google" block :disabled="googleBusy" data-testid="google-sign-in" @click="google"><GoogleMark />Daftar dengan Google</UiButton>
    <div class="af-or">atau pakai email</div>
    <form class="af-form" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="af-alert">{{ formError }}</p>
      <TextField id="register-name" v-model="name" label="Nama" size="lg" autocomplete="name" :error="errors.name" />
      <TextField id="register-email" v-model="email" type="email" label="Email" size="lg" autocomplete="email" :error="errors.email" />
      <TextField
        id="register-phone"
        v-model="phone"
        type="tel"
        label="Nomor HP"
        size="lg"
        inputmode="tel"
        autocomplete="tel"
        placeholder="Opsional, mis. +62 812 3456 7890"
        :error="errors.phone"
      />
      <TextField
        id="register-password"
        v-model="password"
        type="password"
        label="Password"
        size="lg"
        autocomplete="new-password"
        hint="Minimal 8 karakter."
        :error="errors.password"
      />
      <UiButton class="af-submit" variant="primary" size="lg" type="submit" block :disabled="busy">{{ busy ? 'Membuat akun…' : 'Buat akun' }}</UiButton>
    </form>
  </AuthLayout>
</template>
