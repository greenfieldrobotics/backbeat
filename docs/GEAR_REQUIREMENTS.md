# Gear (Asset Management) — Decisions Record

> **Companion to** `Greenfield Asset Management System — Design Brief` (Sep 7, 2026).
> The brief is the design. This is the record of what was decided when that design was
> checked against Backbeat as built — including the places the brief is **overridden**.
>
> Decisions below are settled. Where this document and the brief disagree, this document wins.
> Read alongside `docs/DASHBOARD_CONVERGENCE.md`, which constrains several choices here.
>
> Last updated: 2026-09-07

---

## 0. Context that changed

The brief's **open decision #1 — backing store and front end — is closed.** The target is
Backbeat: Node/Express + React/Vite + one Postgres database, modular monolith, with the
automated test suite as the primary quality gate.

The brief also assumes a blank page. Gear is not one. Already built:

| Exists today | Location |
|---|---|
| `assets` — `id SERIAL`, `asset_tag` (NOT NULL UNIQUE), `serial_number` (nullable), `asset_type` TEXT, `status` CHECK, `location_id`, `notes` | `server/src/modules/gear/schema.js` |
| Assets CRUD API + service layer taking a `client` for transaction composition | `modules/gear/routes/`, `services/assetService.js` |
| Assets UI page, registered in the module registry | `client/src/modules/gear/` |
| Shared core `locations` (`Warehouse` / `Regional Site` / `Contract Manufacturer`) | `server/src/core/locations/` |
| `commissionAsset` — creates an asset and issues Stash parts against it in one transaction | `server/src/workflows/commissionAsset.js` |
| Google OAuth + email allowlist + roles | `server/src/core/auth/` |

So step one is a **migration of a live scaffold**, not a greenfield build.

**And Gear is being built during convergence.** Backbeat is being harmonized with
`greenfieldrobotics/dashboard` (Flask + SQL Server + React/TS, hash routing, no PWA) and will
eventually merge into it. Gear is the newest code in the repo, so it is the code most able to
be born portable — see §2.

---

## 1. Portability constraints (read before writing any schema)

`DASHBOARD_CONVERGENCE.md` task 3 says: don't migrate to SQL Server, just stop adding
constructs that would need rewriting. Gear is a fresh module, so it should add **none**. Four
rules with real teeth:

**Nullable unique columns need a filtered index, not a UNIQUE constraint.** Postgres permits
many NULLs under `UNIQUE`; **SQL Server treats NULLs as equal and permits exactly one.** Two
unserialized assets would violate the constraint after a port. The portable form works
identically in both engines:

```sql
CREATE UNIQUE INDEX ux_assets_serial ON assets (serial_number)
  WHERE serial_number IS NOT NULL;
```

**`attributes JSONB` is an opaque blob.** SQL Server has no JSONB — it becomes
`NVARCHAR(MAX)` with `JSON_VALUE()`, and there is no GIN indexing. Keep the escape hatch, but
the rule is: read it whole in application code, **never query into it, never index it.** That
is close to the brief's intent ("captured but not yet queried") but now enforceable.

**No `EXCLUDE` constraints.** The brief wants `asset_link` to prevent overlapping active
links; the natural Postgres tool is `EXCLUDE` with `btree_gist`, which SQL Server cannot
express at all. Portable equivalent: enforce the overlap rule in the service layer, plus a
filtered unique index on active links — `UNIQUE(child_asset_id) WHERE valid_to IS NULL`.

**No `RETURNING`, no `ON CONFLICT` in new code.** Use `executeSqlInsert` from the task-2
helper layer for generated ids, and an explicit existence check instead of catching `23505`.
Note the existing `assetService.js` does both and will need reworking as part of the migration
in §3.

Also: new tables use `GENERATED ALWAYS AS IDENTITY` rather than `SERIAL` — same sequence,
closer to SQL Server's `IDENTITY(1,1)`.

---

## 2. Frontend

**Decided: React web, TypeScript, no PWA infrastructure.** React Native is closed out.

Dashboard is React 18 + TypeScript + Vite, hash routing with no React Router, served as a
built SPA by Flask, with **no service worker and no manifest**. Match it. React Native's real
advantage is native camera scanning on hard 1D reads — but the brief's own hardware ranking
puts rugged Android with DataWedge first for warehouse and shop, and DataWedge delivers scans
as plain keystrokes, which a web app handles perfectly. The hard reads move to hardware either
way.

Write Gear's frontend in **TypeScript from the start** — convergence task 7 converts the rest
of the client anyway, and new plain-JS pages only grow that pile. Follow the same task's
conventions: a typed API module per domain over the shared client, `ApiResult<T>` /
`isApiFailure()`, `X-Request-ID` on every request, error boundaries per page, vitest.

