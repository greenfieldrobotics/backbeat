# Gear (Asset Management) — Requirements

**Status:** pre-implementation. Gear exists in the codebase only as a scaffold.
**Last updated:** 2026-09-07

---

## How to use this document

**This is a requirements document.** It states what Gear must do, why, and in what order
of priority. It is deliberately not a design or implementation document.

**Division of responsibility.** This document owns *what* and *why*: requirements, user
stories, priorities, decisions and the reasoning behind them. The implementing session owns
*how*: schema shape, file layout, library choices, and the sequencing of work — including
resequencing the priorities below where there is a technical reason to. Where this document
names a concrete mechanism, it is because the mechanism is a **constraint** (something
external forces on us) rather than a preference; those are marked as constraints in §6.

**Self-contained rule.** Every requirement needed to build or verify Gear must be stated in
this file. This codebase is maintained by sessions that see only the repository, so a
requirement that lives in an external document is one nobody can act on or verify. Do not
add requirements by reference to documents outside this repo. An asset-management design
brief was written on 2026-09-07 and informed much of this document; everything from it that
constitutes a requirement has been inlined here, and it is not needed to build Gear.

**When editing.**

- Keep the rejected alternatives in §5. The reasoning for what we chose *not* to do is the
  most valuable content here, and it is what stops decisions being relitigated.
- Add new work as a story in §4 with a priority, not as prose elsewhere.
- Record decisions with their rationale, in §5.
- Use the status vocabulary below consistently, and do not silently drop a requirement —
  move it to §7, §8 or §9 so the gap stays visible and schedulable.

**Status vocabulary.**

| Term | Meaning |
|---|---|
| **Settled** | Decided. Do not relitigate without new information |
| **Deferred** | A real requirement, deliberately not being built yet, with a stated trigger for revisiting |
| **Out of scope** | Not this system's job |
| **Not yet implemented** | Required, agreed, and currently missing — a gap to be scheduled |

---

## 1. Scope

