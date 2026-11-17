<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  createUsersClient,
  STALE_REVISION,
  USERS_CHANGED_EVENT,
  USERS_EDITING_EVENT,
  type ManagedUser,
  type StaleUserError,
  type UpdateUserInput,
  type UpdateUserResponse,
  type UsersEditor,
  type UsersFilter,
  type UsersWebRole,
} from '../../../features/users/web';
import { keepEditing, mergeEdit, onServerEvent, sameValue } from '../../../shared/realtime/browser';
import {
  ConfirmDialog,
  PageHead,
  SegmentedControl,
  SelectField,
  ShellTopBar,
  TextField,
  TopCrumb,
  UiAvatar,
  UiButton,
  UiModal,
  type SegmentOption,
} from '../../../shared/ui';
import { usersWebHost as host } from '../../bindings/users.web';
import { isPhone } from '../auth/phone';
import { firstErrors } from '../auth/redirect';

/*
 * Pengguna: the Users feature's account administration in the Macroma shell.
 * Same API, access rules and live merge as the official page, drawn with the
 * shared UI; the server still decides every action.
 */
const usersClient = createUsersClient({ csrf: host.csrf });

const users = ref<ManagedUser[]>([]);
const roles = ref<UsersWebRole[]>([]);
const search = ref('');
const filter = ref<UsersFilter>('all');
const total = ref(0);
const page = ref(1);
const limit = ref('10');
const isLoading = ref(false);
const loadError = ref('');
const loadForbidden = ref(false);
const actionError = ref('');
const roleLoadError = ref('');
const notice = ref('');

const isFormOpen = ref(false);
const isCreating = ref(false);
const editingUser = ref<ManagedUser | null>(null);
const userName = ref('');
const userEmail = ref('');
const userPhone = ref('');
const userVerified = ref(false);
const userPassword = ref('');
const selectedRoles = ref<string[]>([]);
const formError = ref('');
const fieldErrors = ref<Record<string, string>>({});
const isSubmitting = ref(false);
const isResettingPassword = ref(false);

const pendingDelete = ref<ManagedUser | null>(null);
const isDeleting = ref(false);
let usersLoadRequestId = 0;

const FILTERS: SegmentOption[] = [
  { value: 'all', label: 'Semua' },
  { value: 'verified', label: 'Terverifikasi' },
  { value: 'unverified', label: 'Belum' },
];
const PAGE_SIZES = ['5', '10', '25'].map((value) => ({ value, label: `${value} / halaman` }));

type UserFields = { name: string; email: string; phone: string; verified: boolean; roles: string[] };
const FIELD_LABELS: Record<keyof UserFields, string> = {
  name: 'Nama',
  email: 'Email',
  phone: 'Nomor HP',
  verified: 'Status verifikasi',
  roles: 'Role',
};

// The open edit form tracks the saved version it builds on, so changes saved
// elsewhere merge in instead of being overwritten on save.
const editBase = ref<UserFields | null>(null);
const editRevision = ref(0);
const conflicts = ref<Array<keyof UserFields>>([]);
const mergeNotice = ref('');
const editors = ref<Record<string, UsersEditor[]>>({});
let stopEditing: (() => void) | undefined;

const me = () => host.currentSessionUser()?.id;
const canCreate = computed(() => host.allows(host.access.manage('create')));
const canEdit = computed(() => host.allows(host.access.manage('edit')));
const canDelete = computed(() => host.allows(host.access.manage('delete')));
const canAssignRoles = computed(() => host.allows(host.access.assignRoles));
const canResetPasswords = computed(() => host.allows(host.access.resetPasswords));
const editingSelf = computed(() => editingUser.value !== null && editingUser.value.id === me());
const editingAdmin = computed(() => editingUser.value !== null && isAdministrator(editingUser.value));
const canEditCurrentForm = computed(() => isCreating.value || (editingUser.value !== null && canEditUser(editingUser.value)));
/** Email is the sign-in identifier: only administrators change another account's. */
const canEditEmail = computed(() => isCreating.value || editingSelf.value || canAssignRoles.value);
const canResetEditingPassword = computed(
  () => !isCreating.value && !editingSelf.value && canResetPasswords.value && (canAssignRoles.value || !editingAdmin.value),
);
const busy = computed(() => isSubmitting.value || isResettingPassword.value);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / Number(limit.value))));
const formEditors = computed(() => (editingUser.value ? othersEditing(editingUser.value.id) : []));
const formTitle = computed(() => (isCreating.value ? 'Pengguna baru' : canEditCurrentForm.value ? 'Edit pengguna' : 'Reset password'));

