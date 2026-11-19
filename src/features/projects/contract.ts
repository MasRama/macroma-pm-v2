import { z } from 'zod';
import type { ApiOperation } from '../../shared/security/api-operations';
import { API_REFUSAL_CODES, API_TOKEN_REFUSAL_CODES } from '../../shared/security/codes';
import { CONTROL_MESSAGE, emailSchema, hasNoControlChars } from '../../shared/security/input';
import { pageQueryShape } from '../../shared/security/pagination';

export const featureName = 'projects' as const;
export type FeatureName = typeof featureName;

/** Live update topic: a project, its members or its batches changed; refetch the project list and the open project. */
export const PROJECTS_CHANGED_EVENT = 'projects.changed';
/** Live update topic: a task of a project the account can open changed; refetch the open board and task. */
export const PROJECTS_BOARD_CHANGED_EVENT = 'projects.board-changed';

/**
 * Notification types Projects sends, with the data each carries (the
 * `taskMovedNotificationData` response schema).
 */
export const PROJECTS_NOTIFICATION_TYPES = {
  /**
   * To the task's assignee and creator, never the account that moved it:
   * `{ project_id, project_name, task_id, task_title, version, column_from,
   * column_to, actor_id, actor_name }`.
   */
  taskMoved: 'task_moved',
} as const;

/** Kanban columns, in board order. */
export const TASK_COLUMNS = ['backlog', 'ongoing', 'revisi', 'review', 'done'] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];

/** How activity entries and the public API name each column. */
export const TASK_COLUMN_NAMES: Record<TaskColumn, string> = {
  backlog: 'Backlog',
  ongoing: 'On Going',
  revisi: 'Revisi',
  review: 'Review',
  done: 'Done',
};

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** How many entries a project's activity feed returns, newest first. */
export const PROJECT_ACTIVITY_LIMIT = 50;

/**
 * What a project activity entry records; `meta` carries `{ from, to, version }`
 * where it applies, and `task_title` / `batch_version` as recorded with the event.
 */
export const PROJECT_ACTIVITY_EVENTS = [
  'project.created',
  'task.created',
  'task.moved',
  'task.updated',
  'task.deleted',
  'batch.created',
  'batch.activated',
  'task.attachment_added',
  'task.attachment_removed',
] as const;
export type ProjectActivityEvent = (typeof PROJECT_ACTIVITY_EVENTS)[number];

/** Comments are plain text of at most this many characters. */
export const TASK_COMMENT_MAX_LENGTH = 2000;

/** Task image uploads: at most this many files per request, each at most this size. */
export const TASK_ATTACHMENT_MAX_FILES = 8;
export const TASK_ATTACHMENT_MAX_FILE_SIZE_MB = 5;
export const TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES = TASK_ATTACHMENT_MAX_FILE_SIZE_MB * 1024 * 1024;
export const TASK_ATTACHMENT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export const STALE_REVISION = 'STALE_REVISION' as const;

/** Refusals Projects adds to the shared API codes. */
export const PROJECTS_REFUSAL_CODES = [
  'PROJECT_NOT_FOUND',
  'BATCH_NOT_FOUND',
  'TASK_NOT_FOUND',
  'ACCOUNT_NOT_FOUND',
  'ALREADY_MEMBER',
  'MEMBER_NOT_FOUND',
  'OWNER_CANNOT_BE_REMOVED',
  'TASK_ALREADY_IN_COLUMN',
  'COMMENT_NOT_FOUND',
  'ATTACHMENT_NOT_FOUND',
  /** An upload in which no file was a usable image; `errors.files` says why for each. */
  'NO_FILES_PROCESSED',
  STALE_REVISION,
] as const;

export type ProjectsRefusalCode = (typeof PROJECTS_REFUSAL_CODES)[number];

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(255, 'Name must be at most 255 characters')
  .refine(hasNoControlChars, { message: `Name ${CONTROL_MESSAGE}` });

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(500, 'Title must be at most 500 characters')
  .refine(hasNoControlChars, { message: `Title ${CONTROL_MESSAGE}` });

