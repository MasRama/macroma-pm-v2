# Macroma API

The HTTP API behind the Macroma screens: what each screen calls, who may call
it, what it sends and gets back, which live topics tell it to refetch, and the
refusal codes it can meet. The Feature contracts (`src/features/<feature>/contract.ts`)
are the authority for every shape below; their response schemas are strict and
the contract tests parse real responses with them. The browser does not call
these paths by hand: each Feature ships a typed client in its
`web/index.ts` (`createProjectsClient`, `createWorkspacesClient`,
`createNotificationsClient`, and the Auth and Users clients).

## Conventions

- **Envelope.** Success is `{ success: true, message, data? }`; a refusal is
  `{ success: false, message, code, errors? }`. `errors` maps a field to its
  messages on `422 VALIDATION_ERROR`. Messages are English and meant for
  display; the UI branches on `code`, never on `message`.
- **Status codes.** 401 not signed in, 403 signed in but not allowed, 404
  absent, 409 conflict, 422 validation, 413 body too large, 429 rate limited.
- **Codes every `/api` route can answer with** (`API_REFUSAL_CODES`):
  `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `CSRF_INVALID`,
  `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `PASSWORD_CHANGE_REQUIRED`,
  `APPLICATION_ERROR`, `INTERNAL_ERROR`. Each section below lists only the
  codes its Feature adds.
- **Session.** Signing in sets the httpOnly `auth_id` cookie; every request
  sends it (`credentials: 'include'`).
- **CSRF.** `GET /api/auth/csrf` sets the CSRF cookie and returns
  `{ csrfToken }`; every request that is not `GET`/`HEAD` sends it back in the
  `X-CSRF-Token` header. The typed clients do this through the `csrf` option.
- **Field names.** The Macroma Features (workspaces, projects, notifications)
  use `snake_case` fields (`created_at`, `workspace_id`, `revisi_count`),
  as V1 did. Auth and Users are Nara's official Features and keep their
  `camelCase` fields (`mustChangePassword`, `createdAt`, `userCount`).
- **Time.** Timestamps are epoch milliseconds (`number`). Only the dashboard
  trends carry a calendar date (`YYYY-MM-DD`).
- **Ids** are UUID strings.
- **Revisions.** Records edited through a form (workspace, project, task,
  profile, managed user, role) carry `revision`. An edit sends the `revision`
  it was based on; when the record has changed since, the answer is
  `409 STALE_REVISION` with `current` (the record as it is now), so the form
  can merge instead of overwriting. Task moves, batch activation and avatar
  changes are not form edits and take no revision.
- **Access.** Every Macroma route requires a signed-in account
  (`guard.signedIn`); there are no Macroma permissions. Who may do what is
  membership and ownership, checked by the server before the body is read:
  - **Workspace member**: listed in `workspace_members` (the owner is one).
  - **Project access**: a direct project member, *or* a member of the
    project's workspace. The same rule covers batches, tasks, comments,
    attachments and releases.
  - **Owner-only** actions are named per route.
  - A resource that does not exist answers 404 with its own code; one that
    exists but cannot be opened answers `403 FORBIDDEN`.