function isAdministrator(user: ManagedUser): boolean {
  return user.roles.some((role) => host.isAdministratorRole(role));
}

function isProtectedAdmin(user: ManagedUser): boolean {
  return isAdministrator(user) && !canAssignRoles.value;
}

function canEditUser(user: ManagedUser): boolean {
  return canEdit.value && !isProtectedAdmin(user);
}

function canResetUser(user: ManagedUser): boolean {
  return canResetPasswords.value && user.id !== me() && !isProtectedAdmin(user);
}

function canDeleteUser(user: ManagedUser): boolean {
  return canDelete.value && user.id !== me() && !isProtectedAdmin(user);
}

function othersEditing(userId: string): UsersEditor[] {
  return (editors.value[userId] ?? []).filter((editor) => editor.id !== me());
}

function editorNames(list: UsersEditor[]): string {
  return list.map((editor) => editor.name).join(', ');
}

function roleLabel(slug: string): string {
  return roles.value.find((role) => role.slug === slug)?.name ?? slug;
}

function userFields(user: ManagedUser): UserFields {
  return { name: user.name, email: user.email, phone: user.phone ?? '', verified: user.verified, roles: [...user.roles] };
}

function formFields(): UserFields {
  return {
    name: userName.value,
    email: userEmail.value,
    phone: userPhone.value,
    verified: userVerified.value,
    roles: [...selectedRoles.value],
  };
}

function setFormFields(fields: UserFields): void {
  userName.value = fields.name;
  userEmail.value = fields.email;
  userPhone.value = fields.phone;
  userVerified.value = fields.verified;
  selectedRoles.value = [...fields.roles];
}

function displayValue(field: keyof UserFields, value: UserFields[keyof UserFields] | undefined): string {
  if (field === 'roles') return Array.isArray(value) && value.length > 0 ? value.map(roleLabel).join(', ') : 'Tanpa role';
  if (field === 'verified') return value ? 'Terverifikasi' : 'Belum terverifikasi';
  return typeof value === 'string' && value !== '' ? value : 'Kosong';
}

function isStale(response: UpdateUserResponse): response is StaleUserError {
  return !response.success && response.code === STALE_REVISION && 'current' in response;
}

/**
 * Folds a newer saved version of the open account into the form. Fields you
 * have not touched follow it; fields you both changed are listed as conflicts
 * until you pick a side.
 */
function followSaved(user: ManagedUser): void {
  if (!editBase.value) return;
  const theirs = userFields(user);
  const result = mergeEdit(editBase.value, formFields(), theirs);
  setFormFields(result.merged);
  const open = new Set([...conflicts.value, ...result.conflicts]);
  conflicts.value = [...open].filter((field) => !sameValue(result.merged[field], theirs[field]));
  editBase.value = theirs;
  editRevision.value = user.revision;
  editingUser.value = user;
  if (result.adopted.length > 0) {
    mergeNotice.value = `Ikut perubahan dari tempat lain: ${result.adopted.map((field) => FIELD_LABELS[field]).join(', ')}.`;
  }
}

function useTheirs(field: keyof UserFields): void {
  if (!editBase.value) return;
  setFormFields({ ...formFields(), [field]: editBase.value[field] });
  conflicts.value = conflicts.value.filter((open) => open !== field);
}

function keepMine(field: keyof UserFields): void {
  conflicts.value = conflicts.value.filter((open) => open !== field);
}