/** Optional long text: blank becomes `null`. */
const textSchema = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const idSchema = z.string().trim().min(1).max(64);

export const createProjectInputSchema = z.object({
  name: nameSchema,
  description: textSchema('Description', 2000).optional(),
  /** A workspace the creator belongs to; its members can then open the project. */
  workspace_id: idSchema.nullable().optional(),
});

export const updateProjectInputSchema = z
  .object({
    /** The revision the edit was based on; a newer one refuses it with `STALE_REVISION`. */
    revision: z.number().int().positive(),
    name: nameSchema.optional(),
    description: textSchema('Description', 2000).optional(),
  })
  .refine((input) => input.name !== undefined || input.description !== undefined, {
    message: 'Nothing to update',
    path: ['name'],
  });

export const listProjectsQuerySchema = z.object({ workspace_id: idSchema.optional() });

export const addProjectMemberInputSchema = z.object({ email: emailSchema });

export const createBatchInputSchema = z.object({
  label: textSchema('Label', 255).optional(),
  /** Starts the next major version (`v1.0` after `v0.4`) instead of the next minor one. */
  bump_major: z.boolean().optional(),
  /** Makes the new batch the active one in the same step; only the project owner may. */
  activate: z.boolean().optional(),
});

export const boardQuerySchema = z.object({
  /** Only the tasks of this batch; without it, every task of the project. */
  batch_id: idSchema.optional(),
});

export const createTaskInputSchema = z.object({
  title: titleSchema,
  description: textSchema('Description', 10000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  /** An account that can open the project. */
  assignee_id: idSchema.nullable().optional(),
  /** A batch of the project; without it, the active batch. */
  batch_id: idSchema.nullable().optional(),
});

export const updateTaskInputSchema = z
  .object({
    /** The revision the edit was based on; a newer one refuses it with `STALE_REVISION`. */
    revision: z.number().int().positive(),
    title: titleSchema.optional(),
    description: textSchema('Description', 10000).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    /** `null` unassigns the task. */
    assignee_id: idSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined || input.description !== undefined || input.priority !== undefined || input.assignee_id !== undefined,
    { message: 'Nothing to update', path: ['title'] },
  );

export const moveTaskInputSchema = z
  .object({
    column_id: z.enum(TASK_COLUMNS),
    /** Required when moving to `revisi`: what has to change. */
    note: z.string().trim().max(2000, 'Note must be at most 2000 characters').optional(),
    /** Position in the target column; without it, the task goes last. */
    sort_order: z.number().int().min(0).optional(),
  })
  .refine((input) => input.column_id !== 'revisi' || Boolean(input.note), {
    message: 'A note is required when moving a task to revisi',
    path: ['note'],
  });

export const createCommentInputSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(TASK_COMMENT_MAX_LENGTH, `Comment must be at most ${TASK_COMMENT_MAX_LENGTH} characters`),
});

/** Uploads name their task in the query: the upload path stays static so it can carry its own body budget. */
export const uploadAttachmentsQuerySchema = z.object({ task_id: idSchema });

/** The public API's project list: the projects the caller can open, newest first. */
export const apiProjectsQuerySchema = z.object({
  /** Only the projects of this workspace. */
  workspace_id: idSchema.optional(),
  ...pageQueryShape,
});

/** The public API's task list, by `updated_at` then `id`, oldest first; every filter narrows it. */
export const apiTasksQuerySchema = z.object({
  /** Only the tasks of this batch of the project. */
  batch_id: idSchema.optional(),
  column_id: z.enum(TASK_COLUMNS).optional(),
  assignee_id: idSchema.optional(),
  /** Only the tasks changed at or after this moment (ms epoch), for incremental sync. */
  updated_since: z.coerce.number().int().min(0).optional(),
  ...pageQueryShape,
});

