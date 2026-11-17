import type { BatchVersion } from '../../features/projects/web';
import type { PersonRef } from '../../shared/ui';

/* What the shell shows. AppShell fills these from the session (and, with the backend port, from the API). */

export interface ShellWorkspace {
  id: string;
  name: string;
}

export interface ShellProject {
  id: number;
  name: string;
  batch?: BatchVersion | null;
}

export interface ShellLink {
  to: string;
  label: string;
}

export interface ShellUser extends PersonRef {
  /** Line under the name: the workspace role, or the email. */
  caption?: string;
}
