import { hc } from 'hono/client';
import type { createProjectRoutes, createTaskRoutes } from '..';
import type { ProjectsError } from '../contract';

/**
 * Compile-time checks that the web client sees the real routes: `npm run lint`
 * fails when they stop matching, including when an `@ts-expect-error` below
 * stops being an error. Never called.
 */
export async function projectsRouteTypes(): Promise<void> {
  const projects = hc<ReturnType<typeof createProjectRoutes>>('/api/projects');
  const tasks = hc<ReturnType<typeof createTaskRoutes>>('/api/tasks');

  const board = await (await projects[':id'].tasks.$get({ param: { id: 'p' }, query: {} })).json();
  if (board.success) {
    const counts: number[] = [board.data.tasks[0].revisi_count, board.data.tasks[0].comment_count, board.data.tasks[0].attachment_count];
    void counts;
  }

  const releases = await (await projects[':id'].releases.$get({ param: { id: 'p' } })).json();
  if (releases.success) {
    const closedAt: number = releases.data.closed[0].closed_at;
    const progress: number | undefined = releases.data.active?.progress;
    const planned: number = releases.data.upcoming[0].created_at;
    void [closedAt, progress, planned];
  }
  const release = await (await projects[':id'].releases[':batchId'].$get({ param: { id: 'p', batchId: 'b' } })).json();
  if (release.success) {
    const duration: number | null = release.data.stats.duration_days;
    const email: string = release.data.contributors[0].user.email;
    void [duration, email];
  }

  // @ts-expect-error an edit carries the revision it was based on
  await projects[':id'].$patch({ param: { id: 'p' }, json: { name: 'No revision' } });
  // @ts-expect-error a comment is text under `content`
  await tasks[':id'].comments.$post({ param: { id: 't' }, json: { body: 'Wrong field' } });
  // @ts-expect-error tasks move only between the kanban columns
  await tasks[':id'].move.$patch({ param: { id: 't' }, json: { column_id: 'archive' } });

  const stale: ProjectsError = { success: false, message: 'Stale', code: 'STALE_REVISION' };
  void stale;
  // @ts-expect-error Projects declares no NOT_FOUND refusal
  const undeclared: ProjectsError = { success: false, message: 'Not found', code: 'NOT_FOUND' };
  void undeclared;
}