async function loadUsers(nextPage = page.value): Promise<void> {
  const requestId = ++usersLoadRequestId;
  isLoading.value = true;
  loadError.value = '';
  loadForbidden.value = false;
  try {
    const response = await usersClient.listUsers({
      page: nextPage,
      limit: Number(limit.value),
      search: search.value,
      filter: filter.value,
    });
    if (requestId !== usersLoadRequestId) return;
    if (!response.success) {
      loadForbidden.value = response.code === 'FORBIDDEN';
      if (!loadForbidden.value) loadError.value = response.message;
      users.value = [];
      return;
    }
    users.value = response.data.users;
    total.value = response.data.total;
    page.value = response.data.page;
    limit.value = String(response.data.limit);
  } catch (error) {
    if (requestId !== usersLoadRequestId) return;
    console.error(error);
    loadError.value = 'Daftar pengguna belum bisa dimuat.';
    users.value = [];
  } finally {
    if (requestId === usersLoadRequestId) isLoading.value = false;
  }
}

// Accounts changed elsewhere: refresh the page in place and fold a newer
// version of the account being edited into its form.
async function followUserChanges(): Promise<void> {
  // A search or page change started meanwhile wins over this refresh.
  const requestId = usersLoadRequestId;
  try {
    const response = await usersClient.listUsers({
      page: page.value,
      limit: Number(limit.value),
      search: search.value,
      filter: filter.value,
    });
    if (requestId !== usersLoadRequestId || !response.success) return;
    users.value = response.data.users;
    total.value = response.data.total;
    const open = editingUser.value;
    if (!open || !isFormOpen.value || isSubmitting.value) return;
    const saved = response.data.users.find((user) => user.id === open.id);
    if (saved && saved.revision > editRevision.value) followSaved(saved);
  } catch (error) {
    console.error(error);
  }
}

async function loadEditors(): Promise<void> {
  try {
    const response = await usersClient.listEditing();
    if (response.success) editors.value = response.data.editing;
  } catch (error) {
    console.error(error);
  }
}

async function loadRoles(): Promise<void> {
  roleLoadError.value = '';
  if (!canAssignRoles.value) {
    roles.value = [];
    return;
  }
  try {
    roles.value = await host.listRoles();
  } catch (error) {
    roles.value = [];
    console.error(error);
    roleLoadError.value = 'Daftar role belum bisa dimuat. Muat ulang halaman sebelum menambah pengguna.';
  }
}

function reload(): void {
  if (pendingDelete.value || isDeleting.value) return;
  page.value = 1;
  void loadUsers(1);
}

function changeFilter(next: string): void {
  filter.value = next as UsersFilter;
  reload();
}

function changeLimit(next: string): void {
  limit.value = next;
  reload();
}

function goToPage(nextPage: number): void {
  if (pendingDelete.value || isDeleting.value) return;
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return;
  void loadUsers(nextPage);
}

function resetForm(): void {
  stopEditing?.();
  stopEditing = undefined;
  editBase.value = null;
  editRevision.value = 0;
  conflicts.value = [];
  mergeNotice.value = '';
  editingUser.value = null;
  setFormFields({ name: '', email: '', phone: '', verified: false, roles: [] });
  userPassword.value = '';
  formError.value = '';
  fieldErrors.value = {};
}

function openCreate(): void {
  if (roleLoadError.value || busy.value || pendingDelete.value) return;
  resetForm();
  isCreating.value = true;
  isFormOpen.value = true;
  actionError.value = '';
  notice.value = '';
}

function openEdit(user: ManagedUser): void {
  if (busy.value || pendingDelete.value) return;
  if (!canEditUser(user) && !canResetUser(user)) return;
  resetForm();
  editingUser.value = user;
  isCreating.value = false;
  setFormFields(userFields(user));
  editBase.value = userFields(user);
  editRevision.value = user.revision;
  if (canEditUser(user)) stopEditing = keepEditing(user.id, usersClient);
  isFormOpen.value = true;
  actionError.value = '';
  notice.value = '';
}

function closeForm(): void {
  if (busy.value) return;
  isFormOpen.value = false;
  resetForm();
}

