<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { mergeEdit, onServerEvent } from '../../../../shared/realtime/browser';
import { ConfirmDialog, TextArea, TextField, UiButton, UiModal } from '../../../../shared/ui';
import { WORKSPACES_CHANGED_EVENT, type Workspace, type WorkspacesError } from '../../contract';
import type { WorkspacesClient } from '../client';
import InviteMemberModal from '../components/InviteMemberModal.vue';
import WorkspaceView from '../components/WorkspaceView.vue';
import { toPendingInvite, toWorkspaceMember, toWorkspaceSummary, type PendingInvite, type WorkspaceMember, type WorkspaceSummary } from '../view';

/**
 * The workspace page on the Workspaces API: loads the workspace with its
 * members and pending invitations, follows `workspaces.changed`, and runs the
 * invite, cancel, remove/leave, edit and delete actions. The server decides
 * who may do what; the page hides what the account's role cannot do and
 * still says why when the server refuses.
 */
const props = defineProps<{ workspaceId: string; client: WorkspacesClient; meId?: string | null }>();
const router = useRouter();

type Code = WorkspacesError['code'];
const REFUSALS: Partial<Record<Code, string>> = {
  FORBIDDEN: 'Akun kamu tidak boleh melakukan ini di workspace ini.',
  WORKSPACE_NOT_FOUND: 'Workspace ini sudah tidak ada.',
  ACCOUNT_NOT_FOUND: 'Belum ada akun dengan email ini. Minta dia daftar dulu.',
  ALREADY_MEMBER: 'Akun ini sudah jadi anggota workspace.',
  INVITATION_PENDING: 'Email ini masih punya undangan yang belum dijawab.',
  INVITATION_NOT_FOUND: 'Undangan itu sudah tidak ada.',
  INVITATION_NOT_PENDING: 'Undangan itu sudah dijawab.',
  MEMBER_NOT_FOUND: 'Akun itu sudah bukan anggota workspace.',
  OWNER_CANNOT_LEAVE: 'Owner tidak bisa keluar atau dikeluarkan dari workspace-nya.',
};
const say = (response: { code: Code; message: string }) => REFUSALS[response.code] ?? response.message;

const workspace = ref<WorkspaceSummary | null>(null);
const members = ref<WorkspaceMember[]>([]);
const invites = ref<PendingInvite[]>([]);
/** The workspace cannot be shown: it is gone, or the account left it. */
const gone = ref('');
const loading = ref(true);
const busy = ref(false);
const notice = ref('');
let latest = 0;

const isOwner = computed(() => workspace.value?.role === 'owner');

async function load(): Promise<void> {
  const ticket = ++latest;
  const id = props.workspaceId;
  try {
    const response = await props.client.get(id);
    if (ticket !== latest) return;
    if (!response.success) {
      if (response.code === 'UNAUTHORIZED') return;
      workspace.value = null;
      gone.value =
        response.code === 'FORBIDDEN' || response.code === 'WORKSPACE_NOT_FOUND'
          ? 'Workspace ini tidak ada, atau kamu bukan anggotanya.'
          : response.message;
      return;
    }
    gone.value = '';
    workspace.value = toWorkspaceSummary(response.data.workspace);
    members.value = response.data.members.map(toWorkspaceMember);
    invites.value = response.data.invitations.map(toPendingInvite);
  } catch (cause) {
    console.error(cause);
    if (ticket === latest) notice.value = 'Workspace belum bisa dimuat. Coba muat ulang halaman.';
  } finally {
    if (ticket === latest) loading.value = false;
  }
}

/** Runs one action: says the refusal (or failure) and reloads either way. */
async function act(work: () => Promise<{ success: true } | { success: false; code: Code; message: string }>, failed: string): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  notice.value = '';
  let ok = false;
  try {
    const response = await work();
    ok = response.success;
    if (!response.success) notice.value = say(response);
  } catch (cause) {
    console.error(cause);
    notice.value = failed;
  } finally {
    busy.value = false;
  }
  await load();
  return ok;
}

let stopLive: (() => void) | undefined;
onMounted(() => {
  stopLive = onServerEvent(WORKSPACES_CHANGED_EVENT, () => void load());
  void load();
});
onBeforeUnmount(() => stopLive?.());
watch(
  () => props.workspaceId,
  () => {
    loading.value = true;
    notice.value = '';
    void load();
  },
);

