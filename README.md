<div align="center">

# Macroma

**Project management for teams that care about versions.**

A Kanban board where every task keeps its own version history, grouped into
batch releases you can track.

[![CI](https://github.com/MasRama/macroma-pm-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/MasRama/macroma-pm-v2/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Built with Nara](https://img.shields.io/badge/built%20with-Nara-6366f1)](https://github.com/MasRama/nara)

</div>

## Status

Macroma V2 is a rewrite of [Macroma V1](https://github.com/MasRama/macroma-pm)
on [Nara](https://github.com/MasRama/nara) 3.5: Hono, Vue 3 and SQLite. V1's
features are being ported now and have not been released yet. The first V2
release will be 2.0.0; see [`CHANGELOG.md`](./CHANGELOG.md).

## What Macroma does

- **Kanban board** with four columns: Backlog, On Going, Revisi and Done.
- **Version history per task.** Moving or updating a task raises its version
  (`v1.2.3`) and keeps a permanent log of what changed and who changed it.
- **Batch releases.** Group tasks into a batch (`v1.0`, `v2.0`) and track its
  release.
- **Workspaces and projects** with invitations and per-workspace access.
- **Task comments, activity feed and workspace chat.**
- **Sign-in** with email and password or Google.

## Quick start

Macroma needs Node.js 22 or newer.

```bash
git clone https://github.com/MasRama/macroma-pm-v2.git
cd macroma-pm-v2
npm ci
cp .env.example .env
npm run setup
npm run dev
```

Open <http://localhost:5555> and sign in as `admin@nara.local` /
`admin12345`. `npm run setup` applies the migrations and seeds and creates that
first administrator; the password is temporary and must be changed on first
sign-in. Set `NARA_ADMIN_NAME`, `NARA_ADMIN_EMAIL` and `NARA_ADMIN_PASSWORD`
before setup to choose your own.

## Development

```bash
npm run dev          # Vite and the Hono API on one origin, port 5555
npm run verify       # what pull-request CI runs; also the pre-push hook
npm run check        # the full gate main CI runs after a merge
npm run build && npm start
```

Code is organised by feature under `src/features/<name>/`, following Nara's
architecture rules: [`ARCHITECTURE.md`](./ARCHITECTURE.md) and
[`docs/feature-model.md`](./docs/feature-model.md). `npm run nara -- doctor`
checks the boundaries.

## Production

Macroma runs as one Node process with one SQLite file, behind a reverse proxy
such as Caddy that holds the TLS certificate.

```bash
cp .env.production.example .env.production
npm ci
npm run build
npm start
```

Behind a proxy set `HOST=127.0.0.1` and `TRUST_PROXY=true`. The database is
backed up every 24 hours into `database/backups/`; copy that directory off the
host. [`docs/deployment.md`](./docs/deployment.md) walks through a full
deployment and [`docs/database-lifecycle.md`](./docs/database-lifecycle.md)
covers migrations, backups and restores.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md): the architecture rules
- [`docs/feature-model.md`](./docs/feature-model.md): feature ownership and boundaries
- [`docs/macroma-api.md`](./docs/macroma-api.md): the Macroma API per screen, changes from V1, importing V1 data
- [`docs/auth.md`](./docs/auth.md): sign-in, roles and limits
- [`docs/cli.md`](./docs/cli.md): the `nara` CLI
- [`docs/deployment.md`](./docs/deployment.md): production behind Caddy or nginx
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): setup, pull requests, commit messages and releases
- [`SECURITY.md`](./SECURITY.md): reporting a vulnerability and the security model
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

## License

[MIT](./LICENSE). Built by [MasRama](https://github.com/MasRama).