**Do not change Backbeat's router.** Convergence task 7 explicitly makes routing a merge-time
decision. This matters for §7.

---

## 3. Identity: `asset_id` internal, `serial_number` on the spine

**Decided.**

- **`asset.id`** — internally assigned by the database. Primary key, target of every foreign
  key, never shown to a user, never printed.
- **`serial_number`** — the identity humans use. Assigned by whoever manufactured the thing:
  Royce's convention for anything Greenfield builds, the manufacturer's number for anything
  bought, the VIN for vehicles. Nullable, unique via the **filtered index in §1**, trimmed and
  uppercased on write. Required by the API unless an asset is explicitly flagged unserialized.
- **No separate `asset_tag`.** Greenfield has no tag scheme distinct from serials, and
  inventing one creates a convention someone has to maintain for no current benefit. The
  brief's `asset_tag` column is dropped.

### Why not UUIDs

Considered and rejected. UUIDs buy exactly one thing a sequence can't: an ID minted by a client
with no database connection. The scenario that motivated it — a tech linking a VCU to a robot
offline — **doesn't need it**, because both assets already exist and the new link row is
referenced by nothing. Client-minted IDs are only required when an offline-created row is
referenced by *another* offline-created row before sync, which would mean registering brand-new
assets in the field. Registration means printing and applying a label, which means a bench and
connectivity. Not a real case.

Revisit only if bulk receiving ever happens away from a facility.

### The one risk accepted

Global uniqueness assumes manufacturer serial namespaces don't overlap. True for VINs, Dell
tags and Royce's numbers; it breaks the day two component vendors both ship something numbered
`1001`, or one vendor reuses numbers across product lines.

Accepted because **it fails loudly** — the insert is rejected, someone sees an error, no data
is corrupted. The fix is a one-line migration to a composite index on
`(manufacturer, serial_number)`, and the disambiguator is already being captured (§8).

### Migration note

`asset_tag` is currently `NOT NULL UNIQUE` with a nullable `serial_number` beside it — backwards
from the above. Cheapest path is **drop the empty `serial_number`, rename `asset_tag` →
`serial_number`**, drop `NOT NULL`, and replace the constraint with the filtered index.

Blast radius: `assetService.js` (also needs its `RETURNING *` and `23505` handling reworked per
§1), the assets routes, `AssetsPage.jsx`, `commissionAsset.js` — which writes `asset_tag` into
the Stash transaction's `reason` and `target_ref`, making this a cross-module change — and the
server + E2E tests.

---

## 4. Locations: one table, one flag — and no link to vehicle assets

**Decided.**

- **Do not link `locations` to `assets`.** A truck used as a stocking location and a truck
  owned as a vehicle asset are different concepts that sometimes coincide. They don't reliably
  coincide: a *rented* truck is a location and not an asset; a truck carrying no stock is an
  asset and not a location; a robot in a customer's field has an asset location that is not a
  storage area at all. Linking them buys only auto-deactivation of a storage location when a
  truck is sold — a rare event a human notices. Revisit when a real question needs the join.
- **One `locations` table, with `is_inventory_location BOOLEAN`.** Stash's pickers filter on
  it; Gear's don't. An inventory location is a *kind* of location — a controlled storage area —
  not a different entity. Two tables would put Lenexa in the database twice.
- **New location types needed:** at minimum `Farm`, `In Transit`, `Customer Site`.

---

## 5. `party` — build it now, as a core table

**Decided.** Confirmed as real: the LeaseCo structure means an asset's owner is not always
Greenfield, and a RaaS customer holding a robot is not a login.

```
party (id, name, party_type, active)
    party_type ∈ 'internal_entity' | 'employee' | 'customer' | 'vendor'

asset.owner_party_id      → party    -- defaults to Greenfield
asset.custodian_party_id  → party    -- nullable
users.party_id            → party    -- nullable
```

Core, not Gear-owned — peer of `locations`, since Stash will want it too. Custodian points at
`party` rather than `users` because a customer isn't a user. Treat `party` as the master list
of people and entities and `users` as "a party that can log in"; auto-create the party row when
an admin adds a user so the two lists can't drift.

Note `users` is also being aligned with dashboard's `Ops_Users` in convergence task 4 —
sequence `party_id` after that work rather than against it.

**Known future promotion, deliberately not done now:** Stash's `suppliers` table is a vendor
party. It works, `purchase_orders` references it, nothing is currently unanswerable. When
unifying is worth it, follow the brief's own runbook — `suppliers.party_id UNIQUE`, backfill,
move shared columns up. Recorded so nobody "fixes" it prematurely.

---

## 6. Lifecycle states — don't bake them

**Decided.** The vocabulary will churn, and different L-levels will want different lifecycles.

