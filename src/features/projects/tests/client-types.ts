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
    const revisions: number = board.data.tasks[0].revisi_count;
    void revisions;
  }

  // @ts-expect-error an edit carries the revision it was based on
  await projects[':id'].$patch({ param: { id: 'p' }, json: { name: 'No revision' } });
  // @ts-expect-error tasks move only between the kanban columns
  await tasks[':id'].move.$patch({ param: { id: 't' }, json: { column_id: 'archive' } });

  const stale: ProjectsError = { success: false, message: 'Stale', code: 'STALE_REVISION' };
  void stale;
  // @ts-expect-error Projects declares no NOT_FOUND refusal
  const undeclared: ProjectsError = { success: false, message: 'Not found', code: 'NOT_FOUND' };
  void undeclared;
}
