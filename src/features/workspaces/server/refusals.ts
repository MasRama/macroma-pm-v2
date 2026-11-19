import type { Context } from 'hono';
import type { WorkspacesRefusalCode } from '../contract';

/** The refusals Workspaces' routes share, so the UI and the public API answer alike. */
export function refuse<C extends WorkspacesRefusalCode>(context: Context, status: 404 | 409, code: C, message: string) {
  return context.json({ success: false as const, message, code }, status);
}

export function workspaceNotFound(context: Context) {
  return refuse(context, 404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
}