/** Checks the form in the page's own words before anything is sent. */
function validate(): boolean {
  const errors: Record<string, string> = {};
  if (!userName.value.trim()) errors.name = 'Nama wajib diisi';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail.value.trim())) errors.email = 'Masukkan email yang valid';
  if (!isPhone(userPhone.value)) errors.phone = 'Nomor HP hanya boleh angka, spasi, tanda hubung, dan + di depan';
  if (isCreating.value && userPassword.value.length < 8) errors.password = 'Password minimal 8 karakter';
  fieldErrors.value = errors;
  if (Object.keys(errors).length === 0) return true;
  formError.value = 'Perbaiki isian yang ditandai.';
  return false;
}

async function resetManagedPassword(): Promise<void> {
  if (!editingUser.value || !canResetEditingPassword.value || isResettingPassword.value) return;
  fieldErrors.value = {};
  formError.value = '';
  notice.value = '';
  if (userPassword.value.length < 8) {
    fieldErrors.value = { password: 'Password minimal 8 karakter' };
    return;
  }

  isResettingPassword.value = true;
  try {
    const response = await usersClient.resetPassword(editingUser.value.id, { password: userPassword.value });
    if (!response.success) {
      formError.value = response.message;
      fieldErrors.value = firstErrors(response.errors);
      return;
    }
    userPassword.value = '';
    notice.value = `Password ${editingUser.value.name} direset. Semua sesinya sudah keluar.`;
  } catch (error) {
    console.error(error);
    formError.value = 'Password belum bisa direset.';
  } finally {
    isResettingPassword.value = false;
  }
}

async function createUser(): Promise<void> {
  isSubmitting.value = true;
  try {
    const response = await usersClient.createUser({
      name: userName.value.trim(),
      email: userEmail.value.trim(),
      password: userPassword.value,
      phone: userPhone.value.trim() || null,
      ...(canEdit.value ? { verified: userVerified.value } : {}),
      ...(canAssignRoles.value ? { roles: selectedRoles.value } : {}),
    });
    if (!response.success) {
      formError.value = response.message;
      fieldErrors.value = firstErrors(response.errors);
      return;
    }
    isFormOpen.value = false;
    resetForm();
    notice.value = `${response.data.user.name} ditambahkan.`;
    await loadUsers(1);
  } catch (error) {
    console.error(error);
    formError.value = 'Pengguna belum bisa dibuat.';
  } finally {
    isSubmitting.value = false;
  }
}

async function updateUser(user: ManagedUser): Promise<void> {
  const payload: UpdateUserInput = {
    revision: editRevision.value,
    name: userName.value.trim(),
    phone: userPhone.value.trim() || null,
    ...(canEditEmail.value ? { email: userEmail.value.trim() } : {}),
    ...(canEdit.value ? { verified: userVerified.value } : {}),
    ...(canAssignRoles.value ? { roles: selectedRoles.value } : {}),
  };
  isSubmitting.value = true;
  try {
    const response = await usersClient.updateUser(user.id, payload);
    if (!response.success) {
      if (isStale(response)) {
        followSaved(response.current);
        formError.value =
          conflicts.value.length > 0
            ? 'Akun ini disimpan orang lain saat kamu mengedit. Pilih versi yang mau disimpan di bawah.'
            : 'Akun ini disimpan orang lain saat kamu mengedit. Perubahannya sudah digabung, cek lalu simpan lagi.';
        return;
      }
      formError.value = response.message;
      fieldErrors.value = firstErrors(response.errors);
      return;
    }
    isFormOpen.value = false;
    resetForm();
    notice.value = `${response.data.user.name} disimpan.`;
    await loadUsers(page.value);
  } catch (error) {
    console.error(error);
    formError.value = 'Perubahan belum bisa disimpan.';
  } finally {
    isSubmitting.value = false;
  }
}

async function submitUser(): Promise<void> {
  if (isSubmitting.value) return;
  formError.value = '';
  notice.value = '';
  if (!isCreating.value && conflicts.value.length > 0) {
    formError.value = 'Pilih versi yang mau disimpan untuk tiap isian yang berubah di tempat lain.';
    return;
  }
  if (!validate()) return;
  if (isCreating.value) await createUser();
  else if (editingUser.value) await updateUser(editingUser.value);
}

