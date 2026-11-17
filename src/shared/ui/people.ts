/** Solid avatar colours, picked from a person's id so the same person keeps one colour everywhere. */
const PERSON_COLORS = ['#2D55FF', '#0F9D4F', '#7A3CF0', '#FF4A1C', '#0E7C86', '#C9A400', '#6F6C66'];

export function personColor(id: number | string): string {
  const key = String(id);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return PERSON_COLORS[hash % PERSON_COLORS.length]!;
}

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 1)
    .map((part) => part[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/** What an avatar needs: an id for its colour, a name for its letter, an optional photo. */
export interface PersonRef {
  id: number | string;
  name: string;
  avatar?: string | null;
}
