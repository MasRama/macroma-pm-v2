import { z } from 'zod';
import { API_REFUSAL_CODES } from '../../shared/security/codes';
import { CONTROL_MESSAGE, emailSchema, hasNoControlChars } from '../../shared/security/input';

export const featureName = 'projects' as const;
export type FeatureName = typeof featureName;

/** Live update topic: a project, its members or its batches changed; refetch the project list and the open project. */
export const PROJECTS_CHANGED_EVENT = 'projects.changed';
/** Live update topic: a task of a project the account can open changed; refetch the open board and task. */
export const PROJECTS_BOARD_CHANGED_EVENT = 'projects.board-changed';

/** Kanban columns, in board order. */
export const TASK_COLUMNS = ['backlog', 'ongoing', 'revisi', 'review', 'done'] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** How many entries a project's activity feed returns, newest first. */
export const PROJECT_ACTIVITY_LIMIT = 50;

/** What a project activity entry records; `meta` carries `{ from, to, version }` where it applies. */
export const PROJECT_ACTIVITY_EVENTS = [
  'project.created',
  'task.created',
  'task.moved',
  'task.updated',
  'task.deleted',
  'batch.created',
  'batch.activated',
] as const;
export type ProjectActivityEvent = (typeof PROJECT_ACTIVITY_EVENTS)[number];

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

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type ListProjectsQuery = z.input<typeof listProjectsQuerySchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberInputSchema>;
export type CreateBatchInput = z.infer<typeof createBatchInputSchema>;
export type BoardQuery = z.input<typeof boardQuerySchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;

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
  const activity = z.strictObject({
    id: z.string(),
    event_type: z.enum(PROJECT_ACTIVITY_EVENTS),
    description: z.string(),
    actor: personRef.nullable(),
    task_id: z.string().nullable(),
    batch_id: z.string().nullable(),
    meta: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.number(),
  });
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
    activityEntry: activity,
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
export type ProjectActivity = Infer<'activityEntry'>;
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
export type TaskDetailResponse = TaskDetailSuccess | ProjectsError;
export type TaskLogsResponse = TaskLogsSuccess | ProjectsError;