function requestDelete(user: ManagedUser): void {
  if (busy.value || !canDeleteUser(user)) return;
  pendingDelete.value = user;
  actionError.value = '';
  notice.value = '';
}

function cancelDelete(): void {
  if (isDeleting.value) return;
  pendingDelete.value = null;
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value || isDeleting.value) return;
  const target = pendingDelete.value;
  isDeleting.value = true;
  actionError.value = '';
  try {
    const response = await usersClient.deleteUsers({ ids: [target.id] });
    if (!response.success) {
      actionError.value = response.message;
      pendingDelete.value = null;
      return;
    }
    notice.value = `${target.name} dihapus.`;
    pendingDelete.value = null;
    const remainingTotal = Math.max(0, total.value - response.data.deleted);
    const remainingPages = Math.max(1, Math.ceil(remainingTotal / Number(limit.value)));
    await loadUsers(Math.min(page.value, remainingPages));
  } catch (error) {
    console.error(error);
    actionError.value = 'Pengguna belum bisa dihapus.';
  } finally {
    isDeleting.value = false;
  }
}

onMounted(() => {
  void Promise.all([loadUsers(1), loadRoles(), loadEditors()]);
});
onUnmounted(onServerEvent(USERS_CHANGED_EVENT, () => void followUserChanges()));
onUnmounted(onServerEvent(USERS_EDITING_EVENT, () => void loadEditors()));
onUnmounted(() => stopEditing?.());
</script>