/** The public API's comment list of a task, oldest first. */
export const apiCommentsQuerySchema = z.object({ ...pageQueryShape });

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type ListProjectsQuery = z.input<typeof listProjectsQuerySchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberInputSchema>;
export type CreateBatchInput = z.infer<typeof createBatchInputSchema>;
export type BoardQuery = z.input<typeof boardQuerySchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
export type UploadAttachmentsQuery = z.input<typeof uploadAttachmentsQuerySchema>;

/**
 * Response schemas, built on demand: routes type their responses against them
 * and contract tests parse real responses with them. Strict, so an undeclared
 * field fails.
 */
export function projectsResponseSchemas() {
  const success = <T extends z.ZodType>(data: T) =>
    z.strictObject({ success: z.literal(true), message: z.string(), data });

  const person = z.strictObject({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    avatar: z.string().nullable(),
  });
  /** The short account shape shown on cards and feeds. */
  const personRef = z.strictObject({ id: z.string(), name: z.string(), avatar: z.string().nullable() });
  const role = z.enum(['owner', 'member']);
  const column = z.enum(TASK_COLUMNS);
  const counts = z.strictObject({
    backlog: z.number(),
    ongoing: z.number(),
    revisi: z.number(),
    review: z.number(),
    done: z.number(),
  });

  const project = z.strictObject({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    owner_id: z.string(),
    workspace_id: z.string().nullable(),
    revision: z.number(),
    created_at: z.number(),
    updated_at: z.number(),
  });
  const batchRef = z.strictObject({
    id: z.string(),
    major: z.number(),
    minor: z.number(),
    label: z.string().nullable(),
  });
  const batch = z.strictObject({
    ...batchRef.shape,
    project_id: z.string(),
    is_active: z.boolean(),
    created_at: z.number(),
    updated_at: z.number(),
    /** Tasks of the batch per column. */
    counts,
    total: z.number(),
  });
  const projectSummary = z.strictObject({
    ...project.shape,
    /** The signed-in account's role: `owner`, or `member` through the project or its workspace. */
    role,
    active_batch: batchRef.nullable(),
    /** Every task of the project per column. */
    task_counts: counts,
    /** Distinct accounts that can open the project. */
    member_count: z.number(),
  });
  const member = z.strictObject({
    user: person,
    role,
    /** `project` for a direct member, `workspace` for access through the project's workspace. */
    source: z.enum(['project', 'workspace']),
  });
  const version = z.strictObject({ major: z.number(), minor: z.number(), patch: z.number() });
  const task = z.strictObject({
    id: z.string(),
    project_id: z.string(),
    batch_id: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(TASK_PRIORITIES),
    assignee: personRef.nullable(),
    column_id: column,
    sort_order: z.number(),
    version,
    revision: z.number(),
    /** How many times the task moved to `revisi`. */
    revisi_count: z.number(),
    comment_count: z.number(),
    attachment_count: z.number(),
    created_at: z.number(),
    updated_at: z.number(),
  });
  const taskLog = z.strictObject({
    id: z.string(),
    version: z.string(),
    column_from: column.nullable(),
    column_to: column,
    note: z.string(),
    user: personRef.nullable(),
    created_at: z.number(),
    /**
     * What the entry records, where the API sends it (e.g. `batch_adopted` when
     * the first Bump versi takes a batch-less task into its batch). Optional:
     * older entries and servers send none.
     */
    kind: z.string().optional(),
  });
  const taskDetail = z.strictObject({
    ...task.shape,
    project: z.strictObject({ id: z.string(), name: z.string() }),
    batch: batchRef.nullable(),
    /** Who created the task, from its first log. */
    created_by: personRef.nullable(),
    /** Every version the task went through, oldest first. */
    logs: z.array(taskLog),
  });
  const comment = z.strictObject({
    id: z.string(),
    task_id: z.string(),
    content: z.string(),
    /** `null` once the author's account is deleted. */
    user: personRef.nullable(),
    created_at: z.number(),
  });
  const attachment = z.strictObject({
    id: z.string(),
    task_id: z.string(),
    /** The file name as uploaded. */
    name: z.string(),
    /** Always `image/webp`: uploads are converted. */
    mime_type: z.string(),
    size: z.number(),
    /** The signed-in route serving the image to accounts that can open the project. */
    url: z.string(),
    /** `null` once the uploader's account is deleted. */
    uploaded_by: personRef.nullable(),
    created_at: z.number(),
  });
  const activity = z.strictObject({
    id: z.string(),
    event_type: z.enum(PROJECT_ACTIVITY_EVENTS),
    description: z.string(),
    actor: personRef.nullable(),
    task_id: z.string().nullable(),
    batch_id: z.string().nullable(),
    /** Task events: the task's title when the event happened (its current one for older rows); else null. */
    task_title: z.string().nullable(),
    /** Batch events: the batch's `major.minor`, like `1.8`; else null. */
    batch_version: z.string().nullable(),
    meta: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.number(),
  });
  /**
   * A released batch on the releases (Rilis) view. A batch is released when
   * it becomes active and closes when another batch is activated after it.
   * Batches run in release order: activated ones by activation, then planned
   * ones by creation.
   */
  const release = z.strictObject({
    ...batchRef.shape,
    /** When the batch became active (its latest activation). */
    opened_at: z.number(),
    /** When the next batch was activated. */
    closed_at: z.number(),
    task_count: z.number(),
    /** The major version differs from the previous batch's in release order; `false` for the first batch. */
    major_bump: z.boolean(),
  });
  /** A planned batch: opened without being activated, so not released yet. */
  const upcomingRelease = z.strictObject({
    ...batchRef.shape,
    created_at: z.number(),
    task_count: z.number(),
    major_bump: z.boolean(),
  });
  const releaseBatch = z.strictObject({
    ...batchRef.shape,
    created_at: z.number(),
    /** `null` for a planned batch that was never active. */
    opened_at: z.number().nullable(),
    /** `null` for the active batch and for a planned one. */
    closed_at: z.number().nullable(),
    task_count: z.number(),
    major_bump: z.boolean(),
    is_active: z.boolean(),
  });
  const activeRelease = z.strictObject({
    ...batchRef.shape,
    opened_at: z.number(),
    counts,
    total: z.number(),
    done: z.number(),
    /** `done` as a whole percentage of `total`, rounded; 0 for an empty batch. */
    progress: z.number(),
  });
  const releaseStats = z.strictObject({
    task_count: z.number(),
    /** Whole days from opening to closing, rounded up; `null` while the batch is not closed. */
    duration_days: z.number().nullable(),
    /** Tasks of the batch that moved to `revisi` at least once. */
    revisi_task_count: z.number(),
  });
  const changelogEntry = z.strictObject({
    task_id: z.string(),
    title: z.string(),
    priority: z.enum(TASK_PRIORITIES),
    version,
    assignee: personRef.nullable(),
    column_id: column,
  });
  const contributor = z.strictObject({
    user: person,
    /** Distinct tasks of the batch the account is assigned to or logged a change on. */
    task_count: z.number(),
  });
  const dashboardStats = z.strictObject({
    workspace_count: z.number(),
    project_count: z.number(),
    /** Every task of the account's projects per column. */
    counts,
    /**
     * The account's projects with at least one task in `ongoing`, `revisi` or
     * `review`, from the same `counts`: the projects behind the active task
     * count (`counts.ongoing + counts.revisi + counts.review`), 0 when it is 0.
     */
    active_project_count: z.number(),
    total: z.number(),
    /** Tasks in `done` whose latest move into `done` falls in this week: since Monday 00:00 in the app time zone. */
    done_this_week: z.number(),
    /** The same, in last week (Monday to Monday). */
    done_last_week: z.number(),
    /** Tasks in `ongoing` assigned to the signed-in account. */
    ongoing_mine: z.number(),
    /** Tasks in `revisi` that moved to `revisi` more than once. */
    revisi_repeated: z.number(),
  });
  /** One day of the trends, each value counted as it stood at the end of that day. */
  const trendDay = z.strictObject({
    /** The calendar date in the app time zone (`APP_TIMEZONE`), `YYYY-MM-DD`. */
    day: z.string(),
    workspace: z.number(),
    project: z.number(),
    /** Tasks in `ongoing`, `revisi` or `review`, from each task's latest move that day or before. */
    active: z.number(),
    done: z.number(),
  });
  const projectTaskCount = z.strictObject({ project_id: z.string(), name: z.string(), count: z.number() });
  const boardHealth = z.strictObject({
    project_id: z.string(),
    name: z.string(),
    workspace_id: z.string().nullable(),
    active_batch: batchRef.nullable(),
    /** The active batch's tasks, or every task of the project when no batch is active. */
    counts,
    total: z.number(),
    done: z.number(),
  });
  const dashboardActivity = z.strictObject({ ...activity.shape, project_id: z.string() });
  const projectLink = z.strictObject({ id: z.string(), name: z.string(), workspace_id: z.string().nullable() });
  const boardColumn = z.strictObject({
    id: column,
    name: z.string(),
    /** Board order, from 0. */
    position: z.number(),
    /** Every task of the project in the column. */
    task_count: z.number(),
  });
  /** Send it back as `cursor` for the next page; `null` on the last page. */
  const nextCursor = z.string().nullable();
  const error = z.strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.enum([...API_REFUSAL_CODES, ...PROJECTS_REFUSAL_CODES]),
    errors: z.record(z.string(), z.array(z.string())).optional(),
  });

  return {
    person,
    personRef,
    counts,
    project,
    batchRef,
    batch,
    projectSummary,
    member,
    task,
    taskLog,
    taskDetail,
    comment,
    attachment,
    activityEntry: activity,
    release,
    activeRelease,
    upcomingRelease,
    releaseBatch,
    releaseStats,
    changelogEntry,
    contributor,
    dashboardStats,
    trendDay,
    boardHealth,
    dashboardActivity,
    error,
    /** 409 for a project edit based on an older revision; `current` is the project as it is now. */
    staleProject: z.strictObject({ ...error.shape, code: z.literal(STALE_REVISION), current: project }),
    /** 409 for a task edit based on an older revision; `current` is the task as it is now. */
    staleTask: z.strictObject({ ...error.shape, code: z.literal(STALE_REVISION), current: task }),
    done: z.strictObject({ success: z.literal(true), message: z.string() }),
    projects: success(z.strictObject({ projects: z.array(projectSummary) })),
    projectSaved: success(z.strictObject({ project })),
    projectDetail: success(
      z.strictObject({
        project: projectSummary,
        /** Newest version first. */
        batches: z.array(batch),
        active_batch: batch.nullable(),
        members: z.array(member),
      }),
    ),
    memberAdded: success(z.strictObject({ member })),
    activity: success(z.strictObject({ activity: z.array(activity) })),
    batches: success(z.strictObject({ batches: z.array(batch) })),
    batchSaved: success(z.strictObject({ batch })),
    tasks: success(z.strictObject({ tasks: z.array(task) })),
    taskSaved: success(z.strictObject({ task })),
    taskMoved: success(z.strictObject({ task, log: taskLog })),
    taskDetailFound: success(z.strictObject({ task: taskDetail })),
    taskLogs: success(z.strictObject({ logs: z.array(taskLog) })),
    comments: success(z.strictObject({ comments: z.array(comment) })),
    commentAdded: success(z.strictObject({ comment })),
    attachments: success(z.strictObject({ attachments: z.array(attachment) })),
    /** Some files may fail while others upload; `errors` names each failed file and why. */
    attachmentsUploaded: success(z.strictObject({ attachments: z.array(attachment), errors: z.array(z.string()) })),
    releases: success(
      z.strictObject({
        active: activeRelease.nullable(),
        /** Released batches that are no longer active, latest activation first. */
        closed: z.array(release),
        /** Planned batches, never activated, oldest first. */
        upcoming: z.array(upcomingRelease),
      }),
    ),
    releaseDetail: success(
      z.strictObject({
        batch: releaseBatch,
        stats: releaseStats,
        /** The batch's tasks, latest version first. */
        changelog: z.array(changelogEntry),
        /** Most tasks first. */
        contributors: z.array(contributor),
      }),
    ),
    /** Public API (`/api/v1`) refusals: the bearer pipeline's codes join the shared and Projects ones. */
    apiError: z.strictObject({
      ...error.shape,
      code: z.enum([...API_REFUSAL_CODES, ...API_TOKEN_REFUSAL_CODES, ...PROJECTS_REFUSAL_CODES]),
    }),
    apiProjects: success(z.strictObject({ projects: z.array(projectSummary), next_cursor: nextCursor })),
    apiProject: success(z.strictObject({ project: projectSummary, active_batch: batch.nullable() })),
    apiColumns: success(z.strictObject({ columns: z.array(boardColumn) })),
    /** Direct members first, in joining order, then the accounts that reach the project through its workspace. */
    apiMembers: success(z.strictObject({ members: z.array(member) })),
    apiTasks: success(z.strictObject({ tasks: z.array(task), next_cursor: nextCursor })),
    apiComments: success(z.strictObject({ comments: z.array(comment), next_cursor: nextCursor })),
    /** The flat `data` of a `task_moved` notification; `version` is the task's new one, like `v1.2.3`. */
    taskMovedNotificationData: z.strictObject({
      project_id: z.string(),
      project_name: z.string(),
      task_id: z.string(),
      task_title: z.string(),
      version: z.string(),
      column_from: column,
      column_to: column,
      actor_id: z.string(),
      actor_name: z.string(),
    }),
    dashboard: success(
      z.strictObject({
        stats: dashboardStats,
        /** The last 7 days, oldest first, today last. */
        trends: z.array(trendDay),
        /** Most tasks first. */
        tasks_per_project: z.array(projectTaskCount),
        board_health: z.array(boardHealth),
        /** The latest 8 entries across the account's projects. */
        recent_activity: z.array(dashboardActivity),
        /** Newest first. */
        projects: z.array(projectLink),
      }),
    ),
  };
}

