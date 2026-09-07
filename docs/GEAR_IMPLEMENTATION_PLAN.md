# Gear — Implementation Plan

**Companion to** `docs/GEAR_REQUIREMENTS.md`, which owns *what* and *why*. This document
owns *how*: schema shapes, file layout, library choices, and sequencing. Where the two
disagree about a requirement, the requirements document wins; where they disagree about a
mechanism, this one does.

**Last updated:** 2026-09-07

---

## How to use this

Work one phase per branch, in order. Each phase states what it satisfies, what it changes,
what proves it, and what it must not break. A phase is done when its acceptance checks pass
and the whole suite is green — not when the code exists.

Phases 1–6 cover every P0 story. Phases 7–11 cover P1 and P2.

Two rules that apply to every phase:

- **Behaviour that exists today keeps working.** The 228 server tests and 70 E2E specs are the
  contract. If an existing test needs editing, stop and say why — that is a signal the change
  went further than intended, not a licence to edit the test.
- **Nothing new violates SQL Server portability** (requirements §6.2). New code adds no
  `RETURNING`, no `ON CONFLICT`, no exclusion constraints, and no queries into the open
  attributes field.

---

## Decisions this plan makes

The requirements document leaves these open. They are settled here so that phases don't each
re-decide them.

**Table names are plural.** `assets`, `asset_types`, `asset_models`, `asset_events`,
`asset_links`, `lifecycle_states`, `parties`. This matches every existing table — `parts`,
`locations`, `suppliers`, `users`, `inventory_transactions` — and `assets` already exists in
the plural. Column references stay singular (`asset_id`, `owner_party_id`).

**Schema changes are guarded, idempotent ALTERs in each module's `schema.js`.** Backbeat has
no migration runner; `initializeDatabase()` runs at every startup and must be safe to re-run.
New tables use `CREATE TABLE IF NOT EXISTS`. Changes to existing tables check
`information_schema` first, in the style dashboard uses:

```sql
-- pattern: check, then act
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assets' AND column_name = 'owner_party_id') THEN
    ALTER TABLE assets ADD COLUMN owner_party_id INTEGER REFERENCES parties(id);
  END IF;
END $$;
```

**Do not copy the pattern at `server/src/db/schema.js:42`.** That block wraps its ALTERs in
`EXCEPTION WHEN OTHERS THEN NULL`, which swallows every error including real ones — a failed
migration reports success and the app starts against a schema nobody verified. It is also
exactly what dashboard's rule against using caught SQL failures as a control path forbids.
Check explicitly instead. Leave the existing block alone; do not extend it.

**Identity columns:** new tables use `GENERATED ALWAYS AS IDENTITY`, not `SERIAL` — same
sequence semantics, and it is the form that survives the port to SQL Server's
`IDENTITY(1,1)`. Existing `SERIAL` columns are left as they are; converting them is
convergence task 3's business, not Gear's.

**Optional-but-unique is a partial index, never a constraint** (requirements §6.2):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_assets_serial_number
  ON assets (serial_number) WHERE serial_number IS NOT NULL;