<template>
  <div class="admin" data-testid="users-page">
    <ShellTopBar><TopCrumb :trail="['Admin']" current="Pengguna" /></ShellTopBar>
    <PageHead title="Pengguna" description="Cari akun, atur akses, dan tandai akun yang sudah terverifikasi.">
      <template v-if="canCreate" #actions>
        <UiButton variant="primary" icon="plus" data-testid="create-user" :disabled="Boolean(roleLoadError) || Boolean(pendingDelete) || busy" @click="openCreate">
          Pengguna baru
        </UiButton>
      </template>
    </PageHead>

    <div class="admin__body">
      <p v-if="loadForbidden" role="alert" class="admin__alert">Kamu tidak punya izin melihat daftar pengguna.</p>
      <p v-if="loadError" role="alert" class="admin__alert">{{ loadError }}</p>
      <p v-if="actionError" role="alert" class="admin__alert">{{ actionError }}</p>
      <p v-if="roleLoadError" role="alert" class="admin__alert">{{ roleLoadError }}</p>
      <p v-if="notice" role="status" class="admin__ok">{{ notice }}</p>

      <section v-if="!loadForbidden" class="panel list" aria-labelledby="user-list-title">
        <div class="list__tools">
          <form class="list__search" data-testid="user-search-form" role="search" aria-label="Cari pengguna" @submit.prevent="reload">
            <TextField id="user-search" v-model="search" type="search" placeholder="Cari nama atau email" :disabled="Boolean(pendingDelete) || isDeleting" />
            <UiButton type="submit" icon="search" :disabled="Boolean(pendingDelete) || isDeleting">Cari</UiButton>
          </form>
          <SegmentedControl :model-value="filter" :options="FILTERS" label="Status verifikasi" data-testid="user-filter" @update:model-value="changeFilter" />
          <div class="list__size">
            <SelectField id="user-page-size" :model-value="limit" :options="PAGE_SIZES" :disabled="Boolean(pendingDelete) || isDeleting" @update:model-value="changeLimit" />
          </div>
        </div>

        <div class="list__head">
          <h2 id="user-list-title" class="h2 list__title">Akun</h2>
          <span class="list__count">{{ total }} pengguna</span>
        </div>

        <p v-if="isLoading" role="status" class="list__empty">Memuat pengguna…</p>
        <p v-else-if="users.length === 0" class="list__empty">Tidak ada pengguna yang cocok.</p>

        <template v-else>
          <div class="list__scroll">
            <table class="table" data-testid="user-list">
              <thead>
                <tr>
                  <th scope="col">Pengguna</th>
                  <th scope="col">Nomor HP</th>
                  <th scope="col">Status</th>
                  <th scope="col">Role</th>
                  <th scope="col"><span class="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in users" :key="user.id" :data-user-id="user.id">
                  <td>
                    <div class="who">
                      <UiAvatar :person="{ id: user.id, name: user.name, avatar: user.avatar }" :size="32" />
                      <div class="who__text">
                        <b>{{ user.name }} <span v-if="user.id === host.currentSessionUser()?.id" class="who__me">(kamu)</span></b>
                        <small>{{ user.email }}</small>
                        <small v-if="othersEditing(user.id).length" class="who__editing" data-testid="user-editing">{{ editorNames(othersEditing(user.id)) }} sedang mengedit</small>
                      </div>
                    </div>
                  </td>
                  <td class="mono table__phone">{{ user.phone ?? '—' }}</td>
                  <td>
                    <span class="badge" :class="{ 'badge--on': user.verified }" :data-verified="user.verified">{{ user.verified ? 'Terverifikasi' : 'Belum' }}</span>
                  </td>
                  <td>
                    <div class="roles">
                      <span v-for="role in user.roles" :key="role" class="role" :class="{ 'role--admin': host.isAdministratorRole(role) }">{{ roleLabel(role) }}</span>
                      <span v-if="user.roles.length === 0" class="roles__none">Tanpa role</span>
                    </div>
                  </td>
                  <td class="table__acts">
                    <UiButton
                      v-if="canEditUser(user) || canResetUser(user)"
                      size="sm"
                      variant="ghost"
                      :disabled="busy || Boolean(pendingDelete)"
                      :data-testid="`edit-user-${user.id}`"
                      @click="openEdit(user)"
                    >
                      {{ canEditUser(user) ? 'Edit' : 'Reset password' }}
                    </UiButton>
                    <UiButton
                      v-if="canDeleteUser(user)"
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      class="table__delete"
                      :aria-label="`Hapus ${user.name}`"
                      :disabled="busy || Boolean(pendingDelete)"
                      :data-testid="`delete-user-${user.id}`"
                      @click="requestDelete(user)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pager">
            <UiButton size="sm" variant="ghost" data-testid="user-previous" :disabled="page <= 1 || isLoading || Boolean(pendingDelete) || isDeleting" @click="goToPage(page - 1)">Sebelumnya</UiButton>
            <span aria-live="polite" class="pager__label">Halaman {{ page }} dari {{ totalPages }}</span>
            <UiButton size="sm" variant="ghost" data-testid="user-next" :disabled="page >= totalPages || isLoading || Boolean(pendingDelete) || isDeleting" @click="goToPage(page + 1)">Berikutnya</UiButton>
          </div>
        </template>
      </section>
    </div>

    <UiModal :open="isFormOpen" :width="560" :title="formTitle" :subtitle="editingUser?.email" @close="closeForm">
      <div class="form-notes">
        <p v-if="formError" role="alert" class="admin__alert">{{ formError }}</p>
        <p v-if="formEditors.length" role="status" class="form-notes__live" data-testid="user-editors">
          {{ editorNames(formEditors) }} juga sedang mengedit akun ini.
        </p>
        <p v-if="mergeNotice" role="status" class="admin__ok" data-testid="user-merge-notice">{{ mergeNotice }}</p>
        <section v-if="conflicts.length" class="conflicts" data-testid="user-conflicts" aria-labelledby="user-conflicts-title">
          <h3 id="user-conflicts-title" class="conflicts__title">Berubah di tempat lain saat kamu mengedit</h3>
          <div v-for="field in conflicts" :key="field" class="conflict" role="group" :data-conflict-field="field" :aria-label="`${FIELD_LABELS[field]} berubah di tempat lain`">
            <span class="conflict__label">{{ FIELD_LABELS[field] }}</span>
            <span class="conflict__values">
              <span>Tersimpan: <b>{{ displayValue(field, editBase?.[field]) }}</b></span>
              <span>Punyamu: <b>{{ displayValue(field, formFields()[field]) }}</b></span>
            </span>
            <span class="conflict__acts">
              <button type="button" class="link" :data-testid="`use-theirs-${field}`" @click="useTheirs(field)">Pakai yang tersimpan</button>
              <button type="button" class="link" :data-testid="`keep-mine-${field}`" @click="keepMine(field)">Pakai punyaku</button>
            </span>
          </div>
        </section>
      </div>

      <form class="form" data-testid="user-form" novalidate @submit.prevent="submitUser">
        <TextField id="user-name" v-model="userName" label="Nama" autocomplete="off" :disabled="!canEditCurrentForm" :error="fieldErrors.name" />
        <TextField
          id="user-email"
          v-model="userEmail"
          type="email"
          label="Email"
          autocomplete="off"
          :disabled="!canEditCurrentForm || !canEditEmail"
          :hint="canEditCurrentForm && !canEditEmail ? 'Hanya admin yang bisa mengganti email akun lain.' : undefined"
          :error="fieldErrors.email"
        />
        <TextField
          id="user-phone"
          v-model="userPhone"
          type="tel"
          label="Nomor HP"
          inputmode="tel"
          autocomplete="off"
          placeholder="Opsional"
          :disabled="!canEditCurrentForm"
          :error="fieldErrors.phone"
        />
        <label v-if="canEditCurrentForm && canEdit" class="check" for="user-verified">
          <input id="user-verified" v-model="userVerified" type="checkbox" />
          <span>
            <b>Terverifikasi</b>
            <small>Tandai kalau identitas pemilik akun sudah dicek.</small>
          </span>
        </label>

        <TextField
          v-if="isCreating"
          id="user-password"
          v-model="userPassword"
          type="password"
          label="Password"
          autocomplete="new-password"
          hint="Wajib, minimal 8 karakter."
          :error="fieldErrors.password"
        />
        <p v-else-if="editingSelf" class="form__note">Ganti password kamu sendiri dari Profil, supaya password lama dicek dulu.</p>
        <div v-else-if="canResetEditingPassword" class="reset">
          <div class="reset__row">
            <TextField
              id="user-password"
              v-model="userPassword"
              type="password"
              label="Reset password"
              placeholder="Password baru"
              autocomplete="new-password"
              hint="Reset membuat semua sesi akun ini keluar."
              :error="fieldErrors.password"
              @keydown.enter.prevent="resetManagedPassword"
            />
            <UiButton icon="key" data-testid="reset-user-password" :disabled="busy || !userPassword" class="reset__btn" @click="resetManagedPassword">
              {{ isResettingPassword ? 'Mereset…' : 'Reset' }}
            </UiButton>
          </div>
        </div>

        <fieldset v-if="canAssignRoles && canEditCurrentForm" class="pick">
          <legend class="pick__legend">Role</legend>
          <div class="pick__list">
            <label v-for="role in roles" :key="role.id" class="pick__item">
              <input v-model="selectedRoles" type="checkbox" :value="role.slug" :data-role-slug="role.slug" />
              <span>{{ role.name }} <span class="mono pick__slug">{{ role.slug }}</span></span>
            </label>
          </div>
        </fieldset>

        <div v-if="canEditCurrentForm" class="form__foot">
          <UiButton variant="ghost" :disabled="busy" @click="closeForm">Batal</UiButton>
          <UiButton variant="primary" type="submit" :disabled="busy || (!isCreating && conflicts.length > 0)">
            {{ isSubmitting ? 'Menyimpan…' : isCreating ? 'Tambah pengguna' : 'Simpan' }}
          </UiButton>
        </div>
      </form>
    </UiModal>

    <ConfirmDialog
      :open="Boolean(pendingDelete)"
      :title="`Hapus ${pendingDelete?.name ?? ''}?`"
      message="Akun ini dihapus permanen. Server tetap menolak menghapus akunmu sendiri dan admin terakhir."
      confirm-label="Hapus pengguna"
      :busy="isDeleting"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>

