import { hc } from 'hono/client';
import type {
  AddProjectMemberInput,
  AttachmentsResponse,
  AttachmentsUploadedResponse,
  BatchesResponse,
  BatchSavedResponse,
  BoardQuery,
  CommentAddedResponse,
  CommentsResponse,
  CreateBatchInput,
  CreateCommentInput,
  CreateProjectInput,
  CreateTaskInput,
  DashboardResponse,
  ListProjectsQuery,
  MemberAddedResponse,
  MoveTaskInput,
  ProjectActivityResponse,
  ProjectDetailResponse,
  ProjectSavedResponse,
  ProjectsDoneResponse,
  ProjectsResponse,
  ReleaseDetailResponse,
  ReleasesResponse,
  TaskDetailResponse,
  TaskLogsResponse,
  TaskMovedResponse,
  TaskSavedResponse,
  TasksResponse,
  UpdateProjectInput,
  UpdateProjectResponse,
  UpdateTaskInput,
  UpdateTaskResponse,
} from '../contract';
import type { createDashboardRoutes, createProjectRoutes, createTaskRoutes } from '..';

/** CSRF provider for state-changing requests; the application binds it to its identity provider. */
export interface ProjectsWebCsrf {
  headers(extra?: HeadersInit): Record<string, string>;
  ensureToken(): Promise<unknown>;
}

export interface ProjectsClient {
  /** Projects the signed-in account can open, newest first; `workspace_id` narrows them to one workspace. */
  list(query?: ListProjectsQuery): Promise<ProjectsResponse>;
  create(input: CreateProjectInput): Promise<ProjectSavedResponse>;
  /** The project with its batches, active batch and members. */
  get(id: string): Promise<ProjectDetailResponse>;
  update(id: string, input: UpdateProjectInput): Promise<UpdateProjectResponse>;
  remove(id: string): Promise<ProjectsDoneResponse>;
  addMember(id: string, input: AddProjectMemberInput): Promise<MemberAddedResponse>;
  removeMember(id: string, userId: string): Promise<ProjectsDoneResponse>;
  activity(id: string): Promise<ProjectActivityResponse>;
  batches(id: string): Promise<BatchesResponse>;
  createBatch(id: string, input: CreateBatchInput): Promise<BatchSavedResponse>;
  activateBatch(id: string, batchId: string): Promise<BatchSavedResponse>;
  /** The signed-in account's dashboard over the projects it can open. */
  dashboard(): Promise<DashboardResponse>;
  /** The releases view: the active batch's progress and every other batch, newest first. */
  releases(id: string): Promise<ReleasesResponse>;
  /** One batch's changelog, stats and contributors. */
  release(id: string, batchId: string): Promise<ReleaseDetailResponse>;
  /** The board: every task of the project, or of one batch. */
  tasks(id: string, query?: BoardQuery): Promise<TasksResponse>;
  createTask(id: string, input: CreateTaskInput): Promise<TaskSavedResponse>;
  /** The task with its project, batch, creator and version log. */
  task(taskId: string): Promise<TaskDetailResponse>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<UpdateTaskResponse>;
  moveTask(taskId: string, input: MoveTaskInput): Promise<TaskMovedResponse>;
  removeTask(taskId: string): Promise<ProjectsDoneResponse>;
  taskLogs(taskId: string): Promise<TaskLogsResponse>;
  /** The task's comments, oldest first. */
  comments(taskId: string): Promise<CommentsResponse>;
  addComment(taskId: string, input: CreateCommentInput): Promise<CommentAddedResponse>;
  /** The author or the project owner only. */
  removeComment(taskId: string, commentId: string): Promise<ProjectsDoneResponse>;
  /** The task's images, oldest first; each `url` serves the image to accounts that can open the project. */
  attachments(taskId: string): Promise<AttachmentsResponse>;
  /** Up to 8 JPEG, PNG, GIF or WebP images of at most 5 MB; files that fail come back in `errors`. */
  uploadAttachments(taskId: string, files: readonly File[]): Promise<AttachmentsUploadedResponse>;
  /** The uploader or the project owner only. */
  removeAttachment(taskId: string, attachmentId: string): Promise<ProjectsDoneResponse>;
}

export interface ProjectsClientOptions {
  baseUrl?: string;
  tasksBaseUrl?: string;
  attachmentsBaseUrl?: string;
  dashboardUrl?: string;
  /** Without it, writes reach the server without a CSRF token and fail closed there. */
  csrf?: ProjectsWebCsrf;
}