```

**Services own all SQL; routes own none.** This is convergence task 1's rule and it already
holds. Every new service function takes the executor first — `fn(db, ...)` — and uses the
task-2 helpers `executeSqlStrict` / `executeSqlWrite` / `executeSqlInsert`. Never
`pool.query` in a service. `executeSql` (the failure-swallowing variant) stays unused.

**Gear's frontend is TypeScript; the rest of the client is left alone.** Add `tsconfig.json`
with `allowJs: true` and `checkJs: false` so existing `.jsx` keeps compiling untouched, and
write every new Gear file as `.tsx`/`.ts`. Vite compiles TypeScript natively through esbuild;
no plugin is needed. Add `"typecheck": "tsc --noEmit"` to `client/package.json` and run it in
CI. Converting the rest of the client is convergence task 7.

**Avoid React 19-only APIs in Gear code.** Backbeat is on React 19; dashboard is on React 18
(requirements §6.1). Anything Gear writes has to compile on 18 after the merge, so stay off
`use()`, `useActionState`, `useOptimistic`, and ref-as-prop. Standard hooks and function
components are fine on both. This is a real divergence the requirements document does not
mention.

---

## Phase 0 — Make the quality gate real

**Satisfies:** G7.1 (P0), requirements §9 items 1–3.
**Approved by Nandan 2026-09-07. In progress — PR #6.**

Everything after this phase is verified by tests. Right now nothing runs them on a pull
request: there is no `.github/` directory at all, and `main` is not a protected branch — I
confirmed both against the API. So a schema test would exist and never run, and an ownership
rule would exist and never gate anything.

| Change | Detail |
|---|---|
| `.github/workflows/ci.yml` | On push and PR: `npm ci`, server suite against a Postgres service container, `client` typecheck and build, E2E suite |
| `.github/CODEOWNERS` | `server/src/modules/gear/schema.js` and `server/src/db/schema.js` → Nandan |
| Branch protection on `main` | Require the CI check; require the code-owner review |
| `CLAUDE.md` | The spine rule: no column added to `assets`, `asset_types`, `asset_links` or `asset_events` without the platform owner's approval — default to the type extension or the open attributes field |

**Acceptance:** a PR with a deliberately failing test cannot merge.

**Why first:** it is P0, it is cheap, and it is the difference between the remaining phases
being verified and merely being claimed. If it is deferred, say so explicitly in the tracking
issue rather than letting it drift — the requirements document is right that governance which
depends on someone remembering is not governance.

---

## Phase 1 — Reference tables

**Satisfies:** G1.2, G1.3, G1.4, and the shared list G1.5 needs.
**Touches no existing behaviour.** Purely additive: new tables, new services, new admin
routes. Nothing reads them yet, so this phase cannot regress anything.

**New core table** — `parties` lives in `server/src/core/party/`, not in Gear, because Stash
will want it (requirements §5.3):

```
parties
  id            identity PK
  name          text not null
  party_type    text not null   -- internal_entity | employee | customer | vendor
  active        boolean not null default true
  created_at    timestamptz not null default now()
```

**New Gear tables** in `server/src/modules/gear/schema.js`:

```
asset_types
  id, name (unique), description,
  supports_location    boolean not null default false   -- L1
  supports_linking     boolean not null default false   -- L2
  supports_maintenance boolean not null default false   -- L3
  active               boolean not null default true

lifecycle_states
  id, name (unique), sort_order, is_terminal boolean, active boolean

asset_models
  id, asset_type_id -> asset_types, manufacturer text not null,
  model_name text not null, specs (open attributes), active boolean
  unique (manufacturer, model_name)