- **States live in a lookup table, not a CHECK constraint.** Adding "In Transit" becomes an
  INSERT an admin can do, not a schema migration. Same reasoning as `asset_type`.
- **No transition table yet.** Purely additive later; until it exists, any state may follow any
  state.

Starting set is the existing four — `Available`, `In Use`, `Maintenance`, `Retired` — extended
as reality demands.

---

## 7. QR resolver — no public view, and a stable redirect host

**Decided.** A scan by someone not logged in fails to a login screen. The brief's "resolves to
something meaningful for someone without app access" is dropped; a technician who can't
authenticate can photograph the code and upload it later, which is a separate feature.

Two things this does **not** change:

- **Still encode a URL, not a bare serial.** For a logged-in tech, a phone-camera scan
  deep-links straight into the asset with no scanner UI at all.
- **The hostname is irreversible, and the app's URL shape will change.** Backbeat runs on
  Railway today; convergence open-decision 1 has it leaving for dashboard's bare-metal host,
  and task 7 makes routing a merge-time decision — dashboard uses hash routing. So:
  **print a path-based URL on a stable host we control, and make that endpoint a redirect**
  into wherever the app currently lives.

  The mechanics matter. A fragment (`#/assets/…`) is **never sent to the server**, so the
  printed URL must carry the serial in the **path** — `https://assets.greenfieldrobotics.com/a/GFR-0114` —
  with the landing page translating it into whatever route form the app uses at the time. One
  redirect to change instead of a fleet to relabel.

The photo-and-upload path needs no change to the scanning stack — `zxing-wasm` decodes a still
image as readily as a video stream. It will want the same idempotency key as offline scanning
(§8).

---

## 8. Offline — deferred, with things that can't be

**Decided: not now.** Dashboard has no service worker and no manifest, and Gear isn't adding
PWA infrastructure (§2), so true offline isn't on the table regardless. Online-only is right
for the prototype; the warehouse and shop have connectivity, which is where the hardware
ranking puts the scanning anyway.

When it is built it needs a `client_uuid` idempotency key on queued rows so a retried scan
doesn't post twice — a nullable column, trivially added later.

### Cheap now, impossible to backfill later

1. **`occurred_at` separate from `created_at`** on `asset_event` and `asset_link` — when the
   scan happened vs. when the server heard about it. Without the split, every event backfilled
   later is stamped with its sync time and the history is quietly wrong. The two columns are
   simply equal for the whole online-only era.
2. **Every state change written to `asset_event`.** State as a column alone gives a current
   value and no history — "how long do robots sit in Maintenance" becomes unanswerable.
3. **Manufacturer captured on `asset_model`.** The disambiguator needed the day two serials
   collide (§3), and the thing that answers "which battery model fails early."

---

## 9. Blades are inventory

**Decided.** They stay Stash parts (`CS-0118 Cutter Blade Assembly - 18in` and similar), with
FIFO cost layers and reorder points. Not Gear assets.

Two reasons. **A blade can't carry a durable identifier** — it's a wear part living in dirt and
rock strikes, and an adhesive label won't survive its own service life. And **the engineering
question doesn't need per-blade identity**: "which design lasts longest" is answered by
*per-installation* records — model or lot, installed on robot X at hour Y, removed at hour Z —
which is a maintenance event carrying a `model_id`, not an asset.

Per-blade identity would only earn its keep for warranty claims or failure traceability against
an individual unit.

---

## 10. Finance capitalization is out of scope

**Decided.** This system does not track capital assets. The finance ledger may cross-reference
into it; that's the extent of the relationship. **`fixed_asset` is not being built**, and the
capitalization threshold is not a design input.

Three residuals:

- **`owner_party_id` stays** — for custody and insurance, not accounting. Who owns a robot at a
  customer site matters whether or not anyone depreciates it.
- **`acquired_at` / `disposed_at` stay** — lifecycle facts, cheap, and the first thing finance
  asks for when reconciling.
- **Keep L4 as a defined level, unimplemented.** The capability ladder still reads correctly
  with the top rung empty, and it documents the boundary.

**If finance cross-references, give them `asset.id`, not the serial.** Serials are hand-entered
and admin-correctable — rare and early, but capitalization is also early, so the windows
overlap. A ledger row pointing at a string that later got corrected is a broken reference
nobody notices. The reference lives on their side; we build nothing.

---

## 11. Governance: Nandan owns the spine; CI enforces the rest

**Decided.** Nandan owns `asset`, `asset_type`, `asset_link` and `asset_event` as a platform
schema. Because that can't mean reviewing every change, the mechanism is default-deny with a
cheap alternative:

- **A rule in `CLAUDE.md`:** never add a column to those four tables without Nandan's explicit
  approval — default to the type's extension table, or `attributes` JSONB if it hasn't earned a
  column.