- **Rate limits.** All `/api` requests share a per-client budget
  (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`). Sign-in, registration,
  sign-out, password change and reset, Google, two-factor, avatar uploads and
  task image uploads also count against the strict budget
  (`AUTH_RATE_LIMIT_MAX` per `AUTH_RATE_LIMIT_WINDOW_MS`). The public API
  (`/api/v1`) is outside both and has its own budget per API token
  (`API_RATE_LIMIT_MAX` per `API_RATE_LIMIT_WINDOW_MS`).

## Live updates

`GET /api/events` is a Server-Sent Events stream for the signed-in account.
An event carries **only the topic name**, never data: the page refetches
through the same routes it rendered from, so every access check stays in
those routes. It starts with `stream.ready` (a later one means the stream
resumed, so refetch everything shown) and ends with `stream.ended` when the
session is gone.

| Topic | Sent when | Sent to | Refetch |
|---|---|---|---|
| `workspaces.changed` | a workspace is created, edited or deleted; a member joins, leaves or is removed; an invitation is sent, cancelled or answered | the workspace's members, plus the invitee for invitations | `GET /api/workspaces`, the open `GET /api/workspaces/:id`, `GET /api/invitations`; also `GET /api/projects` (workspace projects come and go with membership) |
| `workspaces.chat` | a chat message is posted | the workspace's members | the open workspace's `GET /api/workspaces/:id/messages` |
| `projects.changed` | a project is created, edited or deleted; a project member is added or removed; a batch is created or activated | accounts with project access (before and after the change) | `GET /api/projects`, the open `GET /api/projects/:id`, its releases view, `GET /api/dashboard` |
| `projects.board-changed` | a task is created, edited, moved or deleted; a comment or image is added or removed; tasks are unassigned because their assignee lost access | accounts with project access | the open board `GET /api/projects/:id/tasks`, the open task `GET /api/tasks/:id` (and its comments or attachments), the releases view, `GET /api/dashboard` |
| `notifications.changed` | a notification is created, read or withdrawn | its recipient | `GET /api/notifications` |
| `auth.account-changed` | the account's profile, roles or permissions changed | that account | `GET /api/auth/me` |

Auth and Users also publish `auth.sessions-changed`, `auth.tokens-changed`, `auth.roles-changed`,
`auth.roles-editing`, `users.changed` and `users.editing` for the account and
admin screens.

## Auth

Sign-in is by email and password, or Google. See [`auth.md`](./auth.md) for
registration policy and limits.

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/auth/csrf` | public | | `{ csrfToken }` |
| `POST /api/auth/register` | public, strict limit | `{ name, email, password (8–100), phone? }` | `{ user: { id, name, email, avatar } }` |
| `POST /api/auth/login` | public, strict limit | `{ email, password }` | `{ twoFactorRequired }`; when `true`, finish with the challenge |
| `POST /api/auth/two-factor/challenge` | public, strict limit | `{ code }` (6 digits) or `{ recovery_code }` | signs in |
| `POST /api/auth/logout` | public | | |
| `GET /api/auth/me` | signed in | | `{ user: { id, name, email, avatar, phone, verified, roles[], permissions[], mustChangePassword } }` |
| `POST /api/auth/change-password` | signed in | `{ current_password, new_password }` | |
| `POST /api/auth/forgot-password` | public, strict limit | `{ email }` | always 200 with the same message, whether or not an account uses the email |
| `POST /api/auth/reset-password` | public, strict limit | `{ token, password }` | |
| `GET /api/auth/google/redirect` | public | | a browser navigation, not a fetch |
| `GET /api/auth/google/callback` | public | | Google's return address |

- **Password reset.** `forgot-password` emails a link to
  `APP_URL/reset-password?token=…`, valid once for 60 minutes; the reset page
  sends the token with the new password. A successful reset signs the account
  out everywhere. A wrong, used or expired token answers
  `400 RESET_TOKEN_INVALID`. Mail goes over SMTP (`MAIL_*`); without
  `MAIL_HOST`, development logs the link instead, and production answers
  `503 MAIL_DISABLED` (an administrator resets the password instead).
- **Google.** The "Sign in with Google" link navigates to
  `/api/auth/google/redirect` (`GOOGLE_SIGN_IN_PATH`). The callback lands on
  `/` signed in, on `/login?two-factor=1` when the account has two-factor
  turned on, or on `/login?google-error=<reason>` with `state`, `denied`,
  `unavailable`, `unverified` (Google has not verified the email) or
  `registration-closed`. Without `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`
  both routes answer `404 GOOGLE_DISABLED`. New Google accounts get an
  unusable random password.
- Account security screens (sessions, two-factor setup, recovery codes) are
  Nara's: `GET/DELETE /api/auth/sessions…`, `/api/auth/two-factor…`.

Codes: `INVALID_CREDENTIALS`, `LOGIN_LOCKED`, `DUPLICATE_EMAIL`,
`INVALID_PASSWORD`, `RESET_TOKEN_INVALID`, `MAIL_DISABLED`, `GOOGLE_DISABLED`,
`NOT_FOUND`; on the security screens also `CURRENT_SESSION`,
`INVALID_TWO_FACTOR_CODE`, `TWO_FACTOR_CHALLENGE_EXPIRED`,
`TWO_FACTOR_DISABLED`, `TWO_FACTOR_ENABLED`, `TWO_FACTOR_LOCKED` and
`TWO_FACTOR_SETUP_REQUIRED`. Role management (`/api/roles`) adds
`DUPLICATE_SLUG`, `PROTECTED_ROLE`, `INVALID_ID` and `STALE_REVISION`.

### API tokens

Personal access tokens let an outside app (a script, Zapier, a server of your
own) call the public API (`/api/v1`) as the account that made the token. The
account manages its tokens from the signed-in app only: these routes take the
session cookie and CSRF token, never a bearer token, so a token cannot make or
revoke tokens. The web client is `createSecurityClient()` from
`src/features/auth/web`: `listTokens()`, `createToken(input)`,
`revokeToken(id)`, `revokeAllTokens()`.

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/auth/tokens` | signed in | | `{ tokens: ApiToken[] }`: working and expired tokens, never revoked ones, newest first |
| `POST /api/auth/tokens` | signed in, strict limit | `{ name (1–80), scope: 'read' \| 'write', expiresInDays?: 1–365 \| null, password }` | `201 { token: ApiToken, secret }` |
| `DELETE /api/auth/tokens/:id` | signed in | | `{ revoked: 1 }`; another account's or an already revoked token answers `404 NOT_FOUND` |
| `POST /api/auth/tokens/revoke-all` | signed in, strict limit | | `{ revoked }`, the number revoked |

`ApiToken` is `{ id, name, prefix, scope, createdAt, expiresAt, lastUsedAt,
expired }`: times are epoch ms, `expiresAt` is `null` for a token that never
expires, `lastUsedAt` is `null` until first use and is updated at most once a
minute, and `prefix` is the secret's first 10 characters (`mcr_` and six more)
so people can tell tokens apart.

- **The secret** (`mcr_` and 43 base64url characters) is in the create answer
  once and never again: only its SHA-256 is stored. Show it with a copy button
  and say it will not be shown again.
- **Password confirmation.** Creating a token asks for the account's current
  `password`, exactly like the two-factor screens, so a stolen session alone
  cannot mint a token that outlives a password reset. A wrong one answers
  `400 INVALID_PASSWORD` ("Password is incorrect"), an empty one
  `422 VALIDATION_ERROR`. An account made through Google has an unusable
  random password, so, as for two-factor, it sets a password first (forgot
  password) and confirms with that.
- **Expiry.** Leaving `expiresInDays` out makes a 90-day token; a token that
  never expires needs `expiresInDays: null`. At most 365 days.
- **Scopes.** `read` calls only `GET` and `HEAD`; `write` calls every method.
- **Limit.** An account holds at most 50 working tokens; the 51st answers
  `409 TOKEN_LIMIT_REACHED`. Expired and revoked tokens do not count.
- **Passwords.** Tokens keep working when the account changes or resets its
  password. While an administrator's temporary password is pending, every
  token answers `403 PASSWORD_CHANGE_REQUIRED` until it is replaced. Deleting
  the account deletes its tokens.
- **Live.** Creating or revoking tokens publishes `auth.tokens-changed` to the
  account, so its other tabs refetch `GET /api/auth/tokens`.

Codes: `INVALID_PASSWORD`, `TOKEN_LIMIT_REACHED`, `NOT_FOUND`.

## Profile

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/users/me` | signed in | | `{ user: profile }` |
| `PATCH /api/users/me` | signed in | `{ revision, name, email, phone? }` | `{ user: profile }` |
| `POST /api/assets/avatar` | signed in, strict limit | multipart, field `file`: JPEG, PNG, GIF or WebP, at most 5 MB | `{ asset, url }` |
| `DELETE /api/users/me/avatar` | signed in | | `{ user: profile }` |

`profile` is `{ id, name, email, avatar, phone, verified, revision }`.
`phone` left out keeps the number; `null` or `""` removes it. An uploaded
avatar is converted to WebP (at most 1200 px), becomes the account's
`avatar` (`/api/assets/avatar/<file>.webp`, public) and replaces the previous
file. Removing it sets `avatar` to `null` and deletes the file. Both raise the
profile's `revision` without asking for one. Password change is
`POST /api/auth/change-password`.

Codes: `DUPLICATE_EMAIL`, `STALE_REVISION`, `NOT_FOUND`; the avatar upload
adds `FILE_REQUIRED`, `FILE_TOO_LARGE`, `INVALID_FILE_TYPE`, `INVALID_OUTPUT`
(the converted image was not a valid WebP) and `UPLOAD_FAILED`.

## Users (admin)

Gated by Nara permissions; the `admin` role passes every check.

| Method and path | Permission | Body / query | `data` |
|---|---|---|---|
| `GET /api/users` | `users.view` | `?page&limit&search&filter=all\|verified\|unverified` | `{ users: managedUser[], total, page, limit }` |
| `POST /api/users` | `users.create` | `{ name, email, password, roles?, phone?, verified? }` | `{ user }` |
| `PUT /api/users/:id` | `users.edit` (or the account itself) | `{ revision, name?, email?, roles?, phone?, verified? }` | `{ user }` |
| `POST /api/users/:id/reset-password` | `users.reset-password` | `{ password }` | signs the account out everywhere |
| `DELETE /api/users` | `users.delete` | `{ ids: [...] }` | `{ deleted }` |
| `GET /api/users/editing`, `PUT/DELETE /api/users/:id/editing` | `users.view` / `users.edit` | | who has an edit form open |

`managedUser` is `profile` plus `roles` (slugs). Only an administrator assigns
roles. Deleting accounts also removes what V1's foreign keys removed: the
workspaces and projects they own (with everything inside, including images),
their memberships, invitations and chat messages; their name comes off tasks,
logs, comments, images and activity (`null` person).

Codes: `DUPLICATE_EMAIL`, `LAST_ADMIN`, `PROTECTED_ADMIN`, `SELF_DELETE`,
`SELF_DEMOTION`, `STALE_REVISION`, `NOT_FOUND`, `INVALID_ID`, and
`CURRENT_PASSWORD_REQUIRED` when an administrator resets their own password
through `POST /api/users/:id/reset-password` (they use
`POST /api/auth/change-password` instead).

## Dashboard

`GET /api/dashboard`, signed in, over every project the account can open.

```text
data: {
  stats: {
    workspace_count, project_count,
    counts: { backlog, ongoing, revisi, review, done }, active_project_count, total,
    done_this_week, done_last_week, ongoing_mine, revisi_repeated
  },
  trends: [{ day: 'YYYY-MM-DD', workspace, project, active, done }],   // 7 days, today last
  tasks_per_project: [{ project_id, name, count }],                     // most tasks first
  board_health: [{ project_id, name, workspace_id, active_batch: batchRef | null,
                   counts, total, done }],
  recent_activity: [activity & { project_id }],                         // latest 8; activity as in Projects, with task_title and batch_version
  projects: [{ id, name, workspace_id }]                                // newest first
}
```

- **Days and weeks are counted in `APP_TIMEZONE`** (an IANA name, default
  `Asia/Jakarta`), not in the server's time zone, so a server running in UTC
  still starts the day at midnight WIB. A week starts on **Monday 00:00**.
  See [`deployment.md`](./deployment.md).
- `done_this_week`: tasks now in `done` whose latest move into `done` happened
  since this Monday 00:00. `done_last_week`: the same for the Monday-to-Monday
  week before.
- `counts`: every task of the account's projects per column, whatever its
  batch. Active = `ongoing`, `revisi`, `review` across all batches (batch-less
  tasks included), matching `trends[].active`: the active tasks ("Task aktif")
  are `counts.ongoing + counts.revisi + counts.review`.
- `active_project_count`: how many of the account's projects have at least one
  active task (`ongoing`, `revisi`, `review` across all batches), from the same
  counts, so "N active tasks in M projects" always agrees (`0` when there are
  no active tasks). Projects with only `backlog` or `done` tasks do not count.
- `ongoing_mine`: tasks in `ongoing` assigned to the signed-in account.
- `revisi_repeated`: tasks in `revisi` that moved to `revisi` more than once.
- `trends`: each value as it stood at the end of that day. `workspace` counts
  the account's workspaces created by then, `project` its projects created by
  then, `active` the tasks in `ongoing`, `revisi` or `review` and `done` the
  tasks in `done`, each task by its latest move that day or before.
- `board_health`: per project, the active batch's tasks by column, or every
  task of the project when no batch is active.
- The UI derives a project's colour square from its id; there is no colour
  field.

Refetch on `projects.changed`, `projects.board-changed` and
`workspaces.changed`.

## Workspaces

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/workspaces` | signed in | | `{ workspaces: workspaceSummary[] }` |
| `POST /api/workspaces` | signed in | `{ name, description? }` | `{ workspace }` (201) |
| `GET /api/workspaces/:id` | member | | `{ workspace: workspaceSummary, members[], invitations[] }` |
| `PATCH /api/workspaces/:id` | owner | `{ revision, name?, description? }` | `{ workspace }` |
| `DELETE /api/workspaces/:id` | owner | | |
| `POST /api/workspaces/:id/invitations` | member | `{ email }` | `{ invitation }` (201) |
| `DELETE /api/workspaces/:id/invitations/:invitationId` | owner | | |
| `DELETE /api/workspaces/:id/members/:userId` | owner, or the member leaving | | |
| `GET /api/invitations` | signed in | | `{ invitations: receivedInvitation[] }` |
| `POST /api/invitations/:token/respond` | the invited account | `{ action: 'accept' \| 'decline' }` | `{ workspace_id, status }` |

- `workspace` is `{ id, name, description, owner_id, revision, created_at, updated_at }`;
  `workspaceSummary` adds `role` (`owner`/`member`), `member_count`, `project_count`.
- `members[]`: `{ user: { id, name, email, avatar }, role, joined_at }`.
- `invitations[]` (pending ones): `{ id, invitee_email, inviter, status, expires_at, created_at }`.
- `receivedInvitation`: the signed-in account's pending invitations,
  `{ id, token, workspace: { id, name }, inviter, expires_at, created_at }`.
- **Inviting** needs an existing account with that email, which is not a
  member and has no pending invitation. The invitation lasts 7 days and sends
  the invitee a `workspace_invitation` notification
  (`{ workspace_id, workspace_name, inviter_name, token }`). Cancelling or
  answering it withdraws that notification. Accepting adds the account as a
  member and sends the inviter `invitation_accepted`
  (`{ workspace_id, workspace_name, accepter_name }`).
- **Deleting** a workspace keeps its projects: they lose their workspace
  (`workspace_id` becomes `null`, as V1's `SET NULL`), and accounts that only
  had access through the workspace lose it. The same happens to a member who
  leaves or is removed; tasks assigned to someone who can no longer open the
  project are unassigned.
- A workspace's projects are `GET /api/projects?workspace_id=:id`.

Codes: `WORKSPACE_NOT_FOUND`, `ACCOUNT_NOT_FOUND`, `ALREADY_MEMBER`,
`INVITATION_PENDING`, `INVITATION_NOT_FOUND`, `INVITATION_NOT_PENDING`,
`INVITATION_EXPIRED`, `MEMBER_NOT_FOUND`, `OWNER_CANNOT_LEAVE`,
`STALE_REVISION`. Live: `workspaces.changed`.

### Workspace chat

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/workspaces/:id/messages` | member | | `{ messages[] }`: the latest 50, oldest first |
| `POST /api/workspaces/:id/messages` | member | `{ message }` (1–2000 characters) | `{ message }` (201) |

A message is `{ id, workspace_id, message, user: person | null, created_at }`.
Live: `workspaces.chat`. V1 never tracked who read the chat, so there is no
unread count.

## Projects

| Method and path | Access | Body / query | `data` |
|---|---|---|---|
| `GET /api/projects` | signed in | `?workspace_id` | `{ projects: projectSummary[] }`, newest first |
| `POST /api/projects` | signed in (member of `workspace_id`, if given) | `{ name, description?, workspace_id? }` | `{ project }` (201) |
| `GET /api/projects/:id` | project access | | `{ project: projectSummary, batches: batch[], active_batch: batch \| null, members[] }` |
| `PATCH /api/projects/:id` | owner | `{ revision, name?, description? }` | `{ project }` |
| `DELETE /api/projects/:id` | owner | | also deletes its images |
| `POST /api/projects/:id/members` | owner | `{ email }` | `{ member }` (201) |
| `DELETE /api/projects/:id/members/:userId` | owner | | |
| `GET /api/projects/:id/activity` | project access | | `{ activity[] }`: the latest 50, newest first |

- `project` is `{ id, name, description, owner_id, workspace_id, revision, created_at, updated_at }`.
- `projectSummary` adds `role` (the signed-in account's: `owner`, or `member`
  through the project or its workspace), `active_batch: { id, major, minor, label } | null`,
  `task_counts` (every task by column) and `member_count` (distinct accounts with access).
- `members[]`: `{ user: { id, name, email, avatar }, role, source }`, where
  `source` is `project` for a direct member or `workspace` for access through
  the workspace. Only direct members can be removed; removing one who has no
  workspace way in unassigns their tasks.
- `activity[]`: `{ id, event_type, description, actor: { id, name, avatar } | null, task_id, batch_id, task_title, batch_version, meta, created_at }`.
  `event_type` is one of `project.created`, `task.created`, `task.moved`,
  `task.updated`, `task.deleted`, `batch.created`, `batch.activated`,
  `task.attachment_added`, `task.attachment_removed`.
  - `task_title` (`string | null`): on `task.*` events, the task's title when
    the event happened, kept after the task is deleted (then `task_id` is
    `null`). Rows recorded without it fall back to the task's current title.
    `null` when neither exists, and on every other event.
  - `batch_version` (`string | null`): on `batch.created` and
    `batch.activated`, the batch's `major.minor` like `1.8` (no `v`),
    recorded with the event, else the batch's current one. `null` on every
    other event.
  - `meta` is the recorded detail: `{ version }` on `task.created`,
    `{ from, to, note, version }` on `task.moved`, `{ count }` and
    `{ attachment_id }` on the image events, `{ adopted_task_count }` on the
    entry of a project's first activation that adopted tasks (`batch.created`
    of a batch created active, else `batch.activated`), plus the recorded `task_title`
    or `batch_version`. It is `null` when nothing was recorded. Read the two
    names from the top-level fields, which also cover older rows.
  `description` is English text. V1 rows with
  an event type V2 does not have, `task.log_added` (written by V1's old +Log
  button, removed in V1 on 2026-08-04), are left out by the V1 import.