type ProjectsResponseSchemas = ReturnType<typeof projectsResponseSchemas>;
type Infer<K extends keyof ProjectsResponseSchemas> = z.infer<ProjectsResponseSchemas[K]>;

export type ProjectPerson = Infer<'person'>;
export type ProjectPersonRef = Infer<'personRef'>;
export type ColumnCounts = Infer<'counts'>;
export type Project = Infer<'project'>;
export type BatchRef = Infer<'batchRef'>;
export type Batch = Infer<'batch'>;
export type ProjectSummary = Infer<'projectSummary'>;
export type ProjectMember = Infer<'member'>;
export type Task = Infer<'task'>;
export type TaskLog = Infer<'taskLog'>;
export type TaskDetail = Infer<'taskDetail'>;
export type TaskComment = Infer<'comment'>;
export type TaskAttachment = Infer<'attachment'>;
export type ProjectActivity = Infer<'activityEntry'>;
export type Release = Infer<'release'>;
export type ActiveRelease = Infer<'activeRelease'>;
export type TaskMovedNotificationData = Infer<'taskMovedNotificationData'>;
export type UpcomingRelease = Infer<'upcomingRelease'>;
export type ReleaseBatch = Infer<'releaseBatch'>;
export type ReleaseStats = Infer<'releaseStats'>;
export type ChangelogEntry = Infer<'changelogEntry'>;
export type ReleaseContributor = Infer<'contributor'>;
export type DashboardStats = Infer<'dashboardStats'>;
export type DashboardTrendDay = Infer<'trendDay'>;
export type BoardHealth = Infer<'boardHealth'>;
export type DashboardActivity = Infer<'dashboardActivity'>;
export type ProjectsError = Infer<'error'>;
export type StaleProjectError = Infer<'staleProject'>;
export type StaleTaskError = Infer<'staleTask'>;
export type ProjectsDone = Infer<'done'>;
export type ProjectsSuccess = Infer<'projects'>;
export type ProjectSavedSuccess = Infer<'projectSaved'>;
export type ProjectDetailSuccess = Infer<'projectDetail'>;
export type MemberAddedSuccess = Infer<'memberAdded'>;
export type ProjectActivitySuccess = Infer<'activity'>;
export type BatchesSuccess = Infer<'batches'>;
export type BatchSavedSuccess = Infer<'batchSaved'>;
export type TasksSuccess = Infer<'tasks'>;
export type TaskSavedSuccess = Infer<'taskSaved'>;
export type TaskMovedSuccess = Infer<'taskMoved'>;
export type TaskDetailSuccess = Infer<'taskDetailFound'>;
export type TaskLogsSuccess = Infer<'taskLogs'>;
export type CommentsSuccess = Infer<'comments'>;
export type CommentAddedSuccess = Infer<'commentAdded'>;
export type AttachmentsSuccess = Infer<'attachments'>;
export type AttachmentsUploadedSuccess = Infer<'attachmentsUploaded'>;
export type ReleasesSuccess = Infer<'releases'>;
export type ReleaseDetailSuccess = Infer<'releaseDetail'>;
export type DashboardSuccess = Infer<'dashboard'>;
export type BoardColumn = Infer<'apiColumns'>['data']['columns'][number];
export type ProjectsApiError = Infer<'apiError'>;
export type ApiProjectsSuccess = Infer<'apiProjects'>;
export type ApiProjectSuccess = Infer<'apiProject'>;
export type ApiColumnsSuccess = Infer<'apiColumns'>;
export type ApiProjectMembersSuccess = Infer<'apiMembers'>;
export type ApiTasksSuccess = Infer<'apiTasks'>;
export type ApiCommentsSuccess = Infer<'apiComments'>;

