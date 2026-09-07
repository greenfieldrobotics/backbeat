# Backbeat - ERP System

## Overview
Backbeat is an ERP system built as a **modular monolith**. Modules currently in the codebase:
- **Stash** — inventory management (parts, purchase orders, FIFO costing, inventory transactions). Fully built.
- **Gear** — asset management (assets: serial, type, status, location). Scaffolded; extend as needed.

Future modules will be added over time following the same structure.

## Key Design Goal
This system is designed to be maintained and extended by **non-engineers using Claude Code** (vibe coding). The automated test suite and CI/CD pipeline serve as the primary quality gate — not human code review. All architectural decisions should prioritize making the system safe and easy to modify without deep engineering knowledge.

---

## Architecture & Module Structure

Backbeat is a **modular monolith**: one Express server, one React app, **one PostgreSQL database**, with code organized into modules. Modules are a code-organization convention, NOT a runtime boundary — everything shares one database and one process, so **cross-module workflows are first-class** (a single action can touch multiple modules atomically in one transaction).

### Backend (`server/src/`)
```
db/                      Shared database layer (one DB for the whole app)
  connection.js          pg pool + query/getClient helpers
  schema.js              Orchestrator: creates core tables, then calls each module's schema
  seed.js                Dev seed data
core/                    Shared concerns used across modules
  auth/                  Google OAuth + auth middleware
  users/                 User management (routes.js)
  locations/             Locations — SHARED: used by both Stash and Gear (routes.js)
  dashboard/             Cross-module dashboard (routes.js)
modules/
  stash/
    schema.js            createStashTables() — parts, suppliers, POs, fifo_layers, inventory, transactions
    routes/              Express routers (mounted under /api/stash/*)
    services/            Reusable business logic that takes a `client` (for transaction composition)
  gear/
    schema.js            createGearTables() — assets
    routes/              Mounted under /api/gear/*
    services/            e.g. assetService.createAsset(client, data)
workflows/               Cross-module workflows (mounted under /api/workflows/*)
  commissionAsset.js     Example: creates a Gear asset AND issues Stash parts in ONE transaction
app.js                   Wires everything together
```

### API namespacing
- Shared/core: `/api/users`, `/api/locations`, `/api/dashboard`, `/api/health`
- Stash module: `/api/stash/*` (e.g. `/api/stash/parts`, `/api/stash/inventory/issue`)
- Gear module: `/api/gear/*` (e.g. `/api/gear/assets`)
- Cross-module workflows: `/api/workflows/*`

### Frontend (`client/src/`)
```
core/                    api.js (all HTTP calls), context/AuthContext, shared pages (Login, Users, Locations)
modules/
  stash/                 pages/, components/, module.jsx (nav + routes registration)
  gear/                  pages/, module.jsx
  registry.js            Lists the modules — the sidebar and router are generated from this
App.jsx                  Renders module-grouped sidebar + routes from the registry
```