Codes: `PROJECT_NOT_FOUND`, `ACCOUNT_NOT_FOUND`, `ALREADY_MEMBER`,
`MEMBER_NOT_FOUND`, `OWNER_CANNOT_BE_REMOVED`, `STALE_REVISION`. Live:
`projects.changed`.

## Batches

A batch is a release version `vMAJOR.MINOR` of a project; at most one is
active at a time. New tasks go into the active batch.

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/projects/:id/batches` | project access | | `{ batches: batch[] }`, newest version first |
| `POST /api/projects/:id/batches` | project access; `activate: true` owner only | `{ label?, bump_major?, activate? }` | `{ batch }` (201) |
| `PATCH /api/projects/:id/batches/:batchId/activate` | owner | | `{ batch }` |

- `batch` is `{ id, major, minor, label, project_id, is_active, created_at, updated_at, counts, total }`:
  `counts` are the batch's tasks per column (`backlog`, `ongoing`, `revisi`,
  `review`, `done`) for the board's batch strip (stacked bar, legend,
  done/total).
- **Numbering.** A new batch follows the project's highest version: the next
  minor (`v0.4` → `v0.5`), or with `bump_major` the next major at minor 0
  (`v0.4` → `v1.0`). A project's first batch is `v0.1`, or `v1.0` with
  `bump_major`.
- **First activation adopts earlier tasks.** A task created while the project
  has no active batch goes in no batch, on `v0.0.x`. The project's **first**
  activation (no batch of it was ever active), by `activate: true` on create
  or by the activate route, moves every batch-less task of the project into
  the batch it activates, in the same transaction. Creating a batch without
  `activate` moves nothing:
  - in version order, each task gets the batch's next patch (`v0.1.1`,
    `v0.1.2`, … or `v1.0.1`, … with `bump_major`), its `revision` goes up by
    one, and its column stays;
  - each task gets a version-log entry with `column_from` equal to
    `column_to` and the note `Moved into batch v0.1`. Such entries are not
    moves, so `revisi_count`, `done_this_week`/`done_last_week`,
    `revisi_repeated` and the releases' revisi count leave them out;
  - the activity entry of the activation records `meta.adopted_task_count`:
    `batch.created` when the batch is created active, else `batch.activated`;
  - `projects.board-changed` is sent as well as `projects.changed`.
  Later activations move nothing, nor do the activations of an imported V1
  project that already had an active batch. Creating a task without a batch
  stays allowed (V1 imports can have batch-less tasks too).
- **Bump version** (the design's owner-only "Bump versi"): `activate: true`
  creates the batch and makes it the active one in one step, which closes the
  batch that was active.
- **Activating** a batch makes it the only active one of its project and
  records the moment (`batch.activated` in the activity). Activating the
  active batch changes nothing. An older batch can be activated again.

Codes: `PROJECT_NOT_FOUND`, `BATCH_NOT_FOUND` (also for a batch of another
project). Live: `projects.changed`.

## Board and tasks

| Method and path | Access | Body / query | `data` |
|---|---|---|---|
| `GET /api/projects/:id/tasks` | project access | `?batch_id` | `{ tasks: task[] }` in column order |
| `POST /api/projects/:id/tasks` | project access | `{ title, description?, priority?, assignee_id?, batch_id? }` | `{ task }` (201) |
| `GET /api/tasks/:id` | project access | | `{ task: taskDetail }` |
| `PATCH /api/tasks/:id` | project access | `{ revision, title?, description?, priority?, assignee_id? }` | `{ task }` |
| `PATCH /api/tasks/:id/move` | project access | `{ column_id, note?, sort_order? }` | `{ task, log }` |
| `DELETE /api/tasks/:id` | owner | | also deletes its images |
| `GET /api/tasks/:id/logs` | project access | | `{ logs: taskLog[] }`, oldest first |

- `task` is `{ id, project_id, batch_id, title, description, priority, assignee: { id, name, avatar } | null, column_id, sort_order, version: { major, minor, patch }, revision, revisi_count, comment_count, attachment_count, created_at, updated_at }`.
  - `revisi_count`: how many times the task moved to `revisi` (the cards'
    "back from review · N×"). `comment_count` and `attachment_count` feed the
    card footer. All three are counted at read time, for the whole board in
    one query.
  - `priority` is `low`, `medium` (default) or `high`; `column_id` is
    `backlog`, `ongoing`, `revisi`, `review` or `done`.
- `taskDetail` adds `project: { id, name }`, `batch: batchRef | null`,
  `created_by` (from the first log) and `logs` (every version, oldest first).
- `taskLog` is `{ id, version: 'v0.2.3', column_from, column_to, note, user, created_at }`.
- **Versions.** A task's version is `vMAJOR.MINOR.PATCH` of its own batch, and
  every create and every move takes the batch's next patch number and writes a
  log. A task outside any batch counts on the project's `v0.0.x` counter.
- **Create.** Without `batch_id` the task goes into the active batch (or no
  batch). The assignee must be able to open the project, else
  `422 VALIDATION_ERROR` on `assignee_id`.
- **Edit** is a form edit with `revision`; `assignee_id: null` unassigns.
- **Move.** `revisi` needs a `note` (what has to change). Moving into the
  column the task is in answers `409 TASK_ALREADY_IN_COLUMN`. Without
  `sort_order` the task goes last. A move sends a `task_moved` notification
  (see Notifications) to the task's assignee and its creator, once each,
  never to the account that moved it. A refused move sends none, and
  creating, editing or deleting a task sends none.

Codes: `PROJECT_NOT_FOUND` (board and create), `TASK_NOT_FOUND`,
`BATCH_NOT_FOUND`, `TASK_ALREADY_IN_COLUMN`, `STALE_REVISION`. Live: `projects.board-changed`.

### Comments

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/tasks/:id/comments` | project access | | `{ comments[] }`, oldest first |
| `POST /api/tasks/:id/comments` | project access | `{ content }` (1–2000 characters) | `{ comment }` (201) |
| `DELETE /api/tasks/:id/comments/:commentId` | the author or the project owner | | |