- **The JSONB escape hatch is what makes that livable** — a feature can ship capturing new field
  data without waiting, which removes the pressure that becomes a spine column. Subject to the
  opaque-blob rule in §1.
- **CODEOWNERS on the schema files**, so a spine change can't merge unseen.

The mechanical rules become tests, per Backbeat's stated model that CI is the quality gate
because a non-engineer maintains it:

- A schema test asserting any table with a serial/unit identifier **and** a status **and** a
  location or holder has an `asset_id` — the brief's own trigger test, as CI.
- A test asserting the app checks `asset_type` capability flags before exposing L2/L3 features,
  so registering an L0 type can't break the maintenance UI.
- The promotion runbook as a checklist **in `CLAUDE.md`**, beside "How to add a new module."
- A `modules/_template/` entity scaffold carrying the natural key, status, `created_at` and
  party reference — people copy code and skim standards.

---

## 12. Carried over from the brief, unchanged

See the brief; not restated here:

- Hybrid spine + type extension tables; coupling by `asset_id UNIQUE` FK, never shared PK (§3)
- Field placement rule: across types → spine; within one type → extension; not yet queried →
  `attributes` (§3), subject to §1
- Model vs. instance separation (§4.1)
- `asset_link` as a time-bounded edge, never a `vcu_id` column (§4.2)
- Levels of asset-ness L0–L4 as capability flags on `asset_type`; tiny mandatory core (§5–6)
- Promotion runbook (§7), especially step 5 — move cross-cutting columns out
- Scanning stack: `barcode-detector` + `zxing-wasm` + `react-zxing`, **self-hosted WASM**,
  `trySkew` on, 2D symbologies on the camera path (§9)
- Keyboard-wedge scanners with a programmed prefix sentinel, not a timing heuristic (§10)
- `bwip-js` for code generation; backend ZPL proxy for printing; polyester/polyimide media,
  tested before volume (§11)

### Amendments to the brief's mechanics

- **`maintenance_order` (L3) reads `inventory_transactions`; it does not duplicate them.**
  `commissionAsset` already stamps `reference_type = 'ASSET'` and `reference_id` on every part
  issued against an asset. That stream is the start of per-asset service history. A parallel
  parts-consumed log on the work order is the mistake to avoid.
- **The keyboard-wedge listener belongs in `core/`, not Gear.** Stash's receiving and picking
  flows want "scan anywhere in the app" just as much.
- **Self-hosting the WASM is about CSP and load reliability, not offline** — there's no service
  worker, so there is no true offline caching either way.

---

## 13. Still open

**None.** All Gear design decisions are settled.

**There is no legacy asset data to migrate.** Assets were never tracked in BarCloud —
`Barcloud-History.csv` in the repo root is inventory history, a Stash artifact, not Gear's.
So there is no backfill and no relabeling exercise: every asset enters the registry by being
registered, and gets its label at that moment. The L0-first sequencing in §14 is therefore
entirely about not creating the identity problem, rather than undoing one.

Initial population is an operational question, not a design one — wherever Royce's serial
records live today is the import source, and it can be a one-off script or manual entry
depending on volume.

Inherited from `DASHBOARD_CONVERGENCE.md` and not Gear's to resolve: infrastructure (Railway vs
bare metal), the quality model after merge, and where FIFO costing logic ends up.

---

## 14. Build order

Ordered so nothing expensive is retrofitted after labels are on equipment.

| # | Step |
|---|---|
| 1 | `party` (core); `asset_type` + capability flags; `lifecycle_state` lookup; `asset_model` (with manufacturer) |
| 2 | Migrate `assets`: rename `asset_tag` → `serial_number`, drop `NOT NULL`, filtered unique index, add `model_id`, `owner_party_id`, `custodian_party_id`, `acquired_at`, `disposed_at`, `attributes`; convert `asset_type` and `status` to FKs; rework `RETURNING` / `23505` per §1 |
| 3 | `locations`: add `is_inventory_location`, add the new types, filter Stash's pickers |
| 4 | Stable redirect host + path-based `/a/:serial` route (authenticated). **Print nothing before this** |
| 5 | Label generation (`bwip-js`) → backend ZPL proxy. Test media before volume |
| 6 | `asset_event` (with `occurred_at`) + state-change logging + scan-to-set-location — L1 |
| 7 | Camera scan component, self-hosted WASM |
| 8 | `asset_link` + two-scan link flow, overlap enforced in the service layer + filtered index — L2 |
| 9 | `asset_battery` — one extension table, to validate the FK+UNIQUE coupling |
| 10 | Keyboard-wedge listener in `core/` |
| 11 | `maintenance_order`, reading `inventory_transactions` — L3 |

`fixed_asset` (L4) is not in this plan; see §10. There is no legacy data migration — see §13.