<style scoped>
.admin {
  padding-bottom: 28px;
}
.admin__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1100px;
  padding: 0 28px;
}
.admin__alert,
.admin__ok {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r-small);
  font-size: 13px;
  font-weight: 600;
}
.admin__alert {
  background: var(--c-revisi);
  color: #fff;
}
.admin__ok {
  background: var(--primary-bg);
  color: var(--primary-fg);
}
.list {
  overflow: hidden;
}
.list__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.list__search {
  display: flex;
  flex: 1 1 280px;
  min-width: 0;
  gap: 8px;
}
.list__search > :first-child {
  flex: 1;
  min-width: 0;
}
.list__size {
  width: 150px;
}
.list__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px 16px 6px;
}
.list__title {
  font-size: 16px;
}
.list__count {
  font-size: 12.5px;
  color: var(--mute);
}
.list__empty {
  margin: 0;
  padding: 28px 16px 32px;
  font-size: 13px;
  color: var(--mute);
}
.list__scroll {
  /* Positioned so the absolute sr-only header stays inside the scroll box. */
  position: relative;
  overflow-x: auto;
}
.table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}
.table th {
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
  text-align: left;
  white-space: nowrap;
}
.table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
  vertical-align: middle;
}
.table tbody tr:last-child td {
  border-bottom: 0;
}
.table__phone {
  font-size: 12.5px;
  color: var(--ink2);
  white-space: nowrap;
}
.table__acts {
  text-align: right;
  white-space: nowrap;
}
.table__acts > * + * {
  margin-left: 6px;
}
.table__delete {
  color: var(--c-revisi);
}
.who {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.who__text {
  min-width: 0;
}
.who__text b {
  display: block;
  font-weight: 600;
}
.who__me {
  color: var(--mute);
  font-weight: 500;
}
.who__text small {
  display: block;
  font-size: 12px;
  color: var(--mute);
}
.who__text .who__editing {
  margin-top: 2px;
  font-weight: 600;
  color: var(--c-ongoing);
}
.badge {
  display: inline-block;
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink2);
  white-space: nowrap;
}
.badge--on {
  border-color: var(--c-done);
  background: var(--c-done);
  color: #fff;
}
.roles {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.role {
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink2);
}
.role--admin {
  border-color: var(--primary-bg);
  background: var(--primary-bg);
  color: var(--primary-fg);
}
.roles__none {
  font-size: 12px;
  color: var(--mute);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}