export function createProjectsClient(options: ProjectsClientOptions = {}): ProjectsClient {
  const {
    baseUrl = '/api/projects',
    tasksBaseUrl = '/api/tasks',
    attachmentsBaseUrl = '/api/task-attachments',
    dashboardUrl = '/api/dashboard',
    csrf,
  } = options;
  const apiFetch: typeof fetch = async (input, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') await csrf?.ensureToken();
    return fetch(input, { ...init, credentials: 'include', headers: csrf ? csrf.headers(init.headers) : init.headers });
  };
  const projects = hc<ReturnType<typeof createProjectRoutes>>(baseUrl.replace(/\/$/, ''), { fetch: apiFetch });
  const tasks = hc<ReturnType<typeof createTaskRoutes>>(tasksBaseUrl.replace(/\/$/, ''), { fetch: apiFetch });
  const dashboard = hc<ReturnType<typeof createDashboardRoutes>>(dashboardUrl.replace(/\/$/, ''), { fetch: apiFetch });

  return {
    list: async (query = {}) => (await projects.index.$get({ query })).json(),
    create: async (input) => (await projects.index.$post({ json: input })).json(),
    get: async (id) => (await projects[':id'].$get({ param: { id } })).json(),
    update: async (id, input) => (await projects[':id'].$patch({ param: { id }, json: input })).json(),
    remove: async (id) => (await projects[':id'].$delete({ param: { id } })).json(),
    addMember: async (id, input) => (await projects[':id'].members.$post({ param: { id }, json: input })).json(),
    removeMember: async (id, userId) => (await projects[':id'].members[':userId'].$delete({ param: { id, userId } })).json(),
    activity: async (id) => (await projects[':id'].activity.$get({ param: { id } })).json(),
    batches: async (id) => (await projects[':id'].batches.$get({ param: { id } })).json(),
    createBatch: async (id, input) => (await projects[':id'].batches.$post({ param: { id }, json: input })).json(),
    activateBatch: async (id, batchId) =>
      (await projects[':id'].batches[':batchId'].activate.$patch({ param: { id, batchId } })).json(),
    dashboard: async () => (await dashboard.index.$get()).json(),
    releases: async (id) => (await projects[':id'].releases.$get({ param: { id } })).json(),
    release: async (id, batchId) => (await projects[':id'].releases[':batchId'].$get({ param: { id, batchId } })).json(),
    tasks: async (id, query = {}) => (await projects[':id'].tasks.$get({ param: { id }, query })).json(),
    createTask: async (id, input) => (await projects[':id'].tasks.$post({ param: { id }, json: input })).json(),
    task: async (taskId) => (await tasks[':id'].$get({ param: { id: taskId } })).json(),
    updateTask: async (taskId, input) => (await tasks[':id'].$patch({ param: { id: taskId }, json: input })).json(),
    moveTask: async (taskId, input) => (await tasks[':id'].move.$patch({ param: { id: taskId }, json: input })).json(),
    removeTask: async (taskId) => (await tasks[':id'].$delete({ param: { id: taskId } })).json(),
    taskLogs: async (taskId) => (await tasks[':id'].logs.$get({ param: { id: taskId } })).json(),
    comments: async (taskId) => (await tasks[':id'].comments.$get({ param: { id: taskId } })).json(),
    addComment: async (taskId, input) => (await tasks[':id'].comments.$post({ param: { id: taskId }, json: input })).json(),
    removeComment: async (taskId, commentId) =>
      (await tasks[':id'].comments[':commentId'].$delete({ param: { id: taskId, commentId } })).json(),
    attachments: async (taskId) => (await tasks[':id'].attachments.$get({ param: { id: taskId } })).json(),
    // Multipart with several files under one name, which the typed client does not build; the shape is the route's.
    uploadAttachments: async (taskId, files) => {
      const form = new FormData();
      for (const file of files) form.append('files', file, file.name);
      const url = `${attachmentsBaseUrl.replace(/\/$/, '')}?${new URLSearchParams({ task_id: taskId })}`;
      return (await apiFetch(url, { method: 'POST', body: form })).json() as Promise<AttachmentsUploadedResponse>;
    },
    removeAttachment: async (taskId, attachmentId) =>
      (await tasks[':id'].attachments[':attachmentId'].$delete({ param: { id: taskId, attachmentId } })).json(),
  };
}