```

Capability flags are three booleans rather than a single level integer, because the levels are
not strictly nested in practice — a type can be linkable without being maintained — and
booleans are additive when L4 or a later level arrives. `manufacturer` is `NOT NULL` on
purpose: requirements §6.5 item 3 makes it unrecoverable if skipped.

Seed the starting data: the four existing lifecycle states (Available, In Use, Maintenance,
Retired) and Greenfield as an `internal_entity` party. Seed only when the table is empty, in
the style `db/schema.js` already uses for the admin user.

**Tests:** `server/tests/21-gear-reference-tables.test.js` — CRUD for each table, uniqueness
rejections, capability flags default to false, seeding is idempotent across two
`initializeDatabase()` calls.

---

## Phase 2 — Migrate the assets scaffold

**Satisfies:** G1.1, G1.5, G1.6, G2.1.
**The highest-risk phase.** It changes a live table, and its blast radius crosses modules.

Schema changes to `assets`, all guarded:

| Change | Note |
|---|---|
| Drop the empty `serial_number`, rename `asset_tag` → `serial_number` | Preserves values, which matters — see the history note below |
| Drop `NOT NULL` from `serial_number`; add the partial unique index | Assets may have no serial (requirements §5.1) |
| `asset_type` text → `asset_type_id` -> `asset_types` | G1.2 |
| `status` CHECK → `lifecycle_state_id` -> `lifecycle_states` | G1.3; drop the CHECK constraint |
| Add `model_id` -> `asset_models` | G1.4 |
| Add `owner_party_id`, `custodian_party_id` -> `parties` | G1.5; owner defaults to the Greenfield party |
| Add `acquired_at`, `disposed_at` | Requirements §5.7 |
| Add `attributes` JSONB | G1.6, subject to §6.2 — read whole, never queried, never indexed |

**Rework `assetService.js` off the non-portable constructs** (requirements §6.2, and this also
discharges part of convergence task 3): replace both `RETURNING *` blocks with
`executeSqlInsert` followed by a read, and replace both `err.code === '23505'` handlers with an
explicit existence check before the insert. Keep the 409 status the tests expect.

**Serial normalization:** trim and uppercase on write, in the service, in one place (G2.1).

**Blast radius — every one of these needs updating in the same branch:**

- `server/src/modules/gear/services/assetService.js` — the rewrite above
- `server/src/modules/gear/routes/assets.js` — field names in and out
- `server/src/workflows/commissionAsset.js` — reads `createdAsset.asset_tag` and writes it into
  the Stash transaction's `reason` and `target_ref`; it also writes the stable
  `reference_type='ASSET'` / `reference_id=asset.id`, which is the reference that must survive
- `client/src/modules/gear/pages/AssetsPage.jsx` — hardcodes
  `['Robot','Laptop','Vehicle','Tool','General']` at line 4 and `asset_tag` in its form; both go
- `server/tests/18-gear-assets.test.js`, `19-commission-asset-workflow.test.js`
- `e2e/tests/15-gear-assets.spec.js`
- `e2e/helpers/api-setup.js` if it creates assets

**A history note worth stating, because the safe path is not obvious.** `commissionAsset` has
already written `asset_tag` values into `inventory_transactions.target_ref` and `reason` on
existing rows. Renaming the column preserves those values, so that history stays consistent.
If anyone instead populates `serial_number` from a different source — Royce's records, say —
those historical strings silently stop matching any asset, while `reference_id` keeps working.
**Rename; do not repopulate.**

**Acceptance:** an asset can be registered with only type, serial and state (G1.1); two assets
with no serial can coexist; a duplicate serial is rejected with 409; `commission-asset` still
commits or rolls back as one unit.

---

## Phase 3 — Locations

**Satisfies:** G3.1.

Add `is_inventory_location BOOLEAN NOT NULL DEFAULT true` to `locations` — defaulting true so
every existing row keeps its current meaning for Stash — and extend the type CHECK to add
`Farm`, `In Transit` and `Customer Site`. A CHECK constraint is portable to SQL Server, so it
can stay a constraint here; only Gear's own vocabularies (`asset_types`, `lifecycle_states`)
were required to become data.

Filter Stash's location pickers to `is_inventory_location = true`; leave Gear's unfiltered.
The pickers are in Stash's issue/move/dispose/return/adjust pages and in `locationService`.

**Tests:** new location types accept; Stash pickers exclude non-inventory locations; existing
locations still appear in Stash (the default-true check).

---

## Phase 4 — Event stream

**Satisfies:** G3.2. **Cannot be deferred** — requirements §6.5.

```
asset_events
  id            identity PK
  asset_id      -> assets, not null
  event_type    text not null   -- registered | moved | custody_changed | state_changed | note
  occurred_at   timestamptz not null   -- when it happened
  created_at    timestamptz not null default now()   -- when we heard
  location_id   -> locations, null
  party_id      -> parties, null
  from_value    text, to_value text    -- for state and custody changes
  actor_user_id -> users, null
  notes         text