/* Invite */
const inviteOpen = ref(false);
const inviteError = ref<string | undefined>();
async function invite(email: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  inviteError.value = undefined;
  try {
    const response = await props.client.invite(props.workspaceId, { email });
    if (response.success) {
      inviteOpen.value = false;
    } else {
      inviteError.value = response.errors?.email?.[0] ?? say(response);
    }
  } catch (cause) {
    console.error(cause);
    inviteError.value = 'Undangan belum terkirim. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await load();
}

function cancelInvite(invitationId: string): void {
  void act(() => props.client.cancelInvitation(props.workspaceId, invitationId), 'Undangan belum bisa dibatalkan. Coba lagi.');
}

/* Remove a member, or leave */
const removing = ref<WorkspaceMember | null>(null);
const leaving = computed(() => removing.value !== null && String(removing.value.person.id) === String(props.meId));
async function confirmRemove(): Promise<void> {
  const member = removing.value;
  if (!member) return;
  const self = leaving.value;
  const ok = await act(() => props.client.removeMember(props.workspaceId, String(member.person.id)), 'Anggota belum bisa dikeluarkan. Coba lagi.');
  removing.value = null;
  if (ok && self) await router.replace({ name: 'dashboard' });
}

/* Edit, merging a save made elsewhere instead of overwriting it */
type EditForm = { name: string; description: string };
const FIELD_LABELS: Record<keyof EditForm, string> = { name: 'Nama', description: 'Deskripsi' };
const editOpen = ref(false);
const form = ref<EditForm>({ name: '', description: '' });
const base = ref<EditForm>({ name: '', description: '' });
const theirs = ref<EditForm | null>(null);
const revision = ref(0);
const conflicts = ref<Array<keyof EditForm>>([]);
const mergeNotice = ref('');
const editErrors = ref<Partial<Record<keyof EditForm, string>>>({});
const editError = ref('');

function fromWorkspace(row: Pick<WorkspaceSummary, 'name' | 'description'>): EditForm {
  return { name: row.name, description: row.description ?? '' };
}

function openEdit(): void {
  if (!workspace.value) return;
  form.value = fromWorkspace(workspace.value);
  base.value = { ...form.value };
  revision.value = workspace.value.revision ?? 0;
  theirs.value = null;
  conflicts.value = [];
  mergeNotice.value = '';
  editErrors.value = {};
  editError.value = '';
  editOpen.value = true;
}

function mergeStale(current: Workspace): void {
  const now = fromWorkspace(current);
  const result = mergeEdit(base.value, form.value, now);
  form.value = result.merged;
  base.value = now;
  theirs.value = now;
  revision.value = current.revision;
  conflicts.value = result.conflicts;
  mergeNotice.value = result.adopted.length
    ? `Workspace ini disimpan orang lain saat kamu mengedit. ${result.adopted.map((field) => FIELD_LABELS[field]).join(' dan ')} sudah ikut versi terbaru; cek lalu simpan lagi.`
    : 'Workspace ini disimpan orang lain saat kamu mengedit. Cek isiannya lalu simpan lagi.';
}

function useTheirs(field: keyof EditForm): void {
  if (theirs.value) form.value = { ...form.value, [field]: theirs.value[field] };
  conflicts.value = conflicts.value.filter((name) => name !== field);
}

function keepMine(field: keyof EditForm): void {
  conflicts.value = conflicts.value.filter((name) => name !== field);
}

async function saveEdit(): Promise<void> {
  if (busy.value || conflicts.value.length) return;
  editErrors.value = form.value.name.trim() ? {} : { name: 'Nama wajib diisi' };
  if (editErrors.value.name) return;
  busy.value = true;
  editError.value = '';
  try {
    const response = await props.client.update(props.workspaceId, {
      revision: revision.value,
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
    });
    if (response.success) {
      editOpen.value = false;
    } else if (response.code === 'STALE_REVISION' && 'current' in response) {
      mergeStale(response.current);
    } else if (response.code === 'VALIDATION_ERROR') {
      editErrors.value = { name: response.errors?.name?.[0], description: response.errors?.description?.[0] };
    } else {
      editError.value = say(response);
    }
  } catch (cause) {
    console.error(cause);
    editError.value = 'Perubahan belum tersimpan. Coba lagi.';
  } finally {
    busy.value = false;
  }
  await load();
}

/* Delete */
const deleteOpen = ref(false);
async function confirmDelete(): Promise<void> {
  const ok = await act(() => props.client.remove(props.workspaceId), 'Workspace belum bisa dihapus. Coba lagi.');
  deleteOpen.value = false;
  if (ok) await router.replace({ name: 'dashboard' });
}
</script>

<template>
  <div v-if="gone" class="ws-gone" data-testid="workspace-gone">
    <h1 class="h2">Workspace tidak bisa dibuka</h1>
    <p>{{ gone }}</p>
    <RouterLink to="/dashboard" class="link">Kembali ke Dashboard</RouterLink>
  </div>
  <p v-else-if="loading && !workspace" class="ws-loading">Memuat workspace…</p>
  <WorkspaceView
    v-else
    data-testid="workspace-page"
    :workspace="workspace"
    :members="members"
    :invites="invites"
    :me-id="meId ?? null"
    :can-manage="isOwner"
    :can-invite="workspace !== null"
    :busy="busy"
    @invite="
      inviteError = undefined;
      inviteOpen = true;
    "
    @cancel-invite="cancelInvite"
    @remove-member="removing = members.find((member) => String(member.person.id) === $event) ?? null"
    @edit="openEdit"
    @delete="deleteOpen = true"
  >
    <template #notice>
      <p v-if="notice" role="alert" class="ws-notice" data-testid="workspace-notice">{{ notice }}</p>
    </template>
  </WorkspaceView>

  <InviteMemberModal
    :open="inviteOpen"
    :workspace-name="workspace?.name ?? 'workspace ini'"
    :busy="busy"
    :email-error="inviteError"
    @close="inviteOpen = false"
    @submit="invite"
  />

  <UiModal :open="editOpen" title="Edit workspace" :width="440" @close="editOpen = false">
    <form id="edit-workspace-form" class="ws-form" novalidate data-testid="edit-workspace-form" @submit.prevent="saveEdit">
      <p v-if="mergeNotice" class="ws-form__notice" role="status" data-testid="workspace-merge-notice">{{ mergeNotice }}</p>
      <TextField id="edit-workspace-name" v-model="form.name" label="Nama" :error="editErrors.name" />
      <TextArea id="edit-workspace-description" v-model="form.description" label="Deskripsi" placeholder="Opsional" :error="editErrors.description" />
      <div v-if="conflicts.length" class="ws-conflicts" data-testid="workspace-conflicts">
        <div v-for="field in conflicts" :key="field" class="ws-conflict" :data-conflict-field="field">
          <p>
            <b>{{ FIELD_LABELS[field] }}</b> juga diubah orang lain menjadi
            <q>{{ theirs?.[field] || '(kosong)' }}</q>. Pilih yang disimpan.
          </p>
          <div class="ws-conflict__acts">
            <UiButton size="sm" :data-testid="`use-theirs-${field}`" @click="useTheirs(field)">Pakai versi mereka</UiButton>
            <UiButton size="sm" variant="ghost" :data-testid="`keep-mine-${field}`" @click="keepMine(field)">Pakai punyaku</UiButton>
          </div>
        </div>
      </div>
      <p v-if="editError" role="alert" class="ws-form__error">{{ editError }}</p>
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="editOpen = false">Batal</UiButton>
      <UiButton variant="primary" type="submit" form="edit-workspace-form" :disabled="busy || conflicts.length > 0">Simpan</UiButton>
    </template>
  </UiModal>

  <ConfirmDialog
    :open="removing !== null"
    :title="leaving ? `Keluar dari ${workspace?.name ?? 'workspace'}?` : `Keluarkan ${removing?.person.name ?? ''}?`"
    :message="leaving ? 'Kamu tidak bisa membuka workspace ini lagi sampai diundang ulang.' : 'Dia tidak bisa membuka workspace ini lagi sampai diundang ulang.'"
    :confirm-label="leaving ? 'Keluar' : 'Keluarkan'"
    :busy="busy"
    @confirm="confirmRemove"
    @cancel="removing = null"
  />
  <ConfirmDialog
    :open="deleteOpen"
    :title="`Hapus workspace ${workspace?.name ?? ''}?`"
    message="Anggota dan chat workspace ini ikut terhapus. Project-nya tetap ada, tanpa workspace."
    confirm-label="Hapus permanen"
    :busy="busy"
    @confirm="confirmDelete"
    @cancel="deleteOpen = false"
  />
</template>

<style scoped>
.ws-gone,
.ws-loading {
  padding: 32px 28px;
  color: var(--mute);
}
.ws-gone p {
  margin: 8px 0 14px;
}
.ws-notice {
  margin: 0 28px 14px;
  padding: 10px 12px;
  border: 1px solid var(--alert);
  border-radius: var(--r-small);
  font-size: 13px;
  color: var(--alert);
  background: var(--card);
}
.ws-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ws-form__notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r-small);
  background: var(--fill);
  font-size: 13px;
}
.ws-form__error {
  margin: 0;
  font-size: 13px;
  color: var(--alert);
}
.ws-conflict {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-small);
  font-size: 13px;
}
.ws-conflict p {
  margin: 0 0 8px;
}
.ws-conflict__acts {
  display: flex;
  gap: 6px;
}
@media (max-width: 760px) {
  .ws-notice {
    margin: 0 16px 14px;
  }
}
</style>
