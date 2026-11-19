# Auth in your application

Auth is an official Feature like Users and Activity. Its source lives in your
`src/features/auth`, and `npm run nara -- evolve auth` brings in later fixes
with a three-way merge, keeping any edits you made. The choices below are made
where your application composes Auth, so most applications never need to edit
its source.

## Who may create an account

`createAuthRoutes` takes the registration policy in `src/app/server.ts`:

```ts
// Open (the default): anyone may register, and the new account has no role.
app.route('/api/auth', createAuthRoutes(activity.declare('auth', AUTH_ACTIVITY)));

// Every new account gets the `customer` role.
createAuthRoutes(reporter, { registration: { role: 'customer' } });

// Closed: only an administrator creates accounts, from Users.
createAuthRoutes(reporter, { registration: false });
```

With registration closed, `POST /api/auth/register` answers 404 like a route
that does not exist. Remove the `/register` route from `src/app/router.ts` as
well; the login page offers the register link only while that route exists.
Registration can never grant `admin`.

## Roles your application needs

Declare the roles your application needs while composing it, next to the
permissions your Features declare:

```ts
import { declareRoles } from '../features/auth';

declareRoles([
  { slug: 'customer', name: 'Customer', permissions: ['orders.view', 'orders.create'] },
]);
```

At startup, right after permissions are written, Auth creates each declared
role that is missing, with those permissions. It never edits a role that
already exists: once a role is created, administrators own it from the Roles
page. A permission no Feature declares stops startup, so a typo shows up
straight away. If an administrator deletes a declared role, the next start
creates it again; remove it from the declaration to retire it.

## Your own sign-in pages

Auth's pages (`LoginPage`, `RegisterPage`, `ChangePasswordPage`,
`SecurityPage`) are optional. An application can route its own pages instead,
built on what `src/features/auth/web` exports:

```ts
import { createAuthClient, useAuthSession } from '../features/auth/web';

const client = createAuthClient();
const session = useAuthSession();

const result = await client.login({ email, password });
if (!result.success) showError(result.message);           // branch on result.code, never the text
else if (result.data.twoFactorRequired) goToCodeStep();
else await session.refresh();
```

Keep such pages in `src/app/pages/` or in a Feature of your own, and import
only from `src/features/auth/web`. Auth's internals then stay untouched, and
`nara evolve auth` keeps working. `src/features/auth/tests/app/browser.test.ts`
proves that a page built this way signs in.

## Personal access tokens

The public API (`/api/v1`) authenticates with a personal access token in an
`Authorization: Bearer mcr_…` header. Accounts make and revoke their tokens
from the signed-in app (`/api/auth/tokens`, see
[`macroma-api.md`](./macroma-api.md#api-tokens)); those routes take the
session only, so a token can never make another token. `/api/v1` in turn
ignores session cookies, needs no CSRF token and sets no cookie, and every
other `/api` route ignores the `Authorization` header.

- Making a token re-confirms the account's password (`password` in the body),
  with the same check as the two-factor routes: a wrong one answers
  `400 INVALID_PASSWORD`. An account made through Google, whose password is
  random and unknown, sets one first (forgot password), as for two-factor.
- Only the SHA-256 of a token is stored; its secret is shown once, when it is
  made. `last_used_at` is written at most once a minute.
- A `read` token calls `GET`/`HEAD` only; a `write` token calls every method
  (`403 TOKEN_SCOPE_INSUFFICIENT` otherwise).
- A bad, revoked or expired token answers `401` with `TOKEN_INVALID`,
  `TOKEN_REVOKED` or `TOKEN_EXPIRED` and a `WWW-Authenticate: Bearer` header.
  Revoked and expired tokens are deleted 30 days later, by Auth's maintenance.
- Passwords: a token belongs to the account, not to its password, so changing
  or resetting the password (by email, or an administrator's reset) keeps
  every token working, as on GitHub. While an administrator's temporary
  password is pending, every token answers `403 PASSWORD_CHANGE_REQUIRED`
  until the account replaces it. Deleting the account deletes its tokens; an
  unverified account claimed through Google loses them, like its sessions.
  To cut a token off, revoke it (or all of them).
- An account holds at most 50 working tokens (`409 TOKEN_LIMIT_REACHED`).

## Limits

These are environment settings, defaults shown:

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_LOCKOUT_ATTEMPTS` | `5` | Failed sign-ins per email or IP before a lockout |
| `AUTH_LOCKOUT_WINDOW_MS` | `900000` | How long failures count and the lockout lasts (15 min) |
| `AUTH_RATE_LIMIT_MAX` | `10` | Requests per client, shared across every route a Feature marks sensitive (Auth's login, register, logout, password change, two-factor), per window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | Window for that limit (1 min) |
| `RATE_LIMIT_MAX` | `600` | Requests per client to any `/api` route per window |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Window for that limit (15 min) |
| `API_RATE_LIMIT_MAX` | `120` | Requests per API token to `/api/v1` per window (per client address while the token does not resolve); `/api/v1` is outside the `RATE_LIMIT_MAX` budget |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | Window for that limit (1 min) |

Sessions last 60 days (`SESSION_EXPIRY_MS` in `src/features/auth/server/config.ts`).
