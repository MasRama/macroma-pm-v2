/** Indonesian date and time labels used across the UI ("4 Nov", "Sel 17 Nov, 10.12", "2 jam"). */
const dayFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const weekdayFormat = new Intl.DateTimeFormat('id-ID', { weekday: 'short' });
const timeFormat = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
const longDateFormat = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

function stripDot(text: string): string {
  return text.replace(/\./g, '');
}

/** "4 Nov" */
export function formatDay(iso: string): string {
  return stripDot(dayFormat.format(new Date(iso)));
}

/** "Sel 17 Nov, 10.12" */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  return `${stripDot(weekdayFormat.format(date))} ${formatDay(iso)}, ${timeFormat.format(date).replace(':', '.')}`;
}

/** "17 Nov, 10.12" */
export function formatDayTime(iso: string): string {
  return `${formatDay(iso)}, ${timeFormat.format(new Date(iso)).replace(':', '.')}`;
}

/** "10.15" */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso)).replace(':', '.');
}

/** "Selasa, 17 November" */
export function formatLongDate(date: Date): string {
  return longDateFormat.format(date);
}

/** Short relative time for feeds: "12 mnt", "2 jam", "Kemarin", "4 Nov". */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam`;
  if (hours < 48) return 'Kemarin';
  return formatDay(iso);
}

/** Longer relative time for notifications and invitations: "5 menit lalu", "1 jam lalu", "Kemarin", "2 hari lalu". */
export function formatAgoLong(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  if (hours < 36) return 'Kemarin';
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return formatDay(iso);
}

/** Day separator in chat: "Hari ini", "Kemarin", or "4 Nov". */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const day = new Date(iso);
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(now) - start(day)) / 86_400_000);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  return formatDay(iso);
}