export type ProjectsResponse = ProjectsSuccess | ProjectsError;
export type ProjectSavedResponse = ProjectSavedSuccess | ProjectsError;
export type UpdateProjectResponse = ProjectSavedSuccess | StaleProjectError | ProjectsError;
export type ProjectDetailResponse = ProjectDetailSuccess | ProjectsError;
export type ProjectsDoneResponse = ProjectsDone | ProjectsError;
export type MemberAddedResponse = MemberAddedSuccess | ProjectsError;
export type ProjectActivityResponse = ProjectActivitySuccess | ProjectsError;
export type BatchesResponse = BatchesSuccess | ProjectsError;
export type BatchSavedResponse = BatchSavedSuccess | ProjectsError;
export type TasksResponse = TasksSuccess | ProjectsError;
export type TaskSavedResponse = TaskSavedSuccess | ProjectsError;
export type UpdateTaskResponse = TaskSavedSuccess | StaleTaskError | ProjectsError;
export type TaskMovedResponse = TaskMovedSuccess | ProjectsError;
export type CommentsResponse = CommentsSuccess | ProjectsError;
export type CommentAddedResponse = CommentAddedSuccess | ProjectsError;
export type AttachmentsResponse = AttachmentsSuccess | ProjectsError;
export type AttachmentsUploadedResponse = AttachmentsUploadedSuccess | ProjectsError;
export type TaskDetailResponse = TaskDetailSuccess | ProjectsError;
export type ReleasesResponse = ReleasesSuccess | ProjectsError;
export type ReleaseDetailResponse = ReleaseDetailSuccess | ProjectsError;
export type DashboardResponse = DashboardSuccess | ProjectsError;
export type TaskLogsResponse = TaskLogsSuccess | ProjectsError;