```

`occurred_at` separate from `created_at` is the whole point (§6.5 item 1); they are simply
equal until offline capture exists. The table is **append-only** — no update or delete path in
the service, and no route that offers one.

Wire every lifecycle state change, location change and custody change in `assetService` to
write an event in the same transaction as the change itself. Registration writes a
`registered` event. Add a read endpoint and an asset-history UI section.

**Tests:** a state change writes exactly one event with the correct `from_value`/`to_value`;
events are ordered by `occurred_at`; a failed asset update writes no event (same transaction);
there is no way to mutate an event through the API.

---

## Phase 5 — Durable label host

**Satisfies:** G2.2, G2.3. **Gates all printing** (requirements §10).

Two parts, and only the first is code:

1. **In-app route** `/a/:serial` that looks up the serial and renders the asset, authenticated
   like everything else — an unauthenticated scan lands on the login screen (§5.5). The serial
   is in the **path**, never a fragment (§6.4).
2. **A redirect host** — `assets.greenfieldrobotics.com/a/:serial` → the app's current URL.

**Decided (Nandan, 2026-09-07): the redirect lives outside the Backbeat app.** The entire
purpose is to survive the app moving hosts, and convergence has it leaving Railway for
dashboard's infrastructure. It goes somewhere host-independent — a DNS-level redirect rule or
a tiny edge function — so re-platforming the app changes one rule and touches no labels. A
redirect living inside the app moves when the app moves, which leaves the §6.4 constraint
unmet while appearing met.

Still needed from Nandan: the domain provisioned, and which mechanism hosts the rule.

**This phase needs a domain provisioned and a DNS decision**, which is operational rather than
code. It is the one P0 story that cannot be completed by a coding session alone; flag it early
rather than discovering it at printing time.

**Acceptance:** a printed-form URL resolves to the right asset; the same URL still resolves
after the app's base URL changes (test by pointing the redirect at a different target).

---

## Phase 6 — Gear frontend in TypeScript

**Satisfies:** the §6.1 constraint, and convergence task 7's conventions for Gear's slice.

Add `client/tsconfig.json` (`allowJs: true`, `checkJs: false`, `strict: true` for new files),
add the `typecheck` script, and rewrite Gear's pages as `.tsx` against a typed
`client/src/modules/gear/api.ts` layered over a shared client that sends `X-Request-ID` and
exposes `ApiResult<T>` / `isApiFailure()`. Error boundary per page. Component tests with
vitest.

**Do not touch the router** (§6.1). React Router stays; hash routing is a merge-time decision.

Sequenced after phases 2–4 deliberately: converting the page while its fields are still
changing means doing it twice.

---

## Phases 7–11 (P1, then P2)

| Phase | Stories | Notes |
|---|---|---|
| 7 | G2.4, G2.5 | Label generation and printing. QR for robots/vehicles/bins, DataMatrix for VCUs and small electronics, either for batteries; human-readable serial always printed alongside. **Unblocked for local prototyping (2026-09-07):** generate and preview labels with the URL host taken from configuration, so the printed host can change without touching code. §10's "print nothing first" rule is about labels **applied to equipment**, which is what becomes irreversible — generating and previewing them locally is not. Do not apply labels to real equipment, and do not order a volume run, until the durable host exists |
| 8 | G4.1, G4.2 | Camera scanning with a self-hosted decoder — the native browser barcode API alone fails silently on every iPhone (§6.3). 2D only on the camera path. The global sentinel-prefix listener belongs in `client/src/core/`, not Gear, because Stash needs it equally (G4.2); no timing heuristics |
| 9 | G3.3, G5.1, G5.2 | `asset_links` as dated edges: `parent_asset_id`, `child_asset_id`, `link_type`, `occurred_at`, `valid_from`, `valid_to` nullable. Overlap enforced in the service layer plus a partial unique index on `child_asset_id WHERE valid_to IS NULL` as the backstop — no exclusion constraints (§6.2). Two-scan flows for locate and link, glove-usable |
| 10 | G6.1, G6.3 | Maintenance orders and component wear. **Re-scoped 2026-09-07: G6.2 is out** — its mechanism was reading Stash's inventory transactions, and Stash is on hold with inventory in Shopify (requirements §7.8). Build work orders and a service history that does **not** include parts consumed, and **do not** substitute a parts log of Gear's own; that is the trap G6.2 existed to prevent, and it does not stop being a trap because the integration is missing. Component wear stays per-installation against the model, never per-blade identity (G6.3). **No Gear code may read or write Stash's tables or call its services.** |
| 11 | G4.3 | Photograph-and-resolve-later, which needs the idempotency key from §7.1. **G7.3 dropped from this phase** — promoting Stash's suppliers into `parties` is moot while Stash is on hold (requirements §7.3) |

G7.2 (put the promotion runbook in `CLAUDE.md`) rides along with Phase 0's `CLAUDE.md` edit.
G7.3's scaffold (`modules/_template/`) is worth doing whenever someone next adds a module.

---

## Sequencing rationale, and where this deviates from product priority

The requirements document invites resequencing for technical reasons. Three deviations:

1. **G7.1 moves to the front** as Phase 0. It is listed P0 but it is also the gate for
   verifying every other phase, so doing it last means nothing before it was actually gated.
2. **G1.6 (open attributes, P1) is pulled into Phase 2.** It is one column on a table already
   being altered. Adding it later means a second migration for no reason.
3. **G2.4/G2.5 (labels, P1) stay behind Phase 5** and are not pulled forward, because
   printing before the durable host exists is the one thing the requirements call
   non-negotiable.

Dependency order that cannot change: `parties` and the reference tables (1) precede the assets
migration (2), which precedes events (4) and the frontend rewrite (6). Phase 3 is independent
and can run in parallel. Phase 5 can start any time once someone owns the DNS decision, since
its code is a single route.

---

## Cross-cutting requirements for every phase

- **Tests alongside the feature**, per `CLAUDE.md`. Server tests as `server/tests/NN-*.test.js`
  and E2E as `e2e/tests/NN-*.spec.js` — both are auto-discovered, next free numbers are 21 and
  16. Write them DAMP: each test spells out its own literal inputs rather than sharing a
  factory (this is dashboard's convention and convergence task 8 adopts it).
- **Capability flags are checked before exposing L2/L3 features** (§2.3). This is a
  requirement, not a nicety: without it the maintenance UI breaks the first time someone
  registers an L0 type. Phase 9 and 10 each need a test asserting the check.
- **The §2.4 review trigger becomes a schema test** once Phase 0 exists: any table with a
  serial-like identifier, a status, and a location or holder must carry an asset reference.
- **One writer on the sandbox database at a time.** The E2E suite truncates and restores the
  dev database, so two sessions running it concurrently produce failures that aren't real.

---

## Needs a decision before the phase can start

| Phase | Decision | Owner |
|---|---|---|
| 0 | ~~Approve CI, CODEOWNERS and branch protection~~ — **approved 2026-09-07**, PR #6 | Nandan |
| 5 | Provision the label domain and choose the mechanism. **Decided 2026-09-07: the redirect lives outside the app.** Deferred by the owner the same day — the near-term goal is a local prototype on one Mac, so infrastructure waits | Nandan, later |
| 7 | Budget and order a label media test batch. **Deferred with the rest of the infrastructure** — not needed to generate and preview labels locally | Nandan, later |
| 11 | Nothing — but §7.3's trigger should be confirmed as still unmet before starting it | — |

Inherited and explicitly not Gear's to resolve (requirements §8): which infrastructure the
backend runs on, which quality model survives the merge, and where FIFO costing ends up.

---

## Not in this plan

- **Offline capture and sync** (§7.1), **transition rules** (§7.2), **the truck-as-location
  join** (§7.4), **per-blade identity** (§7.5), **manufacturer-scoped serial uniqueness**
  (§7.6) — deferred with triggers; do not build them speculatively.
- **Finance capitalization / L4** (§5.7, §8) — out of scope. `owner_party_id`,
  `custodian_party_id`, `acquired_at` and `disposed_at` exist for custody and insurance, not
  accounting.
- **Migrating the rest of the client to TypeScript**, converting existing `SERIAL` columns, and
  the `?`-to-`$n` placeholder question — all convergence work, not Gear's.
- **Legacy asset data migration** — there is none (§10). Assets were never in BarCloud.
