export const SCREENS = [
  'board',
  'task-detail',
  'new-task',
  'move-task',
  'edit-task',
  'confirm',
  'bump',
  'first-bump',
  'notifications',
  'releases',
  'dashboard',
  'workspace',
  'chat',
  'feed',
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'profile',
  'users',
  'users-edit',
  'not-found',
] as const;
export type Screen = (typeof SCREENS)[number];

export function screenName(value: string | null): Screen {
  return (SCREENS as readonly string[]).includes(value ?? '') ? (value as Screen) : 'board';
}

export function pathFor(screen: Screen): string {
  switch (screen) {
    case 'task-detail':
      return '/projects/p1/tasks/t4';
    case 'releases':
      return '/projects/p1/releases';
    case 'dashboard':
      return '/dashboard';
    case 'workspace':
    case 'chat':
      return '/workspaces/1';
    case 'feed':
      return '/feed';
    case 'login':
      return '/login';
    case 'register':
      return '/register';
    case 'forgot-password':
      return '/forgot-password';
    case 'reset-password':
      return '/reset-password?token=preview';
    case 'profile':
      return '/profile';
    case 'users':
    case 'users-edit':
      return '/users';
    case 'not-found':
      return '/nowhere';
    default:
      return '/projects/p1/board';
  }
}