.pager__label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink2);
}
.form-notes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form-notes:not(:empty) {
  margin-bottom: 14px;
}
.form-notes__live {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-ongoing);
}
.conflicts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.conflicts__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}
.conflict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 10px 12px;
  border: 1.5px solid var(--c-revisi);
  border-radius: var(--r-small);
  font-size: 12.5px;
}
.conflict__label {
  font-weight: 700;
}
.conflict__values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--ink2);
}
.conflict__acts {
  display: flex;
  gap: 12px;
  margin-left: auto;
}
.conflict__acts .link {
  font-size: 12.5px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form__note {
  margin: 0;
  font-size: 12.5px;
  color: var(--mute);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-small);
  cursor: pointer;
}
.check input,
.pick__item input {
  width: 16px;
  height: 16px;
  margin: 1px 0 0;
  accent-color: var(--ink);
}
.check b {
  display: block;
  font-size: 13px;
}
.check small {
  display: block;
  font-size: 12px;
  color: var(--mute);
}
.reset__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.reset__row > :first-child {
  flex: 1;
  min-width: 0;
}
/* Lines the button up with the input under the field label. */
.reset__btn {
  margin-top: 22px;
}
.pick {
  margin: 0;
  padding: 0;
  border: 0;
}
.pick__legend {
  margin-bottom: 8px;
  padding: 0;
  font-size: 12.5px;
  font-weight: 600;
}
.pick__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pick__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-small);
  font-size: 13px;
  cursor: pointer;
}
.pick__slug {
  font-size: 11px;
  color: var(--mute);
}
.form__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
@media (max-width: 760px) {
  .admin__body {
    padding: 0 16px;
  }
  .list__size {
    width: 100%;
  }
}
</style>
