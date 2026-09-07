# Dashboard Convergence Plan

## Why this exists

`greenfieldrobotics/dashboard` is a production operations platform built by another
Greenfield team member and already rolled out. Backbeat should eventually **merge
into it and become one app**, so support is one stack instead of two.

For now the two stay separate. This document lists the refactoring to do in
Backbeat **now**, while the merge is still in the future, so that the merge is
mechanical rather than a rewrite.

**Read this before starting.** It is the task list for that work. Nothing here
requires access to the dashboard repo — every convention Backbeat needs to match
is written out below.

---

## What dashboard is (reference — do not change Backbeat to match all of it)

| Layer | Dashboard | Backbeat today |
|---|---|---|
| Backend | Python 3.11 / Flask 3 / Gunicorn, `create_app()` factory + blueprints | Node / Express |
| Database | **SQL Server** via raw `pyodbc`, no ORM | PostgreSQL 16 via `pg` |
| Cache / queues | Redis + 13 systemd workers | none |
| Auth | Google OAuth (authlib) + admin-provisioned local login, domain-restricted | Passport Google + express-session |
| Frontend | React 18 / Vite / **TypeScript**, hash routing, OpenAPI→TS codegen | React 18 / Vite / plain JS, React Router |
| Migrations | dated idempotent `.sql` in `migrations/sql/`, auto-run at startup | one `initializeDatabase()` with `CREATE TABLE IF NOT EXISTS` |
| Tests | pytest (conftest stubs pyodbc + redis), vitest, Playwright | Jest + Supertest, Playwright |
| Deploy | bare metal `/var/www/html/dashboard`, systemd, `make restart`, **no CI** | Docker, Railway, GitHub Actions |

**The shape of the problem.** The frontend is nearly all portable; the backend is
nearly none of it. So the prep work is: make the frontend match dashboard exactly,
and make the backend's *seams* match so a future Flask port is mechanical.

Useful conventions dashboard already shares with Backbeat: raw SQL with no ORM,
one file per domain, Google OAuth against `@greenfieldrobotics.com`, React + Vite.

---

## Tasks, in order

Each task is independently shippable. Do them one per branch with tests passing —
see the Claude Code Instructions in `CLAUDE.md`. Do not batch them into one PR.

### 1. Move all SQL out of `routes/` and into `services/`

**Highest leverage item. Do this first.** SQL is currently spread through route
handlers, so a future dialect change means editing every route file.

Current distribution of SQL statements:

| Location | Statements |
|---|---|
| `modules/stash/routes/` | 68 |
| `modules/stash/services/` | 7 |
| `core/locations/` | 8 |
| `modules/gear/routes/` | 5 |
| `core/dashboard/` | 6 |
| `core/users/` | 4 |
| `core/auth/` | 3 |

**Target:** zero SQL statements under any `routes/` directory. Routes parse and
validate the request, call a service, and shape the response. Services own all SQL.

- Every module gets services covering its domain, not just the two that exist
  (`stash/services/inventoryService.js`, `gear/services/assetService.js`).
- `core/{users,locations,dashboard}` get the same treatment.
- Keep the existing convention: service functions take a `client` as their first
  argument when they must compose inside a caller's transaction. This is what makes
  `workflows/` work — do not break it.
- Behaviour must not change. The 22 server tests and 15 E2E specs are the contract;
  they should pass untouched. If a test needs editing, that is a signal the refactor
  changed behaviour — stop and reconsider.

### 2. Extend `db/connection.js` into a query helper layer

Mirror the names and semantics of dashboard's `core/database.py`, so the future port
translates function-for-function:

| Backbeat helper | Behaviour |
|---|---|
| `executeSql(sql, params)` | query returning rows; logs and returns `[]` on failure |
| `executeSqlStrict(sql, params)` | query that **propagates** failure to the caller |
| `executeSqlWrite(sql, params)` | statement not expected to return rows |
| `executeSqlInsert(sql, params)` | insert returning the new id |

Services call these, never `pool.query` directly. Keep `getClient()` for
transactions. Dashboard's rule applies here too: **SQL failures are not a normal
control path** — do not use caught SQL errors for feature detection.

### 3. Stop writing SQL that cannot cross to SQL Server

Do not migrate to SQL Server. Just stop adding constructs that would need rewriting.
Current counts in `server/src`:

| Construct | Count | SQL Server equivalent |
|---|---|---|
| `$1` placeholders | 282 | `?` (pyodbc positional) |
| `SERIAL` | 26 | `IDENTITY(1,1)` |
| `NOW()` | 19 | `GETDATE()` / `SYSDATETIME()` |
| `RETURNING` | 14 | `OUTPUT` clause |
| `ON CONFLICT` | 8 | `MERGE` / `IF EXISTS` |
| `LIMIT` | 7 | `TOP` / `OFFSET…FETCH` |
| `ILIKE` | 1 | `LOWER()` or a case-insensitive collation |

Once task 1 and 2 are done these are concentrated in the service layer and the
schema files, which is the point — the port then rewrites one layer.

Placeholders are the exception worth handling now: 282 of them is the single
largest mechanical cost. Consider having the helpers in task 2 accept `?` and
translate to `$n` internally, so service code is already written in the portable
style.

### 4. Align the `users` table with dashboard's `Ops_Users`

