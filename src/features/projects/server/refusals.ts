import type { Context } from 'hono';
import type { ProjectsRefusalCode } from '../contract';

/** The refusals Projects' routes share, so the UI and the public API answer alike. */
export function refuse<C extends ProjectsRefusalCode>(context: Context, status: 404 | 409, code: C, message: string) {
  return context.json({ success: false as const, message, code }, status);
}

export function assigneeRefused(context: Context) {
  return context.json(
    {
      success: false as const,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR' as const,
      errors: { assignee_id: ['The assignee must be able to open the project'] },
    },
    422,
  );
}

export const projectNotFound = (context: Context) => refuse(context, 404, 'PROJECT_NOT_FOUND', 'Project not found');
export const batchNotFound = (context: Context) => refuse(context, 404, 'BATCH_NOT_FOUND', 'Batch not found');
export const taskNotFound = (context: Context) => refuse(context, 404, 'TASK_NOT_FOUND', 'Task not found');
export const commentNotFound = (context: Context) => refuse(context, 404, 'COMMENT_NOT_FOUND', 'Comment not found');
export const attachmentNotFound = (context: Context) => refuse(context, 404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
