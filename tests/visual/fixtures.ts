/*
 * Visual-check data copied from the approved mockups (Wajom Studio). Test-only:
 * shipped code never imports this file.
 */
import type {
  ActivityEntry,
  BatchSummary,
  BoardHealthRow,
  DashboardStats,
  ProjectSummary,
  ReleaseDetail,
  ReleaseSummary,
  TaskCardData,
  TaskDetailData,
} from '../../src/features/projects/web';
import type { NotificationItem } from '../../src/features/notifications/web';
import type { ChatMessage, PendingInvite, WorkspaceMember, WorkspaceProjectCard } from '../../src/features/workspaces/web';

export const NOW = new Date('2026-11-17T10:20:00');
const at = (day: number, time: string, month = 11) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}:00`;

export const ren = { id: 1, name: 'Ren' };
export const azka = { id: 2, name: 'Azka' };
export const dimas = { id: 3, name: 'Dimas' };
export const salsa = { id: 4, name: 'Salsa' };
export const team = [ren, azka, dimas, salsa];

export const workspace = { id: 'w1', name: 'Wajom Studio', description: 'Tim produk Wajom', role: 'owner' as const, memberCount: 4, projectCount: 4, revision: 1 };

export const workspaces = [
  { id: 'w1', name: 'Wajom Studio' },
  { id: 'w2', name: 'Nara Labs' },
  { id: 'w3', name: 'Freelance' },
];

export const sidebarProjects = [
  { id: 1, name: 'Wajom Portal', batch: { major: 2, minor: 3 } },
  { id: 2, name: 'Stoko App', batch: { major: 1, minor: 8 } },
  { id: 3, name: 'Sterilkucing', batch: { major: 0, minor: 6 } },
  { id: 4, name: 'Divpemnas', batch: { major: 3, minor: 1 } },
  { id: 5, name: 'Mushaf Sharfi', batch: { major: 1, minor: 2 } },
];

export const project: ProjectSummary = {
  id: 1,
  name: 'Wajom Portal',
  description: 'Portal client WhatsApp gateway: pairing, billing, broadcast.',
  workspaceName: 'Wajom Studio',
  batch: { major: 2, minor: 3 },
};

const counts = { backlog: 4, ongoing: 5, revisi: 3, review: 2, done: 9 };
export const batches: BatchSummary[] = [
  { id: 21, major: 2, minor: 1, label: 'Broadcast terjadwal', openedAt: at(29, '09:00', 9), isActive: false, counts: { backlog: 0, ongoing: 0, revisi: 0, review: 0, done: 12 } },
  { id: 22, major: 2, minor: 2, label: 'Billing & invoice', openedAt: at(14, '09:00', 10), isActive: false, counts: { backlog: 0, ongoing: 0, revisi: 0, review: 0, done: 18 } },
  { id: 23, major: 2, minor: 3, label: 'Pairing flow & billing', openedAt: at(4, '14:00'), isActive: true, counts },
];

const v = (patch: number) => ({ major: 2, minor: 3, patch });
const card = (
  id: number,
  status: TaskCardData['status'],
  title: string,
  patch: number,
  priority: TaskCardData['priority'],
  assignee: (typeof team)[number],
  extra: Partial<TaskCardData> = {},
): TaskCardData => ({ id, status, title, version: v(patch), priority, assignee, commentCount: 0, attachmentCount: 0, revisiCount: 0, ...extra });

export const tasks: TaskCardData[] = [
  card(1, 'backlog', 'Export riwayat broadcast ke CSV', 0, 'medium', azka, { description: 'Filter tanggal + status kirim ikut ke file.', commentCount: 2 }),
  card(2, 'backlog', 'Halaman 404 pakai ilustrasi baru', 0, 'low', salsa),
  card(3, 'backlog', 'Rate limit endpoint kirim pesan per device', 0, 'medium', dimas, { attachmentCount: 1 }),
  card(4, 'ongoing', 'Pairing code 8 digit tanpa scan QR', 4, 'high', ren, { description: 'Fallback kalau kamera HP client rusak.', commentCount: 6, attachmentCount: 3, revisiCount: 1 }),
  card(5, 'ongoing', 'Invoice PDF otomatis tiap tanggal 1', 2, 'medium', azka, { commentCount: 1 }),
  card(6, 'ongoing', 'Webhook retry dengan backoff', 1, 'low', dimas),
  card(16, 'ongoing', 'Notifikasi device putus ke email owner', 1, 'medium', salsa, { commentCount: 2 }),
  card(7, 'revisi', 'Checkout Midtrans gagal di Safari iOS', 7, 'high', salsa, { commentCount: 9, revisiCount: 2 }),
  card(8, 'revisi', 'Copy onboarding step 2 kurang jelas', 5, 'medium', ren, { revisiCount: 1 }),
  card(9, 'review', 'Multi device per akun (maks 5)', 6, 'high', azka, { description: 'Butuh cek limit paket sebelum release.', commentCount: 4, attachmentCount: 2 }),
  card(10, 'review', 'Dark mode dashboard client', 3, 'low', salsa),
  card(11, 'done', 'Status device realtime via SSE', 8, 'high', dimas, { commentCount: 3 }),
  card(12, 'done', 'Reset password lewat WhatsApp OTP', 4, 'medium', ren),
  card(13, 'done', 'Logo baru di email transaksi', 3, 'low', salsa),
  card(14, 'done', 'Template pesan pakai variabel nama', 2, 'medium', azka),
];

export const detail: TaskDetailData = {
  ...tasks[3]!,
  projectName: 'Wajom Portal',
  batch: { major: 2, minor: 3 },
  createdAt: at(4, '14:02'),
  createdBy: azka,
  updatedAt: at(17, '10:12'),
  comments: Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    author: team[index % 4]!,
    body: ['Kode expired terlalu cepat di Android lama.', 'Siap, aku cek.', 'Udah aku naikin ke 60 detik.'][index % 3]!,
    at: at(16, `1${index}:05`),
  })),
  images: [],
  logs: [
    { id: 5, version: v(4), from: 'revisi', to: 'ongoing', note: 'Fix: input kode sekarang auto-uppercase, timeout dinaikkan ke 60 detik.', author: ren, at: at(17, '10:12') },
    { id: 4, version: v(3), from: 'review', to: 'revisi', note: 'Kode expired sebelum user selesai ngetik di Android lama. Tolong cek timeout.', author: azka, at: at(16, '16:40') },
    { id: 3, version: v(2), from: 'ongoing', to: 'review', note: 'Pairing code jalan di Chrome + Safari. Siap direview.', author: ren, at: at(16, '11:05') },
    { id: 2, version: v(1), from: 'backlog', to: 'ongoing', note: 'Mulai dikerjakan, pakai endpoint pairing baru dari Baileys.', author: ren, at: at(13, '09:30') },
    { id: 1, version: v(0), from: null, to: 'backlog', note: 'Task dibuat di batch v2.3.', author: azka, at: at(4, '14:02') },
  ],
};
detail.images = [
  { id: 1, url: '/macroma.svg', name: 'pairing-1.png' },
  { id: 2, url: '/macroma.svg', name: 'pairing-2.png' },
  { id: 3, url: '/macroma.svg', name: 'pairing-3.png' },
];

export const releases: ReleaseSummary[] = [
  { id: 22, major: 2, minor: 2, label: 'Billing & invoice', openedAt: at(14, '09:00', 10), closedAt: at(3, '17:00'), taskCount: 18, isMajor: false },
  { id: 21, major: 2, minor: 1, label: 'Broadcast terjadwal', openedAt: at(29, '09:00', 9), closedAt: at(14, '09:00', 10), taskCount: 12, isMajor: false },
  { id: 20, major: 2, minor: 0, label: 'Multi-device rewrite', openedAt: at(2, '09:00', 8), closedAt: at(29, '09:00', 9), taskCount: 31, isMajor: true },
  { id: 19, major: 1, minor: 9, label: 'Template pesan', openedAt: at(18, '09:00', 7), closedAt: at(2, '09:00', 8), taskCount: 9, isMajor: false },
];

const change = (id: number, title: string, priority: TaskCardData['priority'], patch: number, assignee: (typeof team)[number]) => ({
  id,
  title,
  priority,
  version: { major: 2, minor: 2, patch },
  assignee,
});
export const releaseDetail: ReleaseDetail = {
  ...releases[0]!,
  durationDays: 20,
  revisiTaskCount: 5,
  changelog: [
    change(1, 'Invoice PDF dengan logo client', 'high', 9, azka),
    change(2, 'Tagihan prorata saat upgrade paket', 'high', 7, ren),
    change(3, 'Riwayat pembayaran di dashboard client', 'medium', 6, salsa),
    change(4, 'Reminder jatuh tempo via WhatsApp', 'medium', 5, dimas),
    change(5, 'Halaman paket & harga baru', 'medium', 4, salsa),
    change(6, 'Webhook status pembayaran Midtrans', 'high', 8, dimas),
    change(7, 'Kupon diskon per client', 'low', 3, azka),
    change(8, 'Export invoice bulanan ke Excel', 'low', 2, azka),
    ...Array.from({ length: 10 }, (_, index) => change(20 + index, `Perbaikan kecil ${index + 1}`, 'low' as const, 1, ren)),
  ],
  contributors: [
    { person: ren, taskCount: 6 },
    { person: azka, taskCount: 5 },
    { person: dimas, taskCount: 4 },
    { person: salsa, taskCount: 3 },
  ],
};

export const stats: DashboardStats = {
  activeTasks: 41,
  activeProjects: 5,
  ongoing: 15,
  ongoingMine: 6,
  revisi: 6,
  revisiRepeated: 2,
  doneThisWeek: 23,
  doneLastWeek: 15,
};

export const health: BoardHealthRow[] = [
  { project: { id: 1, name: 'Wajom Portal' }, batch: { major: 2, minor: 3 }, counts },
  { project: { id: 2, name: 'Stoko App' }, batch: { major: 1, minor: 8 }, counts: { backlog: 6, ongoing: 3, revisi: 0, review: 1, done: 12 } },
  { project: { id: 3, name: 'Sterilkucing' }, batch: { major: 0, minor: 6 }, counts: { backlog: 9, ongoing: 2, revisi: 2, review: 0, done: 3 } },
  { project: { id: 4, name: 'Divpemnas' }, batch: { major: 3, minor: 1 }, counts: { backlog: 2, ongoing: 4, revisi: 1, review: 3, done: 7 } },
  { project: { id: 5, name: 'Mushaf Sharfi' }, batch: { major: 1, minor: 2 }, counts: { backlog: 5, ongoing: 1, revisi: 0, review: 0, done: 4 } },
];

export const activity: ActivityEntry[] = [
  { id: 1, actor: azka, kind: 'moved', subject: 'Checkout Midtrans gagal di Safari iOS', status: 'revisi', version: v(7), at: at(17, '10:08') },
  { id: 2, actor: ren, kind: 'moved', subject: 'Pairing code 8 digit', status: 'ongoing', version: v(4), at: at(17, '08:20') },
  { id: 3, actor: dimas, kind: 'completed', subject: 'Status device realtime via SSE', status: 'done', version: v(8), at: at(17, '07:20') },
  { id: 4, actor: salsa, kind: 'commented', subject: 'Dark mode dashboard client', at: at(17, '05:20') },
  { id: 5, actor: ren, kind: 'bumped', subject: 'Stoko App', version: { major: 1, minor: 8 }, at: at(16, '09:00') },
];

export const wsProjects: WorkspaceProjectCard[] = [
  { id: 1, name: 'Wajom Portal', description: 'Portal client WhatsApp gateway.', batch: { major: 2, minor: 3 }, done: 9, total: 23, members: team },
  { id: 2, name: 'Stoko App', description: 'Aplikasi sales lapangan.', batch: { major: 1, minor: 8 }, done: 12, total: 22, members: [ren, azka] },
  { id: 3, name: 'Sterilkucing', description: 'Booking steril kucing.', batch: { major: 0, minor: 6 }, done: 3, total: 16, members: [salsa, dimas] },
  { id: 4, name: 'Divpemnas', description: 'Sistem divisi pemenangan.', batch: { major: 3, minor: 1 }, done: 7, total: 17, members: [ren, dimas, azka] },
];

export const members: WorkspaceMember[] = [
  { person: ren, email: 'ren@wajom.co', role: 'owner' },
  { person: azka, email: 'azka@wajom.co', role: 'member' },
  { person: dimas, email: 'dimas@wajom.co', role: 'member' },
  { person: salsa, email: 'salsa@wajom.co', role: 'member' },
];
export const invites: PendingInvite[] = [{ id: 'i1', email: 'fajar@wajom.co', sentAt: at(15, '10:20') }];

export const messages: ChatMessage[] = [
  { id: 'm1', author: azka, body: 'Checkout Safari iOS aku balikin ke revisi ya, masih gagal di iPhone 12.', at: at(17, '09:41') },
  { id: 'm2', author: salsa, body: 'Oke aku cek. Kayaknya redirect 3DS-nya ke-block.', at: at(17, '09:44') },
  { id: 'm3', author: ren, body: 'Sip. Pairing code udah aku push v2.3.4, tolong review siang ini.', at: at(17, '10:15') },
  { id: 'm4', author: dimas, body: 'Siap, abis makan siang.', at: at(17, '10:17') },
];

export const notifications: NotificationItem[] = [
  { id: 'n1', kind: 'invited', actor: dimas, subject: 'Nara Labs', workspaceId: 'w2', invitationToken: 'preview', at: at(17, '10:15'), unread: true },
  { id: 'n2', kind: 'invite-accepted', actor: salsa, subject: 'Wajom Studio', workspaceId: 'w1', invitationToken: null, at: at(17, '09:20'), unread: true },
  { id: 'n3', kind: 'invite-accepted', actor: azka, subject: 'Wajom Studio', workspaceId: 'w1', invitationToken: null, at: at(16, '09:00'), unread: false },
];

export const shellUser = { ...ren, caption: 'Owner' };