This is the one table certain to be shared after the merge — both apps authenticate
the same staff against the same Google domain. Matching now makes the merge a data
migration instead of a schema redesign.

Dashboard's columns:

```
user_id               INT IDENTITY PRIMARY KEY
email                 VARCHAR(255) UNIQUE NOT NULL
name                  VARCHAR(255) NOT NULL
role                  VARCHAR(50) DEFAULT 'user'
username              VARCHAR(64) NULL
password_hash         VARCHAR(255) NULL
is_disabled           BIT NOT NULL DEFAULT 0
credential_updated_at DATETIME2 NULL
created_by            VARCHAR(255) NULL
created_at            DATETIME DEFAULT GETDATE()
last_login            DATETIME NULL
```

Adopt the column names and semantics (Postgres types are fine — `BOOLEAN` for
`is_disabled`, `TIMESTAMPTZ` for the timestamps). `username` / `password_hash`
support dashboard's admin-provisioned local login; add the columns as nullable even
though Backbeat does not use local login yet. Honour `is_disabled` in the auth
middleware. Add tests for disabled-user rejection and `last_login` updates.

### 5. Single settings module

Dashboard's law: `config/settings.py` is the only place env vars are read, and the
app **refuses to start** when a required one is missing.

Create `server/src/config/settings.js` as the single source of truth, exporting
typed, validated values. No `process.env` reads anywhere else in `server/src`.
Provide `requireEnv()` semantics that throw at startup with a clear message naming
the missing variable. Keep the existing dev/test auth bypass behaviour intact — see
`core/auth/authMiddleware.js`.

### 6. Adopt dashboard's API response and request conventions

These make the frontend indifferent to what language the backend is written in:

- Failure envelope on every error: `{ ok: false, error: "<message>" }`
- Accept and echo an `X-Request-ID` header; include it in structured request logs
- Keep the `/api/*` namespacing already in place (`/api/stash/*`, `/api/gear/*`,
  `/api/workflows/*`, plus core routes)
- Emit an OpenAPI spec for the Express app — dashboard generates one and runs
  `openapi-typescript` over it to produce `src/types/generated.ts`

### 7. Frontend: match dashboard's client conventions

Zero backend risk, and this is the layer that survives the merge intact.

- **TypeScript**, with `npm run typecheck` (`tsc --noEmit`) wired into the build
- One typed API module per domain over a shared `client.ts`, replacing the single
  `core/api.js` — dashboard uses `src/api/{bots,calls,sales,work,…}.ts`
- Export an `isApiFailure()` guard and the `ApiResult<T>` / `ApiFailure` shapes
- Send `X-Request-ID` on every request from the shared client
- Error boundaries around the whole app **and** around each page individually
- **vitest** for component tests
- Keep the module registry (`client/src/modules/registry.js`) — it is Backbeat's own
  good idea and has no dashboard equivalent. Convert it to TS in place.

Dashboard uses hash routing with no React Router. **Do not change Backbeat's
routing** — that is a merge-time decision, not a prep-time one.

### 8. Cheap convention parity

- `VERSION` file at the repo root with semver; display it in the sidebar next to the
  existing module badge. PATCH = fixes, MINOR = features, MAJOR = architecture.
- Dated idempotent migrations in `migrations/sql/` (dashboard uses
  `YYYY-MM-DD-description.sql`), alongside the existing `schema.js` orchestrator.
- `AGENTS.md` at the repo root — dashboard's team drives Windsurf/OpenCode off it.
  It can be short and point at `CLAUDE.md` rather than duplicating it.
- Write tests **DAMP, not DRY**. Dashboard explicitly forbids extracting shared
  factories: each test spells out its own literal input so a failure shows what
  produced it. Backbeat's suite should not drift the other way.

---

## Do NOT do any of this yet

- **Do not port Express → Flask.** There is no merge date, and it would stall
  feature work.
- **Do not migrate Postgres → SQL Server.** Task 3 is about not making it worse.
- **Do not adopt Redis, systemd, or the worker pattern.** Backbeat has no background
  jobs; that is dashboard solving problems Backbeat does not have.
- **Do not remove Docker.** Dashboard has none, but Docker is Backbeat's onboarding
  story and `CLAUDE.md` protects it.
- **Do not change the frontend router.**
- **Do not weaken the CI/test gate** to match dashboard, which has no GitHub Actions.

---

## Open decisions — for the user, not for an agent

Do not resolve these unilaterally. Flag them and move on.

1. **Infrastructure.** Dashboard's SQL Server sits at a private address
   (`100.125.55.107`) and the app deploys to bare metal with systemd. Railway cannot
   reach that network. Converging the backend means Backbeat leaves Railway for that
   host.

2. **Quality model.** Dashboard has no GitHub Actions and only `main` on the remote.
   Backbeat's whole premise is that CI-gated tests are the quality gate *because a
   non-engineer maintains it*. Both models cannot survive the merge. The likely
   answer is that Backbeat's CI discipline moves to dashboard rather than the
   reverse — but that is the other team's call too.

3. **Where the FIFO costing logic ends up.** It eventually becomes Python. The
   existing server tests make that port safe *only if the tests port with it*. This
   is the strongest argument for finishing task 1: logic that lives in `services/`
   with thin routes is portable; logic embedded in Express handlers is not.
