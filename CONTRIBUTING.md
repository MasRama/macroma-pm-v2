# Contributing to Macroma

Thanks for helping. This file covers setup, what a good change looks like,
how pull requests are checked and how releases work.

## Before you start

- For a bug, open an issue with the steps to reproduce it, unless the fix is
  small and obvious.
- For a new feature, open an issue first so it is agreed on before code.
- Security vulnerabilities never go in a public issue: follow
  [`SECURITY.md`](./SECURITY.md).

## Setup

You need Node.js 22 or newer and npm 10.9.8, the one Node.js 22 ships with.

```bash
npm ci
cp .env.example .env
npm run setup
git config core.hooksPath .githooks
npm run dev
```

The last `git config` line turns on the pre-push hook in
[`.githooks/pre-push`](./.githooks/pre-push). Run it once per clone. The hook
runs `npm run verify`, the same command pull-request CI runs, so a push that
would turn CI red stops on your machine instead.

`npm ci` works with npm 10.9.8. Changing a dependency does not: npm 10.9.8
stops with `Cannot read properties of null (reading 'edgesOut')` on this
dependency tree. Run that one step with npm 11 (`npx npm@11 install <package>`)
and check that the lockfile still lists the native builds for every platform
(`@rolldown/binding-darwin-arm64`, `@img/sharp-win32-x64`); CI installs and
builds on macOS and Windows to catch a lockfile that lost them.

## Architecture

Macroma is built on [Nara](https://github.com/MasRama/nara) and follows its
rules. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md),
[`docs/feature-model.md`](./docs/feature-model.md) and [`AGENTS.md`](./AGENTS.md)
before changing structure. In short:

- build by feature under `src/features/<name>/`, not by technical layer;
- keep application-wide composition under `src/app/`;
- never import another feature's internals, only its `index.ts` or
  `web/index.ts`;
- keep server-only code out of browser code;
- enforce access on the server: every `/api` route declares a guard or
  `publicRoute`.

`npm run nara -- doctor` checks these boundaries and runs in CI.

## Every change goes through a pull request

`main` is protected: nothing is pushed to it directly, every pull request
needs green CI before it merges, and its branch must be up to date with
`main`. Create a focused branch from the latest `main`:

```text
feat/kanban-board
fix/task-version-bump
docs/deployment
```

Write commit messages and pull request titles as
[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`perf:`, `refactor:`, `test:`, `docs:`, `build:`, `ci:` or `chore:`. The prefix
decides the next version, and `feat:` and `fix:` subjects land in
`CHANGELOG.md` word for word, so write them for someone who uses Macroma
("let a task move back to Revisi", not "update board controller"). Mark a
breaking change with `!` (`feat!:`) or a `BREAKING CHANGE:` footer. Pull
requests are squash-merged, so the title becomes the commit on `main`.

Commits must be signed so GitHub shows them as Verified.

Do not mix unrelated cleanup into a feature or bug-fix pull request.

## What CI checks

On a pull request:

| Check | What it runs |
| --- | --- |
| App validation | `npm ci`, then `npm run check:fast`: Vue typecheck, the fast Vitest projects, the production build (server TypeScript) and `nara doctor` |
| Install, build and set up (macos-latest) | `npm ci`, `npm run build`, `npm run setup` |
| Install, build and set up (windows-latest) | the same on Windows |

After a merge, CI on `main` runs the full suite (`npm run check:frontend && npm test`),
the build, `nara doctor` and the production serving and startup tests.

Locally, `npm run verify` is the pull-request gate and `npm run check` the
full one. Run the full gate when you change database lifecycle, build or
startup code. Run one heavy command at a time.

## Tests

Add or update tests when behaviour changes, next to the feature that owns it
(`src/features/<name>/tests/`). Do not weaken an existing assertion only to
make a change pass; if a contract changes, change the test and say why in the
pull request.

## Releases

Releases are prepared by
[release-please](https://github.com/googleapis/release-please). Every push to
`main` updates one release pull request that bumps the version in
`package.json` and `package-lock.json` and writes the next section of
`CHANGELOG.md` from the commits since the last release. Merging that pull
request tags the release (`v2.0.0`, `v2.1.0`, ...), publishes it on GitHub and
runs `npm run validate:release` against the tag. The first release is 2.0.0.
Do not edit the version or the changelog by hand.

## License

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](./LICENSE).
