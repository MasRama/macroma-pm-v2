import { env } from '../../../shared/config';
import type { ColumnCounts, DashboardSuccess, Project, TaskColumn } from '../contract';
import { TASK_COLUMNS } from '../contract';
import { batchRef, personRefs } from './access';
import { dashboardCalendar } from './calendar';
import type { ProjectsServerHost } from './host';
import {
  activeBatches,
  columnCountsAt,
  countsByBatchIds,
  doneBetween,
  emptyCounts,
  ongoingAssignedTo,
  recentActivity,
  revisiRepeatedCount,
  taskCountsByProject,
} from './repository';

const TREND_DAYS = 7;
const RECENT_ACTIVITY_LIMIT = 8;
const ACTIVE_COLUMNS: readonly TaskColumn[] = ['ongoing', 'revisi', 'review'];

function total(counts: ColumnCounts): number {
  return TASK_COLUMNS.reduce((sum, column) => sum + counts[column], 0);
}

/**
 * The dashboard of the account, over the projects it can open (newest first).
 * Days and weeks (from Monday) are the calendar's in `timeZone`.
 */
export function dashboardData(
  host: ProjectsServerHost,
  userId: string,
  projects: readonly Project[],
  now = new Date(),
  timeZone = env.APP_TIMEZONE,
): DashboardSuccess['data'] {
  const projectIds = projects.map((project) => project.id);
  const perProject = taskCountsByProject(projectIds);
  const counts = emptyCounts();
  for (const projectCounts of perProject.values()) for (const column of TASK_COLUMNS) counts[column] += projectCounts[column];

  const at = now.getTime();
  const calendar = dashboardCalendar(at, timeZone, TREND_DAYS);
  const columnsAt = columnCountsAt(
    projectIds,
    calendar.days.map(({ end }) => end),
  );
  const openings = host.workspaceOpenings(userId);
  const trends = calendar.days.map(({ day, end: moment }) => {
    const columns = columnsAt.get(moment) ?? emptyCounts();
    return {
      day,
      workspace: openings.filter((opened) => opened <= moment).length,
      project: projects.filter((project) => project.created_at <= moment).length,
      active: ACTIVE_COLUMNS.reduce((sum, column) => sum + columns[column], 0),
      done: columns.done,
    };
  });

  const active = activeBatches(projectIds);
  const batchCounts = countsByBatchIds([...active.values()].map((batch) => batch.id));
  const boardHealth = projects.map((project) => {
    const batch = active.get(project.id);
    const health = (batch ? batchCounts.get(batch.id) : perProject.get(project.id)) ?? emptyCounts();
    return {
      project_id: project.id,
      name: project.name,
      workspace_id: project.workspace_id,
      active_batch: batch ? batchRef(batch) : null,
      counts: health,
      total: total(health),
      done: health.done,
    };
  });

  const activity = recentActivity(projectIds, RECENT_ACTIVITY_LIMIT);
  const actors = personRefs(
    host,
    activity.map((row) => row.actor_id),
  );

  return {
    stats: {
      workspace_count: host.workspacesOf(userId).length,
      project_count: projects.length,
      counts,
      total: total(counts),
      done_this_week: doneBetween(projectIds, calendar.weekStart, at + 1),
      done_last_week: doneBetween(projectIds, calendar.lastWeekStart, calendar.weekStart),
      ongoing_mine: ongoingAssignedTo(projectIds, userId),
      revisi_repeated: revisiRepeatedCount(projectIds),
    },
    trends,
    tasks_per_project: projects
      .map((project) => ({ project_id: project.id, name: project.name, count: total(perProject.get(project.id) ?? emptyCounts()) }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    board_health: boardHealth,
    recent_activity: activity.map((row) => ({
      id: row.id,
      project_id: row.project_id,
      event_type: row.event_type,
      description: row.description,
      actor: row.actor_id ? (actors.get(row.actor_id) ?? null) : null,
      task_id: row.task_id,
      batch_id: row.batch_id,
      meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : null,
      created_at: row.created_at,
    })),
    projects: projects.map((project) => ({ id: project.id, name: project.name, workspace_id: project.workspace_id })),
  };
}