A comment is `{ id, task_id, content, user: { id, name, avatar } | null, created_at }`.
Codes: `TASK_NOT_FOUND`, `COMMENT_NOT_FOUND`.

### Image attachments

| Method and path | Access | Body | `data` |
|---|---|---|---|
| `GET /api/tasks/:id/attachments` | project access | | `{ attachments[] }`, oldest first |
| `POST /api/task-attachments?task_id=:id` | project access, strict limit | multipart, field `files`, up to 8 | `{ attachments[], errors[] }` (201) |
| `GET /api/tasks/:id/attachments/:attachmentId/file` | project access | | the WebP image |
| `DELETE /api/tasks/:id/attachments/:attachmentId` | the uploader or the project owner | | also deletes the file |

- An attachment is `{ id, task_id, name, mime_type: 'image/webp', size, url, uploaded_by, created_at }`.
  `url` is the guarded `…/file` route: only accounts that can open the project
  see the image (`Cache-Control: private`).
- Each file is JPEG, PNG, GIF or WebP of at most 5 MB, converted to WebP
  (at most 1600 px). Files that fail come back in `errors` while the others
  upload; when none uploads, the answer is `422 NO_FILES_PROCESSED` with
  `errors.files`.
- **Why `/api/task-attachments`.** The upload has its own static path so it
  can carry its own body budget (8 × 5 MB plus multipart overhead) and the
  strict rate limit; route policies are declared per path, and every other
  `/api` route keeps the small default body limit. The task is named in the
  query and checked (404, then 403) before the body is read.