/**
 * The public API's project and task operations, as mounted under `/api/v1`.
 * The application's OpenAPI document is built from them, and a test checks
 * them against the mounted routes and their real answers.
 */
export function projectsApiV1(): ApiOperation[] {
  const schemas = projectsResponseSchemas();
  const project = { 403: ['FORBIDDEN'], 404: ['PROJECT_NOT_FOUND'] } as const;
  const task = { 403: ['FORBIDDEN'], 404: ['TASK_NOT_FOUND'] } as const;
  return [
    {
      method: 'get',
      path: '/projects',
      summary: 'List the projects you can open',
      description: 'Projects the token\'s account is a member of, directly or through their workspace, newest first.',
      query: apiProjectsQuerySchema,
      responses: { 200: schemas.apiProjects },
    },
    {
      method: 'get',
      path: '/projects/:id',
      summary: 'Get a project',
      description: 'The project with its task counts and its active batch.',
      responses: { 200: schemas.apiProject },
      refusals: project,
    },
    {
      method: 'get',
      path: '/projects/:id/columns',
      summary: 'List a project\'s board columns',
      description: 'The fixed Kanban columns in board order, with the project\'s task count in each.',
      responses: { 200: schemas.apiColumns },
      refusals: project,
    },
    {
      method: 'get',
      path: '/projects/:id/batches',
      summary: 'List a project\'s batches',
      description: 'Every batch (release version), newest version first, with its task counts.',
      responses: { 200: schemas.batches },
      refusals: project,
    },
    {
      method: 'get',
      path: '/projects/:id/members',
      summary: 'List the accounts that can open a project',
      responses: { 200: schemas.apiMembers },
      refusals: project,
    },
    {
      method: 'get',
      path: '/projects/:id/tasks',
      summary: 'List a project\'s tasks',
      description:
        'Ordered by `updated_at`, then `id`, oldest first, so `updated_since` and `cursor` sync changes incrementally. Deleted tasks do not appear: reconcile with a full listing.',
      query: apiTasksQuerySchema,
      responses: { 200: schemas.apiTasks },
      refusals: { ...project, 404: ['PROJECT_NOT_FOUND', 'BATCH_NOT_FOUND'] },
    },
    {
      method: 'get',
      path: '/tasks/:id',
      summary: 'Get a task',
      description: 'The task with its project, batch, creator and every version it went through.',
      responses: { 200: schemas.taskDetailFound },
      refusals: task,
    },
    {
      method: 'get',
      path: '/tasks/:id/comments',
      summary: 'List a task\'s comments',
      description: 'Oldest first, as a conversation reads.',
      query: apiCommentsQuerySchema,
      responses: { 200: schemas.apiComments },
      refusals: task,
    },
    {
      method: 'post',
      path: '/projects/:id/tasks',
      summary: 'Create a task',
      description: 'Goes to the backlog of the given batch, or of the active batch when `batch_id` is left out. Members of the project see it live.',
      body: createTaskInputSchema,
      responses: { 201: schemas.taskSaved },
      refusals: { ...project, 404: ['PROJECT_NOT_FOUND', 'BATCH_NOT_FOUND'] },
    },
    {
      method: 'patch',
      path: '/tasks/:id',
      summary: 'Edit a task',
      description:
        'Send the `revision` you last read. When the task changed since, the answer is 409 `STALE_REVISION` with the task as it is now in `current`: merge, then retry with its revision.',
      body: updateTaskInputSchema,
      responses: { 200: schemas.taskSaved },
      refusals: { ...task, 409: [STALE_REVISION] },
      stale: schemas.staleTask,
    },
    {
      method: 'patch',
      path: '/tasks/:id/move',
      summary: 'Move a task to another column',
      description:
        'Records a new version of the task and notifies its assignee and creator, as a move on the board does. Moving to `revisi` needs a `note`.',
      body: moveTaskInputSchema,
      responses: { 200: schemas.taskMoved },
      refusals: { ...task, 409: ['TASK_ALREADY_IN_COLUMN'] },
    },
    {
      method: 'delete',
      path: '/tasks/:id',
      summary: 'Delete a task',
      description: 'Only the project owner may delete a task. Its comments, history and images go with it.',
      responses: { 200: schemas.done },
      refusals: task,
    },
    {
      method: 'post',
      path: '/tasks/:id/comments',
      summary: 'Comment on a task',
      body: createCommentInputSchema,
      responses: { 201: schemas.commentAdded },
      refusals: task,
    },
  ];
}