> **Changed 2026-09-07 — Stash is on hold.** Inventory management is being done in **Shopify**,
> not the Stash module. Gear must **not** integrate with Stash: no new code may read or write
> Stash's tables or call its services.
>
> What this does and does not change:
> - The **boundary rule** in §1.1 stands unaltered. Only the name of the system on the other
>   side of it changes — "Stash inventory" now means "Shopify".
> - **G6.2 (parts consumed) is deferred**, because its stated mechanism was reading Stash's
>   inventory transactions. See §7.8.
> - **§7.3 (promoting Stash's suppliers into the party list) is moot** while Stash is on hold.
> - Code that **already** couples the two — `commissionAsset`, and the asset reference stamped
>   on Stash transactions — stays as built and tested. It is not extended.
> - No Shopify integration is specified here. Nothing in this document requires one, and none
>   should be built until it is.

**An asset is a valuable physical thing the company needs to track and manage over its
lifecycle.** Gear is the registry of those things.

The registry is expected to serve: maintenance records for robots; location and custody of
Greenfield-owned batteries; VCU-to-robot linkages; and whatever internal systems are built
next. Finance's capital asset ledger is explicitly **out of scope** — see §5.7.

### 1.1 The Gear/Stash boundary — Settled

Backbeat contains both an inventory module (Stash) and an asset module (Gear), so this
boundary is enforced by which module a thing is written to.

**Rule:** serialized **and** individually tracked **and** has a maintenance or depreciation
history → **Gear asset**. Otherwise → **Stash inventory** (quantity-at-location).

- Bolts, filters, wiring harnesses, blades → Stash.
- Robots, batteries, VCUs, vehicles, RTK bases, trailers, drones, laptops → Gear.
- **Nothing without a physical instance and a custody chain belongs in the registry**, however
  much it resembles an asset: software licenses, customer accounts, field boundaries.

### 1.2 Consumables must not enter the registry — Settled

Quantity-at-location is a different model from identity-with-lifecycle. Registering
consumables as assets produces a registry nobody can keep accurate, and double-counts cost:
the same physical thing cannot both consume Stash inventory value and carry its own.

---

## 2. Definitions

These are requirements, not background. Later sections depend on them.

### 2.1 Spine and type extensions

Gear must store assets as **one shared spine plus per-type extensions** — not one wide table
for all types, and not fully separate entities per type.

- **Why a spine:** cross-cutting questions — *what do we own, where is it, who has it* — must
  be answerable in one query. Without a shared spine every such report becomes a multi-way
  UNION that silently goes stale each time a type is added.
- **Why extensions:** type-specific attributes (battery state-of-health and cycle count, VCU
  firmware version and IMEI, robot blade hours) accumulate real constraints and real logic.
  They do not belong in a shared table full of nulls.

**Field placement rule** — this is the working rule for every future column:

| Test | Home |
|---|---|
| Queried **across** asset types | Spine |
| Queried only **within** one type, with real constraints | That type's extension |
| Captured but not yet queried | The spine's open `attributes` field, until it earns a column |

A column earns a place on the spine only when **two or more asset types query it**.

**Extension coupling:** an extension must reference the asset by a nullable-then-required
unique foreign key — never by making the asset's key its own primary key. This is required
because retrofit is the normal path (§2.4): telling a team to replace an existing primary key
that a dozen tables already reference is a rewrite nobody approves, whereas adding a unique
reference touches nothing. Native and retrofitted types then look identical.

### 2.2 Model vs. instance — Settled

The registry must separate the **catalog** from the **instance**. "Battery, Pack Type B" is a
catalog entry; "battery serial GFB-00417" is an asset.

Collapsing these means re-entering specifications hundreds of times and losing the ability to
answer *which battery model is failing early*. This is the most common failure of
first-generation asset systems and is the single hardest thing here to retrofit.

The catalog must carry the **manufacturer** (§5.1 and §5.2 both depend on it).

### 2.3 Levels of asset-ness

Not every asset type supports every feature, and partial adoption is the normal steady state —
not a backlog item. Each asset type must carry **capability flags** declaring the level it has
reached, and **the application must check those flags** rather than assuming every asset
supports every feature. Without this, the maintenance UI breaks the first time someone
registers an L0 type.

| Level | Adds | Unlocks |
|---|---|---|
| **L0 Registered** | identity, type, lifecycle state | asset label resolves; appears in "what do we own" |
| **L1 Located** | site, custodian, event stream | where-is-it queries, custody audit |
| **L2 Linked** | participates in asset links | parent/child: VCU-in-robot, battery-in-robot |
| **L3 Maintained** | maintenance orders | work orders, service history, MTBF |
| **L4 Capitalized** | finance join | depreciation, insurance, LeaseCo schedules — **out of scope, see §5.7** |

**The mandatory core must stay tiny.** Adoption cost determines adoption. To register an asset
the system may require only: type, a natural key, and lifecycle state. Everything else must be
optional. If registration demands owner, site, acquisition cost and depreciation class,
developers will skip registration and nobody will find out for two years.

### 2.4 Promotion: retrofit is the normal path

Other modules will build an entity first and recognize its asset nature later. The system must
make that promotion cheap. The runbook, to be applied whenever an existing entity becomes an
asset:

1. Register the type with its capability flags.
2. Add a nullable unique asset reference to the entity table.
3. Backfill one asset per entity row, mapping the entity's natural key to the serial.
4. Make the reference required; ensure new entity rows always create an asset row.
5. **Move the cross-cutting columns out.** The entity almost certainly has its own location,
   status and holder. Those now belong to the spine.
6. Ship a view named after the old table so existing readers don't break; deprecate on a clock.
7. Start the event stream at the promotion date. Do not manufacture history that doesn't
   exist — record when it was registered and leave the past in the entity's own tables.

**Step 5 is the one that gets skipped**, and skipping it is how an entity's own location and
the spine's location end up disagreeing with nobody noticing. It is not optional.

**Review trigger:** if a new table has a serial or unit identifier, **and** a status, **and** a
location or holder — it is an asset and must register at L0 immediately. L0 is cheap; identity
is what becomes expensive to retrofit once labels are physically on equipment.

**House convention for new physical-thing tables:** a natural key, a status, a creation
timestamp, and a reference to whoever holds it. Entities that follow it promote in an
afternoon; entities that invent their own status vocabulary and put location in free text take
a week. A copyable scaffold is worth more than a written standard, because people copy code
and skim documents.

---

## 3. What exists today

Gear is scaffolded, not built. This is the starting point, not a requirement.

| Exists | Location |
|---|---|
| `assets` — internal id, `asset_tag` (required, unique), `serial_number` (optional), free-text `asset_type`, status constrained to four values, location reference, notes | `server/src/modules/gear/schema.js` |
| Assets CRUD API and a service layer whose functions accept a transaction client | `modules/gear/routes/`, `services/assetService.js` |
| An Assets UI page registered in the module registry | `client/src/modules/gear/` |
| Shared core `locations` (Warehouse / Regional Site / Contract Manufacturer) used by both modules | `server/src/core/locations/` |
| `commissionAsset` — creates an asset and issues Stash parts against it in one transaction | `server/src/workflows/commissionAsset.js` |
| Google OAuth with an email allowlist and roles | `server/src/core/auth/` |

Two consequences: the first work is a **migration of a live scaffold**, not a greenfield
build; and `commissionAsset` already stamps an asset reference onto every Stash transaction,
which is the beginning of per-asset service history (§4.6).

---

## 4. Requirements and stories

Priorities are product priorities. **P0** is required for the prototype to be useful; **P1**
follows; **P2** is real but later. The implementing session may resequence within and across
these where there is a technical reason — see §10.

### Epic G1 — Registry (L0)

**G1.1 Register an asset · P0**
As anyone commissioning equipment, I want to register a physical thing with its type, serial
and state, so it appears in "what do we own."
*Acceptance:* only type, serial and lifecycle state are required; every other field optional.
Duplicate serials are rejected with a clear error (§5.1).

**G1.2 Asset types as data · P0**
As an admin, I want to add a new asset type without a code change or a migration.
*Acceptance:* types are rows carrying capability flags (§2.3), not values hardcoded in the
schema or the UI. Today the type is free text and the UI hardcodes five values.

**G1.3 Lifecycle states as data · P0**
As an admin, I want to add a lifecycle state without a migration.
*Acceptance:* states are rows, not a fixed constraint. Starting set is the existing four —
Available, In Use, Maintenance, Retired — extended as reality demands. No transition rules yet
(§7.2).

**G1.4 Model catalog · P0**
As an engineer, I want specifications held once per model rather than per unit, so I can ask
which model fails early.
*Acceptance:* §2.2 satisfied; the catalog carries manufacturer.

**G1.5 Ownership and custody · P0**
As the business, I want to record who **owns** an asset separately from who **holds** it.
*Acceptance:* both reference the shared party list (§5.3); owner defaults to Greenfield;
custodian may be a customer or an entity, not only a system user.

**G1.6 Open attributes · P1**
As a developer, I want to capture new field data before we've decided what it means, without
adding a column to the spine.
*Acceptance:* an open attributes field exists on the spine, subject to the constraint in §6.2.
It must not become the permanent home for everything — §2.1's placement rule governs.

### Epic G2 — Identity and labelling

**G2.1 Serial as the human identity · P0**
As Royce, I want the serial I already assign to be the identity in the system, with no second
Greenfield numbering scheme to maintain.
*Acceptance:* §5.1. Serials are normalized on write (trimmed, uppercased) because they are
hand-entered and matched exactly by scanners.

**G2.2 Label resolves to the asset · P0**
As a technician, I want to scan a label and land on that asset in the app.
*Acceptance:* the label encodes a URL whose path carries the serial; scanning with a phone
camera deep-links into the asset with no scanner UI. Unauthenticated scans fail to a login
screen (§5.5).

**G2.3 Durable label host · P0 — prerequisite for any printing**
As the business, I want to move or re-platform the app without relabeling equipment.
*Acceptance:* the printed URL points at a stable host we control that redirects to wherever
the app currently lives. **Nothing may be printed before this exists** — see the constraint in
§6.4 explaining why.

**G2.4 Print labels · P1**
As a technician, I want to print a durable label for a newly registered asset.
*Acceptance:* codes generated for QR and DataMatrix; the human-readable serial always printed
alongside the code, for when the code is scuffed or damaged. Symbology by asset class:

| Asset | Symbology | Why |
|---|---|---|
| Robots, vehicles, trailers | QR | large surface, phone-camera friendly |
| Batteries | QR or DataMatrix | depends on available flat area |
| VCUs, small electronics | DataMatrix | smaller footprint, better error correction on small marks |
| Bins, locations, shelves | QR | scan-to-set-location workflows |

**G2.5 Label media survives the season · P1 — procurement, not code**
Paper will not survive a battery pack in a Kansas summer or a robot deck through a season.
Polyester or polyimide with aggressive adhesive, or laser-etched metal for chassis-mounted
items. **Budget a test batch and abuse it before printing 500.**

### Epic G3 — Location and custody (L1)

**G3.1 Asset locations distinct from storage areas · P0**
As the business, I want to record that a robot is at a customer's field or in transit — places
that are not controlled storage.
*Acceptance:* §5.2. Stash's pickers continue to offer only controlled storage areas.

**G3.2 Event stream · P0**
As anyone, I want to see where an asset has been and who held it.
*Acceptance:* an append-only event stream records location, custody and **state changes**.
Every lifecycle state change writes an event — see §6.5 for why this cannot be deferred.

**G3.3 Scan to set location · P1**
As a technician, I want to scan an asset then scan a bin or site to record that it moved
there.
*Acceptance:* two-scan flow, usable with a dedicated scanner and no keyboard.

### Epic G4 — Scanning

**G4.1 Camera scanning · P1**
As a technician with a phone, I want to scan a label without special hardware.
*Acceptance:* works on iOS and Android — see the constraint in §6.3, which rules out relying on
the browser's native barcode API. 2D symbologies (QR, DataMatrix) are the supported camera
path; 1D is not reliable off a phone camera in sun and dust, and is reserved for dedicated
hardware.

**G4.2 Scan from anywhere in the app · P1**
As a warehouse or shop user with a dedicated scanner, I want to scan at any screen and jump
straight to that asset.
*Acceptance:* the scanner is programmed to emit a sentinel prefix and the app listens globally
for it; **timing heuristics are not acceptable** — they produce false positives from ordinary
typing. This listener belongs to the whole application, not to Gear: Stash's receiving and
picking flows need it equally.

**G4.3 Photograph now, resolve later · P2**
As a technician without connectivity or access, I want to photograph a code and upload it when
I'm back, so the scan still counts.
*Acceptance:* decoding a still image, and the idempotency requirement in §7.1 — the same photo
will be uploaded twice.

### Epic G5 — Linking (L2)

**G5.1 Time-bounded links · P1**
As an engineer diagnosing a field failure months later, I want to know which VCU was in which
robot **on that date**.
*Acceptance:* links are dated edges between assets — not a column on the robot. Batteries and
VCUs move; a column cannot represent history. One relationship type covers battery-in-robot,
robot-on-trailer and RTK-base-serving-field. An asset must not have two conflicting active
parents at once.

**G5.2 Two-scan linking · P1**
As a technician, I want to scan a battery then a robot to record the installation.
*Acceptance:* works with a dedicated scanner, no keyboard, gloves on.

### Epic G6 — Maintenance (L3)

**G6.1 Work orders against any asset · P2**
As field ops, I want a service history per asset regardless of its type.

**G6.2 Parts consumed · Deferred — see §7.8**
As the business, I want to see what parts a repair consumed without recording them twice.

**Deferred 2026-09-07.** The acceptance criterion was that maintenance *reads* Stash's
inventory transactions rather than keeping its own log. With Stash on hold and inventory in
Shopify, that mechanism no longer exists. The **principle survives and still binds**: whatever
system holds inventory is the single source of truth for parts consumed, and Gear must not keep
a parallel parts-consumed log to work around not having the integration.

**G6.3 Component wear by model · P2**
As an engineer, I want to know how long a blade design lasts.
*Acceptance:* satisfied by installation records referencing the **model** — installed on robot
X at hour Y, removed at hour Z, condition on removal. Explicitly **not** by making blades
assets (§5.6).

### Epic G7 — Governance and extensibility

**G7.1 Spine changes are gated · P0 — blocked, see §9**
As the platform owner, I want a column added to the spine only deliberately.

**G7.2 Promotion runbook is discoverable · P1**
As a future maintainer, I want §2.4 available where I will actually see it — in `CLAUDE.md`,
beside the existing "How to add a new module" section.

**G7.3 New-entity scaffold · P2**
As a future maintainer, I want a copyable template carrying the house convention from §2.4.

---

## 5. Decisions

Settled. The reasoning matters more than the conclusion — it is what stops these being
reopened.

### 5.1 Identity: internal id, serial as the human identity

- **Internal id**, assigned by the system. Primary key, never shown to a user, never printed.
- **Serial number** is the identity humans use, assigned by whoever manufactured the thing:
  Royce's convention for anything Greenfield builds, the manufacturer's number for anything
  bought, the VIN for vehicles. Optional (some things have none or illegible ones), unique
  across the registry, normalized on write.
- **No separate Greenfield asset tag.** Greenfield has no tag scheme distinct from serials.
  Inventing one creates a convention someone must maintain, a second number on every label,
  and no current benefit. The scaffold's `asset_tag` column is dropped; `serial_number` takes
  its place as the required-in-practice unique field.

**Rejected: client-generated globally unique ids (UUIDs).** They buy exactly one thing an
internal sequence cannot — an id minted by a client with no database connection. The scenario
that motivated it, a technician linking a VCU to a robot offline, does not need it: both assets
already exist, and the new link is referenced by nothing, so the server can assign its id at
sync. Client-minted ids are only required when an offline-created record is referenced by
*another* offline-created record before sync — which would mean registering brand-new assets in
the field. Registration means printing and applying a label, which means a bench and
connectivity. Not a real case. *Revisit if bulk receiving ever happens away from a facility.*

**Accepted risk: serial collisions across manufacturers.** Registry-wide uniqueness assumes
manufacturer serial namespaces don't overlap — true for VINs, Dell tags and Royce's numbers,
false the day two component vendors both ship something numbered `1001`, or one vendor reuses
numbers across product lines. Accepted because it **fails loudly**: the registration is
rejected, someone sees an error, nothing is silently corrupted. The remedy is to make
uniqueness depend on manufacturer as well, and manufacturer is already captured (§2.2).

### 5.2 Locations: one list, flagged — and not joined to vehicle assets

**One shared location list, with a flag marking which entries are controlled storage areas.**
Stash's pickers filter on the flag; Gear's do not. An inventory location is a *kind* of
location, not a different entity. Two separate lists would put Lenexa in the system twice and
require a mapping for every cross-module question.

Needs at least Farm, In Transit and Customer Site alongside the existing Warehouse, Regional
Site and Contract Manufacturer.

**Rejected: linking a truck-as-location to the same truck-as-asset.** They are different
concepts that only sometimes coincide, and the non-overlaps prove it: a *rented* truck is a
location and not an asset; a truck carrying no stock is an asset and not a location; a robot in
a customer's field has an asset location that is not a storage area at all. Linking them buys
one thing — deactivating the storage location when the truck is sold — which is a rare event a
human notices. *Revisit when a real question needs the join.*

### 5.3 Party is a shared, core concept

Owner and custodian reference a shared list of people and organizations — internal entities,
employees, customers, vendors — not the system's user table. A customer holding a RaaS robot is
not a login, and the LeaseCo structure means the owner is not always Greenfield.

This list is **core**, shared with Stash, not owned by Gear. Treat it as the master list of
people and entities, with system users being those parties that can log in, so the two cannot
drift apart.

### 5.4 Lifecycle states are not baked in

The vocabulary will churn, and different capability levels will want different lifecycles.
States are data, so extending them is an admin action rather than a migration. Transition rules
are deferred (§7.2).

### 5.5 No public label resolver

A scan by someone not logged in fails to a login screen. An earlier proposal — that a label
resolve to a limited public view for someone without app access — is dropped; a technician who
cannot authenticate can photograph the code and upload it later (G4.3).

This does **not** change the requirement to encode a URL rather than a bare serial (G2.2): the
value is the no-UI deep link for authenticated users, which doesn't depend on public access.

### 5.6 Blades are inventory

They stay inventory — in Shopify, since Stash is on hold — with cost layers and reorder
points wherever that inventory lives. The point is that they are quantity-at-location, not
registry entries.

Two reasons. **A blade cannot carry a durable identifier** — it is a wear part living in dirt
and rock strikes, and no label survives its own service life, which makes identity unreadable
exactly when you'd want it. And **the engineering question doesn't need per-blade identity**:
"which design lasts longest" is answered by per-installation records against the model (G6.3).
Per-blade identity would only earn its keep for warranty claims or failure traceability against
an individual unit.

### 5.7 Finance capitalization is out of scope

This system does not track capital assets and will not build a fixed-asset join. The finance
ledger may cross-reference into Gear; that is the whole relationship. The capitalization
threshold is therefore not a requirement input.

Three things survive that descoping:

- **Owner and custodian stay** — for custody and insurance, not accounting.
- **Acquisition and disposal dates stay** — lifecycle facts, and the first thing finance asks
  for when reconciling.
- **L4 stays defined but unimplemented**, so the capability ladder documents the boundary
  instead of pretending it isn't there.

**If finance cross-references, give them the internal id, not the serial.** Serials are
hand-entered and admin-correctable — rare, and early in an asset's life, but capitalization is
also early, so the windows overlap. A ledger row pointing at a corrected string is a broken
reference nobody notices.

### 5.8 Frontend: React with TypeScript, no PWA infrastructure

React Native is rejected. Its real advantage is native camera scanning on difficult 1D reads —
but the recommended hardware for warehouse and shop is a rugged Android device with a built-in
imager, which delivers scans as ordinary keystrokes, so the hard reads move to hardware
regardless. A second codebase would solve a problem the scanner already solved, and the same
decision governs the Stash service-tech mobile view, so it is made once for both.

See §6.1 — this is also a convergence constraint, not only a preference.

---

## 6. Constraints

External facts the implementation must live with. These are not preferences and should not be
traded away without the constraint changing.

### 6.1 Convergence with the dashboard application

Backbeat is being harmonized with `greenfieldrobotics/dashboard` and will eventually merge into
it. See `docs/DASHBOARD_CONVERGENCE.md`, which is in this repo. Dashboard is Flask over SQL
Server, with a React 18 + TypeScript + Vite client using hash routing, served as a built SPA,
**with no service worker and no manifest**.

Consequences for Gear, which is the newest code in the repo and therefore the code most able to
be born portable: write the frontend in TypeScript from the start, follow that document's
client conventions, and **do not change the router** — routing is a merge-time decision.

### 6.2 SQL Server portability

Convergence task 3 says: don't migrate, just stop adding constructs that would need rewriting.
A new module should add none. The four that bite:

- **Optional-but-unique columns.** Postgres permits many empty values under a uniqueness
  constraint; **SQL Server permits exactly one.** Two unserialized assets would violate it after
  a port. The requirement — assets may have no serial, and those must not collide with each
  other — therefore cannot be met with a plain unique constraint. A filtered/partial unique
  index expresses it in both engines.
- **The open attributes field is an opaque blob.** SQL Server has no equivalent structured JSON
  type and no indexing for it. Read it whole in application code; never query into it, never
  index it. That matches §2.1's intent, but now with teeth.
- **No exclusion constraints.** The natural Postgres tool for "no overlapping active links"
  (G5.1) cannot be expressed in SQL Server at all. Enforce the rule in the service layer, with a
  filtered unique index on active links as the backstop.
- **No `RETURNING`, no `ON CONFLICT`** in new code. The existing `assetService.js` uses both and
  will need reworking when the scaffold is migrated.

### 6.3 iOS has no native barcode API

Chrome on Android implements the browser's native barcode detection API; Safari does not, and
every iOS browser uses Safari's engine. A camera-scanning feature built on the native API alone
**fails silently on every iPhone and iPad**. G4.1 therefore requires a polyfill or library
providing one behaviour across platforms, with its decoder self-hosted rather than loaded from a
public CDN — for content-security and load reliability, not for offline, since there is no
service worker (§6.1).

### 6.4 The label URL is irreversible

Whatever host is printed on a label is permanent once labels are on equipment. The application
will move — it runs on Railway today, and convergence has it leaving for the dashboard's host —
and its URL shape will change with the router decision. Hence G2.3.

One mechanical detail that is easy to get wrong and expensive to discover: **a URL fragment is
never sent to the server**, so a label URL must carry the serial in the path, with the landing
page translating it into whatever route form the app uses at the time.

### 6.5 History cannot be backfilled

Three things cost almost nothing now and are unrecoverable if skipped:

1. **When something happened, recorded separately from when the system heard about it.** Without
   the distinction, any event captured offline and submitted later is stamped with its
   submission time and the history is quietly wrong. The two are simply equal until offline
   exists.
2. **Every lifecycle state change written to the event stream** (G3.2). State as a field alone
   gives a current value and no history; *how long do robots sit in Maintenance* becomes
   permanently unanswerable.
3. **Manufacturer on the model catalog** (§2.2) — needed the day two serials collide, and the
   only way to ask which model fails early.

---

## 7. Deferred requirements

Real requirements, deliberately not being built yet. Each has a trigger.

| # | Requirement | Trigger to revisit |
|---|---|---|
| 7.1 | **Offline capture and sync.** Deferred: it is the most expensive item here and the least likely to survive contact with how people work; the warehouse and shop have connectivity, which is where the scanning happens. When built it needs a client-supplied idempotency key on queued records, so a retried scan or a re-uploaded photo doesn't post twice — an optional field, easily added later | Field work proves it necessary; or G4.3 ships |
| 7.2 | **Lifecycle transition rules.** Until they exist, any state may follow any state | State errors become a real data-quality problem |
| 7.3 | **Promoting Stash's supplier list into the shared party list** (§5.3). **Moot while Stash is on hold** — recorded in case Stash returns. Follow §2.4 if it does | Stash comes off hold *and* a question needs suppliers and parties in one list |
| 7.4 | **Joining a truck-as-location to a truck-as-asset** (§5.2) | A real question needs the join |
| 7.5 | **Per-blade identity** (§5.6) | Warranty or failure traceability against an individual blade |
| 7.6 | **Manufacturer-scoped serial uniqueness** (§5.1) | The first genuine collision — which will announce itself |
| 7.8 | **Parts consumed on a maintenance order** (was G6.2). Needs an inventory system to read from. Shopify is where inventory lives now, and no Shopify integration is specified. Whenever it is built, the rule holds: read from the system of record, never keep a parallel log | A Shopify integration is specified, or Stash comes off hold |
| 7.7 | **Retire an asset instead of deleting it.** Deleting an asset currently deletes its whole event history with it — every asset has a `registered` event from birth, so refusing to delete assets that have events would make every asset undeletable. Accepted while there are no real assets. The registry is meant to be the record of what the company owns, and a history a delete button can erase is not an audit trail. `lifecycle_states` already carries `Retired` and an `is_terminal` flag, which is the mechanism | **Before real assets are registered.** This is the trigger that matters: it is cheap to change while the only assets are test data, and it is a data-loss question afterwards |

---

## 8. Out of scope

- **Finance capital asset tracking** (§5.7). The ledger may reference Gear; Gear builds nothing
  for it. L4 stays defined and unimplemented.
- **Inherited from `docs/DASHBOARD_CONVERGENCE.md`, not Gear's to resolve:** which
  infrastructure the backend runs on, which quality model survives the merge, and where the FIFO
  costing logic ends up.

---

## 9. Not yet implemented — prerequisites for the governance model

**G7.1 depends on enforcement that does not exist.** There is no `.github/` directory in this
repository: no CI workflow and no code-owners file. PR #4 confirms it, reporting no checks on
the branch. So a schema test could be written today and nothing would run it on a pull request,
and an ownership rule could be written and nothing would gate a merge against it.

This matters more here than in most projects, because Backbeat's stated premise is that
**automated tests are the quality gate precisely because a non-engineer maintains the system**.
Governance that depends on someone remembering is not governance.

Required, and currently missing:

1. **CI running the test suites on every pull request**, with merges blocked on failure.
2. **A code-owners rule covering the spine schema files**, so a spine change cannot merge
   unseen.
3. **A written rule in `CLAUDE.md`**: no column is added to the spine or to the type, link and
   event tables without the platform owner's explicit approval — default to the type's extension
   or the open attributes field. The open attributes field is what makes this livable: a feature
   can ship capturing new data without waiting, which removes the pressure that becomes a spine
   column.
4. **Tests expressing the rules**, once something runs them: the §2.4 review trigger (a table
   with a serial, a status and a location or holder must have an asset reference), and the §2.3
   requirement that the application checks capability flags before exposing L2/L3 features.

**Platform owner: Nandan**, for the spine and the type, link and event tables. Since that cannot
mean reviewing every change, items 1–3 are what make the ownership real rather than nominal.

---

## 10. Priority summary

Product priority, not an implementation plan. The implementing session should resequence where
there is a technical reason, and is better placed to judge what to batch.

| Priority | Stories | Rationale |
|---|---|---|
| **P0** | G1.1–G1.5, G2.1, G2.2, G2.3, G3.1, G3.2, G7.1 | Identity, the registry itself, and the two things that are expensive to retrofit later: the label URL and the event stream |
| **P1** | G1.6, G2.4, G2.5, G3.3, G4.1, G4.2, G5.1, G5.2, G7.2 | Makes the registry usable in the field |
| **P2** | G4.3, G6.1–G6.3, G7.3 | Depth once the registry is trusted |

**One ordering constraint that is not negotiable:** G2.3, the durable label host, must land
before anything is printed. Everything else can move.

**There is no legacy data to migrate.** Assets were never tracked in BarCloud — the CSV in the
repository root is inventory history, a Stash artifact. Every asset enters the registry by being
registered and is labelled at that moment, so there is no backfill and no relabelling exercise.
Initial population is operational: wherever Royce's serial records live today is the source.