Codes: `TASK_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `NO_FILES_PROCESSED`.

## Releases (Rilis tab)

| Method and path | Access | `data` |
|---|---|---|
| `GET /api/projects/:id/releases` | project access | `{ active, closed[], upcoming[] }` |
| `GET /api/projects/:id/releases/:batchId` | project access | `{ batch, stats, changelog[], contributors[] }` |

How the values are computed (all at read time, nothing stored):

- **Released, closed, planned.** A batch is *released* when it is activated
  and *closed* when another batch is activated after it. A batch created but
  never activated is *planned*. Release order is activated batches by their
  latest activation, then planned batches by creation.
  - `opened_at`: the batch's latest activation.
  - `closed_at`: the activation of the batch that followed it in release order.
  - Re-activating an older batch reopens it: it becomes active again with a
    new `opened_at`, and the batch it replaced closes at that moment.
- `active`: `{ id, major, minor, label, opened_at, counts, total, done, progress }`,
  or `null`. `progress` is `done / total` as a rounded whole percentage
  (0 for an empty batch).
- `closed[]`: released batches that are no longer active, latest activation
  first: `{ id, major, minor, label, opened_at, closed_at, task_count, major_bump }`.
  `major_bump` is `true` when the major version differs from the previous
  batch's in release order (`false` for the first).
- `upcoming[]`: planned batches, oldest first:
  `{ id, major, minor, label, created_at, task_count, major_bump }`.
- Detail `batch`: `{ id, major, minor, label, created_at, opened_at, closed_at, task_count, major_bump, is_active }`;
  `opened_at` is `null` for a planned batch, `closed_at` for the active or a
  planned one.
- `stats`: `{ task_count, duration_days, revisi_task_count }`.
  `duration_days` is the whole days from opening to closing, rounded up
  (`null` until closed). `revisi_task_count` is the batch's tasks that moved
  to `revisi` at least once.
- `changelog[]`: the batch's tasks, latest version first:
  `{ task_id, title, priority, version, assignee, column_id }`.
- `contributors[]`: accounts that are assigned to, or logged a change on, the
  batch's tasks: `{ user: { id, name, email, avatar }, task_count }`, where
  `task_count` counts distinct tasks; most tasks first.

Codes: `PROJECT_NOT_FOUND`, `BATCH_NOT_FOUND` (also for a batch of another project). Live:
`projects.changed` and `projects.board-changed`.

## Notifications

| Method and path | Access | `data` |
|---|---|---|
| `GET /api/notifications` | signed in | `{ notifications[], unread_count }`: the latest 30, newest first |
| `POST /api/notifications/:id/read` | the recipient | |
| `POST /api/notifications/read-all` | signed in | |

A notification is `{ id, type, data, is_read, created_at }`; `data` is a flat
object whose fields depend on `type` (see Workspaces for
`workspace_invitation` and `invitation_accepted`). Code:
`NOTIFICATION_NOT_FOUND`; someone else's notification is `403 FORBIDDEN`.
Live: `notifications.changed`.

`task_moved` (Projects, `PROJECTS_NOTIFICATION_TYPES.taskMoved`) is sent when
`PATCH /api/tasks/:id/move` succeeds, in the same transaction as the move, to
the task's assignee and its creator (who wrote its first task log), once each
when they are the same account, never to the account that moved it, and only
to accounts that still exist and can open the project. Each recipient alone
gets `notifications.changed`. Its `data` (`TaskMovedNotificationData`, schema
`projectsResponseSchemas().taskMovedNotificationData`):

| Field | Type | Value |
|---|---|---|
| `project_id` | string | the task's project |
| `project_name` | string | the project's name at the time of the move |
| `task_id` | string | the moved task |
| `task_title` | string | the task's title at the time of the move |
| `version` | string | the task's new version, like `v1.2.3` (the move's log `version`) |
| `column_from` | `backlog` · `ongoing` · `revisi` · `review` · `done` | the column it left |
| `column_to` | same as `column_from` | the column it entered |
| `actor_id` | string | the account that moved it |
| `actor_name` | string | that account's name, or its email when the name is empty |

## V1 pages → V2 endpoints

| V1 page | V2 calls |
|---|---|
| `auth/login`, `auth/register` | `POST /api/auth/login` (+ `two-factor/challenge`), `POST /api/auth/register`, `GET /api/auth/google/redirect` |
| `auth/forgot-password`, `auth/reset-password` | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| `dashboard` | `GET /api/dashboard`, `GET /api/notifications` |
| `workspaces` | `GET /api/workspaces`, `POST /api/workspaces`, `GET /api/invitations`, `POST /api/invitations/:token/respond` |
| `workspace` | `GET/PATCH/DELETE /api/workspaces/:id`, invitations, members, `GET/POST …/messages`, `GET /api/projects?workspace_id=` |
| `projects` | `GET /api/projects`, `POST /api/projects` |
| `project-board` | `GET /api/projects/:id`, `GET …/tasks`, `…/batches`, `…/activity`, `…/releases`, `POST/DELETE …/members` (members come with `GET /api/projects/:id`); `/api/tasks/:id…` for the task modal, comments and images; `POST /api/task-attachments` |
| `users` | `/api/users…`, `/api/roles…` |
| `profile` | `GET/PATCH /api/users/me`, `POST /api/assets/avatar`, `DELETE /api/users/me/avatar`, `POST /api/auth/change-password` |
| every page's layout | `GET /api/auth/me`, `GET /api/workspaces`, `GET /api/projects`, `GET /api/notifications`, `GET /api/events` |

## Changes vs V1

**Routes.**
- V1 rendered pages with Inertia and posted to page paths; V2 is a JSON API
  under `/api`, and the pages are the separate V2 UI.
- The navigation data V1 merged into every page (`buildNavData`) is gone; the
  layout calls `GET /api/workspaces` and `GET /api/projects`.
- `POST /change-profile` → `PATCH /api/users/me`;
  `POST /change-password` → `POST /api/auth/change-password`;
  `POST /assets/avatar` → `POST /api/assets/avatar`;
  `PATCH /notifications/:id/read` → `POST /api/notifications/:id/read`;
  `POST /notifications/mark-all-read` → `POST /api/notifications/read-all`;
  `POST /workspaces/:id/invite` → `POST /api/workspaces/:id/invitations`;
  `POST /tasks/:id/attachments` → `POST /api/task-attachments?task_id=`;
  `/google/redirect` → `/api/auth/google/redirect`.

**Behaviour dropped or changed.**
- Messages are English (V1 mixed in Indonesian); the UI shows `message` and
  branches on `code`.
- Sign-in is by email only (V1's unused phone login is gone); `phone` stays a
  profile field.
- Realtime: V1 sent WebSocket events with data on `project:<id>`,
  `workspace:<id>` and `user:<id>`; V2 sends payload-free SSE topics and the
  page refetches.
- Images were public files under `/storage/…`; task images are now served only
  to accounts that can open the project. Avatars stay public, at
  `/api/assets/avatar/<file>`.
- Project access is the same everywhere (project member or workspace member);
  V1 used strict project membership for batches only and copied workspace
  members into every project on accepting an invitation. V2 does not copy.
- Google accounts no longer have their email as password, Google emails must
  be verified, and Google sign-in honours two-factor.

**Added for the V2 design.**
- Releases: `GET /api/projects/:id/releases` and `…/releases/:batchId`.
- Derived counts: `revisi_count`, `comment_count`, `attachment_count` on every
  task; per-batch `counts`/`total`; `task_counts` and `member_count` on
  projects; board health, `done_this_week`/`done_last_week`, `ongoing_mine`
  and `revisi_repeated` on the dashboard.
- Task edit (`PATCH /api/tasks/:id`), bump-and-activate
  (`POST …/batches` with `activate: true`), password reset by email, and
  `GET /api/tasks/:id` for the task modal.
- `revision` + `409 STALE_REVISION` on workspace, project and task edits.

**Data model.**
- `users.is_verified` → `verified`; `users.phone` kept.
- `revision` columns on workspaces, projects and tasks.
- No foreign keys into Auth's `users`: deleting accounts runs each Feature's
  `forgetAccounts`, which reproduces V1's `CASCADE`/`SET NULL`. Inside a
  Feature, foreign keys work as in V1.
- `project_batches.activated_at` records the latest activation; the release
  view reads it.
- New index `task_logs(task_id, column_to)` for the derived counts.

**V1 data** can be imported, see below.

## Importing a V1 database

```bash
npm run migrate          # the target must be fully migrated; `npm run seed` adds the admin role
npm run import:v1 -- --from /path/to/v1/database/dev.sqlite3 --storage /path/to/v1/storage --dry-run
npm run import:v1 -- --from /path/to/v1/database/dev.sqlite3 --storage /path/to/v1/storage
```

- The V1 database is never opened in place: it is copied with its `-wal` and
  `-shm` files and the copy is opened read-only.
- It refuses, writing nothing, when the source is not a complete V1 schema,
  the target has pending migrations, the target already holds workspaces,
  projects or notifications, or a V1 email already has an account (all are
  listed).
- Everything is written in one transaction; `--dry-run` rolls it back and
  prints the same report: rows per table, skipped V1 tables (`sessions`,
  `password_reset_tokens`) and warnings.
- Accounts keep their ids, password hashes and timestamps, so passwords keep
  working. V1 Google accounts get an unusable password and sign in with
  Google or a password reset.
- Roles: V1 `user` becomes a plain account, a slug V2 already has maps to that
  role, and any other role is created with only the permissions V2 knows (the
  rest are warned about).
- Avatars and task images are copied from `--storage` (without it, no file is
  imported and a warning says so). An image whose file is missing is skipped
  with a warning.
- Values the V2 responses do not accept are fixed or left out, each counted
  as a warning in the report: activity entries of event types V2 does not
  have (`task.log_added`, from V1's old +Log button, removed in V1 on
  2026-08-04) are skipped and counted per type; activity `meta` that is not a JSON object is
  emptied; unknown columns on tasks and task logs become `backlog` and
  unknown priorities `medium`; invitations with a status V2 does not have
  and notification data fields that are not flat values are left out.
- Each imported activity entry records the `task_title` and `batch_version`
  it names in its `meta`, from the imported task or batch, so the names
  outlive later deletes. For a task deleted in V1 (its `task_id` is `NULL`),
  the title comes from V1's description, `Task "<title>" dibuat` or
  `Task "<title>" dipindah dari …`; any other entry whose task or batch V1 no
  longer had keeps `null`.
- Batch activation times come from V1's `batch.activated` activity entries
  (the latest per batch); a batch with none falls back to its creation order.
  The batch active in V1 stays active.