### How to add a new module (e.g. "Fleet")
1. **Backend schema:** create `server/src/modules/fleet/schema.js` exporting `createFleetTables(pool)`; import + call it in `server/src/db/schema.js`.
2. **Backend routes:** create `server/src/modules/fleet/routes/*.js`; mount in `app.js` under `/api/fleet/*`.
3. **Frontend:** create `client/src/modules/fleet/module.jsx` (nav + routes) and add it to `client/src/modules/registry.js`. Add API methods in `client/src/core/api.js`.
4. **Tests:** add `server/tests/NN-fleet-*.test.js` and `e2e/tests/NN-fleet-*.spec.js` (they're auto-discovered).
5. **Cross-module logic** goes in `server/src/workflows/` and composes module `services/` inside one transaction — see `workflows/commissionAsset.js`.

### How to promote an existing entity into a Gear asset
Other modules will build an entity first and recognize its asset nature later. Retrofit is the
normal path, so it is meant to be cheap. Full requirements in `docs/GEAR_REQUIREMENTS.md` §2.4.

1. Register the asset type with its capability flags.
2. Add a **nullable** unique asset reference to the entity table.
3. Backfill one asset per entity row, mapping the entity's natural key to the serial.
4. Make the reference required; ensure new entity rows always create an asset row.
5. **Move the cross-cutting columns out.** The entity almost certainly has its own location,
   status and holder — those now belong to the asset spine. **This is the step that gets
   skipped, and skipping it is how an entity's location and the spine's location end up
   disagreeing with nobody noticing. It is not optional.**
6. Ship a view named after the old table so existing readers don't break; deprecate on a clock.
7. Start the event stream at the promotion date. Do not manufacture history that doesn't exist.

**Review trigger:** if a new table has a serial or unit identifier, **and** a status, **and** a
location or holder — it is an asset and must be registered at L0 immediately. L0 is cheap;
identity becomes expensive to retrofit once labels are physically on equipment.

**House convention for new physical-thing tables:** a natural key, a status, a creation
timestamp, and a reference to whoever holds it.

### Cross-module workflow pattern
Business logic that must be reused across modules lives in a module's `services/` as functions that accept a `client` (a pg client already inside `BEGIN`). A workflow opens one transaction and calls services from multiple modules, so the whole operation commits or rolls back together. This is why the module split does **not** prevent cross-module workflows.

---

## Requirements (Stash Module)

### Users & Scale
- 5-10 users with authentication and role-based access
- ~200 part numbers
- ~20,000 items total
- Detailed user stories for the Stash module are in `docs/USER_STORIES.md`

### Authentication
- Google OAuth (Passport) with an email allowlist in the `users` table + role-based access.
- In dev/test (no `GOOGLE_CLIENT_ID` configured, or `NODE_ENV=test`) auth is bypassed with a dev admin user — see `core/auth/authMiddleware.js`.

---

## Technology Stack (As Built)

### Frontend
- React + Vite (SPA), React Router. Client in `client/`.

### Backend
- Node.js + Express (ES modules). Server in `server/`.

### Database
- PostgreSQL (single shared database — see Architecture & Module Structure above)

### Containerization
- Docker + Docker Compose for local development and sandbox environments

### Hosting
- AWS (minimal dependency — keep it portable so we're not locked in)
- Likely: EC2 or ECS for containers, S3 for backups
- Keep cloud-specific code isolated so we can migrate if needed

---

## DevOps & Pipeline (Planned)

### Local Sandbox (Developer / Non-Engineer Environment)
- Must be dead simple to set up for a non-engineer:
  1. Install Docker Desktop (one-time)
  2. Clone the repo
  3. Run `docker compose up`
- Docker Compose spins up the full stack: app + database + seed data
- Hot reloading enabled — code changes reflect instantly in the browser
- Database seed script pre-populates realistic test data

### Automated Testing
- **Unit Tests** — Test individual functions in isolation
- **Integration Tests** — Test API endpoints against a real database
- **E2E Tests (Playwright)** — Simulate real user workflows in a browser (login, add parts, etc.)
- **Schema/Migration Tests** — Verify database changes don't break existing data
- **API Contract Tests** — Verify endpoints accept correct inputs and return correct outputs
- Server tests (Jest + Supertest against a real Postgres): `cd server && npm test`. New tests in `server/tests/**/*.test.js` are auto-discovered.
- E2E tests (Playwright): `npm run test:e2e` (or `npx playwright test`; use `--headed` to watch). Specs in `e2e/tests/`.
- Always run the server test suite before pushing; run E2E when changing UI or user flows.
- Tests also run automatically in GitHub Actions on every push.

### CI/CD Pipeline (GitHub Actions)
- On every push/PR:
  1. Build the application
  2. Run all test suites (unit, integration, E2E)
  3. Block merge if any test fails
- No PR can merge to main unless all tests pass (enforced by GitHub branch protection)
- GitHub Actions free tier: 2,000 min/month (plenty for this scale)

### Environments
- **Sandbox** — Local Docker environment for development and vibe coding
- **QA** — Deployed environment for manual verification before production release
- **Production** — Live environment

### Release-to-Production Process
- Merge to main triggers deployment to QA
- Manual verification in QA
- Promotion from QA to Production (process TBD — could be manual approval or tag-based)
- **Rollback capability** — ability to quickly revert to a previous version if issues arise

### Database Backups
- Automated scheduled backups of the production PostgreSQL database
- Backup storage in S3
- Retention policy TBD

---

## Workflow for Non-Engineer Using Claude Code

```
1. Open project folder in Claude Code
2. Run `docker compose up` to start the sandbox
3. Describe the desired change to Claude
4. Claude makes code changes (app auto-reloads)
5. Verify the change looks right in the browser
6. Run `npx playwright test` to ensure nothing is broken
7. If tests pass, Claude pushes to GitHub
8. GitHub Actions runs tests again as a safety net
9. If pipeline passes, PR is eligible for merge to QA
```

---

## Claude Code Instructions

- Always run the full test suite before pushing code
- Never modify Docker configuration without asking the user
- Never modify CI/CD pipeline configuration without asking the user
- Always create a new branch for changes (never push directly to main)
- Write tests alongside every new feature
- Keep AWS-specific code isolated and minimal
- **Never add a column to the Gear asset spine without the platform owner's explicit
  approval.** The spine is the asset, asset-type, asset-link and asset-event tables. Every
  other module references them, so a column added there is expensive to take back. Default to
  the asset type's own extension table, or to the spine's open `attributes` field if the field
  has not yet earned a column. A column earns a place on the spine only when **two or more
  asset types query it**. Platform owner: Nandan. `.github/CODEOWNERS` enforces review on the
  schema files; this rule is what it is enforcing.

---

## Status
**Project phase: Active development**
- **Stash** (inventory) is fully built with a comprehensive server + E2E test suite.
- **Gear** (asset management) is scaffolded: assets CRUD (`/api/gear/assets`), an Assets UI page, and a cross-module `commission-asset` workflow. Extend it with more asset-management features as needed.
- The codebase is a modular monolith — see **Architecture & Module Structure** above before adding features, especially the "How to add a new module" and "Cross-module workflow pattern" sections.
