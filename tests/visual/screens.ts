export const SCREENS = [
  'board',
  'task-detail',
  'new-task',
  'move-task',
  'confirm',
  'bump',
  'notifications',
  'releases',
  'dashboard',
  'workspace',
  'chat',
  'feed',
  'login',
  'profile',
  'not-found',
] as const;
export type Screen = (typeof SCREENS)[number];

export function screenName(value: string | null): Screen {
  return (SCREENS as readonly string[]).includes(value ?? '') ? (value as Screen) : 'board';
}

export function pathFor(screen: Screen): string {
  switch (screen) {
    case 'task-detail':
      return '/projects/1/tasks/4';
    case 'releases':
      return '/projects/1/releases';
    case 'dashboard':
      return '/dashboard';
    case 'workspace':
    case 'chat':
      return '/workspaces/1';
    case 'feed':
      return '/feed';
    case 'login':
      return '/login';
    case 'profile':
      return '/profile';
    case 'not-found':
      return '/nowhere';
    default:
      return '/projects/1/board';
  }
}
