# Backbeat / Stash Module - User Stories

> **Backbeat** is the ERP system. **Stash** is the inventory management module.
>
> Sources:
> - Greenfield Robotics - Consolidated User Stories (Including FIFO Costing)
> - BarCloud Tutorial (Base User) - legacy system workflows
> - BarCloud Tutorial (Admin User) - legacy system admin workflows
> - Inventory Management Proposal: Workflow and Tracking (Seema Gupta, 2/17/26)

---

## Guiding Principles

*Source: Seema Gupta — Inventory Management Proposal*

1. **Availability First** — Parts must be usable immediately upon receipt. Receiving
   never blocks operations.
2. **Visibility Over Perfection** — All inventory must enter the system same-day.
   Cleanup can lag; visibility cannot.
3. **Financial Discipline Without Operational Drag** — FIFO is enforced financially
   at consumption, not physically at pick.
4. **Exceptions Are Surfaced, Not Hidden** — Discrepancy flags (ISSUE) preserve speed
   while protecting accounting integrity.

---

## Inventory States

*Source: Seema Gupta — Inventory Management Proposal, Section 4*

Inventory items exist in one of these operational states:

| State | Meaning | Usable? |
|---|---|---|
| **AVAILABLE** | On shelf, ready for use | Yes |
| **WIP** | Checked out to a specific project; in process | No (reserved) |
| **OBSOLETE** | End-of-life; segregated for disposition | No |
| **DAMAGED** | Physically unfit; segregated for disposition | No |

State transitions:
- AVAILABLE → WIP (via project checkout, Story 5.6)
- WIP → consumed (via assembly build, Story 4.2)
- AVAILABLE → OBSOLETE or DAMAGED (via disposition, Story 5.2)
- WIP → AVAILABLE (via return/un-checkout, Story 5.4)

The **ISSUE flag** is an orthogonal data overlay — not a state. It marks records that need
reconciliation (PO mismatch, provisional cost, wrong part, incomplete part master) without
blocking availability. See Story 9.1.

---

## Epic 1: Core Inventory & Part Master Data

### Story 1.1 - Maintain Part Catalog
**Role:** Inventory Admin
**Goal:** Create and manage a master list of parts so all inventory transactions reference consistent definitions.

**Acceptance Criteria:**
- Fields: Part Number, Description, Unit of Measure, Classification, Cost (unit, 125pc, 600pc)
- Manufacturer and reseller tracking (mfg part number, manufacturer, reseller, reseller part number)
- Notes field for additional context
- Classification by prefix category (Assembly, Cutter System, Electronics, Sensor, Track System, Hardware, Production, Wiring, Misc)
- Supports 600+ distinct parts
- Search/filter by part number, description, manufacturer, and classification
- Part master completeness indicator: flag parts missing critical fields (cost, manufacturer, classification) so incomplete records are visible and actionable *(Source: Seema — incomplete part master is an ISSUE trigger)*

---

### Story 1.2 - Support Part Variants
**Role:** Inventory Admin
**Goal:** Define product variants so inventory reflects 4 product configurations accurately.

**Acceptance Criteria:**
- Variants share components
- Variants usable in BOMs and finished goods tracking

---

### Story 1.3 - Track Locations
**Role:** Inventory Admin
**Goal:** Define multiple stocking locations so replacement parts and CM inventory are visible by site.

**Acceptance Criteria:**
- Locations: Main Warehouse, Regional Sites, Contract Manufacturer (virtual)
- Inventory tracked per location

---

## Epic 2: Purchase Orders & Receiving (Strategic Components)

### Story 2.1 - Create Purchase Orders
**Role:** Procurement User
**Goal:** Create POs for long-lead components so Greenfield can track inbound inventory.

*Source enhancement: Seema — POs are created in the accounting system and uploaded/referenced in Stash. Ship-to field must include "Inventory – [Location]".*

**Acceptance Criteria:**
- Fields: Supplier, Expected Delivery Date, Line Items (part, qty, unit cost)
- Status flow: Draft → Ordered → Partially Received → Closed
- PO must be in system before receipt can be processed (PO-first workflow)
- Each line item includes GF part number, quantity, and estimated cost
- Ship-to / receiving location captured at PO level

---

### Story 2.2 - Receive PO Inventory (Mobile)
**Role:** Warehouse Staff
**Goal:** Scan and receive inventory against a PO so incoming parts are logged quickly and accurately.

*Source enhancement: Seema — "Availability First." Inventory becomes AVAILABLE immediately on receipt, same day. Discrepancies are flagged, never blocking.*

**Acceptance Criteria:**
- Barcode scan or search
- Enter quantity received
- Inventory increases at selected location with state = AVAILABLE
- Creates FIFO cost layer with unit cost from PO line item
- **Same-day receipt required** — receipt must happen the day delivery arrives to preserve FIFO layer timing integrity
- **Discrepancy handling (sets ISSUE flag):**
  - Quantity received ≠ quantity on PO line → partial receipt allowed, ISSUE flag set on the discrepancy
  - No matching PO found → receipt still allowed (availability first), but ISSUE flag set with reason "PO missing"
  - Unit cost unknown or provisional → receipt allowed with best-known cost, ISSUE flag set with reason "provisional cost"
  - Wrong part received → receipt logged with ISSUE flag, reason "wrong part received"
- Discrepancies never block receiving — parts are AVAILABLE immediately regardless of ISSUE status

---

## Epic 3: Inventory Transfers

### Story 3.1 - Move Inventory Between Locations
**Role:** Warehouse Staff
**Goal:** Move inventory between any locations (warehouses, regional sites, vehicles, bots) so stock is tracked wherever it goes.

*Source: BarCloud "Move" transaction*

**Acceptance Criteria:**
- Select: From Location, To Location, Part, Quantity
- Inventory decreases at source, increases at destination
- FIFO layers move with the inventory
- Transaction logged in audit trail

---

### Story 3.2 - Create Transfer Shipment to CM
**Role:** Warehouse Staff
**Goal:** Create transfer orders to the CM so strategic components are tracked when leaving Greenfield.

**Acceptance Criteria:**
- Destination: CM
- Packing list generated
- Status flow: Prepared → Shipped → Confirmed

---

### Story 3.3 - Scan Outbound Transfer (Mobile)
**Role:** Warehouse Staff
**Goal:** Scan parts when shipping to CM so outbound inventory is accurate.

**Acceptance Criteria:**
- Scan part barcode
- Deduct inventory from warehouse
- Move FIFO layers to CM location

---

## Epic 4: Light In-House Manufacturing (Workshop)

*Source enhancement: Seema Gupta — Inventory Management Proposal, Sections 3, 5D, and 6*

### Story 4.1 - Define BOMs
**Role:** Operations Admin
**Goal:** Define BOMs for 4 product variants so workshop builds deduct correct components.

**Acceptance Criteria:**
- Supports ~40 components per BOM
- Simple version control (optional)
- BOM includes: component part, quantity per assembly, and optional reference designator
- BOM can be cloned to create variants
- BOM validation: warn if any component part does not exist in the part catalog

---

### Story 4.2 - Build Finished Goods (Assembly Conversion)
**Role:** Workshop Staff (physical build); Inventory Admin (system conversion — Tyler)
**Goal:** Record assembly of finished units so inventory reflects component consumption and product creation.

*Source enhancement: Seema — assembly conversion is centralized to protect FIFO and cost integrity. Tyler triggers the system conversion, not the builder.*

**Acceptance Criteria:**
- Select variant (BOM) and quantity to build
- Components must be in WIP state for the relevant project (not consumed directly from AVAILABLE)
- Consume WIP components via FIFO (oldest cost layers first)
- Create finished goods FIFO layer with total cost = sum of consumed component layer costs
- Assembly conversion is restricted to Inventory Admin role (centralized control)
- Transaction logged in audit trail: components consumed, assembly created, total rolled-up cost

**Manual Fallback (when BOM is unavailable or prototype):**
- Admin manually decrements WIP components and increments the assembly item
- Cost roll-up must still be verified against FIFO layers

**Assembly Cost Audit:**
- Finished goods cost must equal the sum of FIFO-applied component layers
- Monthly sample audit: system can generate a report comparing assembly cost to component layer costs
- Discrepancies are flagged for investigation

---

## Epic 5: Replacement Parts & Regional Stock

### Story 5.1 - Issue Replacement Parts
**Role:** Warehouse Staff
**Goal:** Issue parts for service or field repair so service usage is recorded and costed correctly.

*Source: BarCloud "Issue" transaction (issue to bots/vehicles/individuals)*

**Acceptance Criteria:**
- Scan part barcode or search by stock number
- Select target: bot/vehicle ID, individual, or general reason
- Deduct via FIFO
- Log reason, target unit/person reference, and timestamp
- Only AVAILABLE inventory can be issued (WIP inventory is reserved for its project)

---

### Story 5.2 - Dispose of Inventory
**Role:** Warehouse Staff
**Goal:** Record disposal of damaged, obsolete, or expired inventory so stock levels and valuation stay accurate.

*Source: BarCloud "Dispose" transaction*

**Acceptance Criteria:**
- Select part, location, quantity
- Log disposal reason (damaged, obsolete, expired, etc.)
- Deduct via FIFO
- Transaction logged in audit trail with cost impact

---

### Story 5.3 - Reorder Alerts
**Role:** Admin User
**Goal:** Define minimum stock thresholds so regional sites do not run out unexpectedly.

**Acceptance Criteria:**
- Min/max levels per location
- Low stock dashboard alerts

---

### Story 5.4 - Return Parts to Inventory
**Role:** Warehouse Staff
**Goal:** Return previously issued parts back to inventory so stock levels and FIFO valuation are corrected.

*Source: BarCloud "Return" transaction (7 occurrences in historical data)*

**Acceptance Criteria:**
- Select part, location, quantity, and unit cost
- Creates a new FIFO cost layer (source_type: RETURN)
- Inventory quantity increases at the specified location
- Transaction logged in audit trail with reason
- Supports linking back to the original issue reason (e.g., "repair", "R&D") for traceability

---

### Story 5.5 - Adjust Inventory (Physical Count Reconciliation)
**Role:** Inventory Admin
**Goal:** Correct inventory quantities after a physical count so the system matches actual stock on hand.

*Source: BarCloud "Adjust" transaction (245 occurrences — 12% of historical transactions)*

**Acceptance Criteria:**
- Select part, location, and new actual quantity (physical count)
- System calculates the delta (positive or negative adjustment)
- System displays before quantity, after quantity, and delta before user confirms

**Negative Adjustments (shortage — count < system):**
- Consume FIFO layers oldest-first (same as Issue/Dispose)
- Record the extended cost of consumed layers
- Never modify or edit historical FIFO layers

**Positive Adjustments (overage — count > system):**
- Create a new FIFO cost layer (source_type: ADJUSTMENT)
- Cost selection hierarchy:
  1. If documentation exists (e.g., missed PO receipt) → use actual purchase cost
  2. If recent FIFO layer exists for same part → use most recent layer cost
  3. If no reliable cost data → use current replacement cost or standard cost from part catalog
- Never modify historical FIFO layers
- Never spread quantity across existing layers

**Controls:**
- Admin-only operation
- Requires a reason code (e.g., "Physical count", "Cycle count correction")
- Requires approval above defined quantity or dollar thresholds (threshold TBD)
- Transaction logged in audit trail with before/after quantities and cost impact
- Optional: attachment support (e.g., photo of count sheet)

---

### Story 5.6 - Checkout Parts to Project (AVAILABLE → WIP)
**Role:** Warehouse Staff / Operations
**Goal:** Reserve parts for a specific project so they are no longer available for general use, and so project cost tracking is accurate.

*Source: Seema Gupta — Inventory Management Proposal, Sections 3 and 5C*

**Acceptance Criteria:**
- Select part, location, quantity, and project
- Project is a required field (e.g., NTRIP, R&D, Repair, Bot Build #, or other project identifier)
- Inventory state changes from AVAILABLE → WIP
- FIFO layers are preserved (not consumed) — cost is recognized at assembly/consumption, not at checkout
- Quantity moves from AVAILABLE pool to WIP pool at the same location
- Transaction logged in audit trail with project reference
- WIP inventory is visible but clearly distinguished from AVAILABLE inventory in all views
- WIP inventory cannot be issued (Story 5.1) or moved (Story 3.1) without first being returned to AVAILABLE

**Project Tracking:**
- System maintains a list of active projects
- Each WIP checkout is tagged with exactly one project
- Dashboard can show inventory allocated by project

---

### Story 5.7 - Return WIP to Available (Un-Checkout)
**Role:** Warehouse Staff / Operations
**Goal:** Return parts from WIP back to AVAILABLE when they are no longer needed for a project, so they become available for general use again.

*Source: Seema Gupta — Inventory Management Proposal (implied by WIP → AVAILABLE flow)*

**Acceptance Criteria:**
- Select part, location, quantity, and source project
- Inventory state changes from WIP → AVAILABLE
- FIFO layers preserved (no cost impact — layers were never consumed)
- Transaction logged in audit trail with project reference and reason
- Reason required (e.g., "project cancelled", "excess pulled", "wrong part")

---

## Epic 6: FIFO Costing (Core Financial Requirement)

### Story F1 - Create FIFO Cost Layers on Receipt
**Role:** System (automated)
**Goal:** Create a FIFO cost layer on every receipt so inventory value is tracked by receipt lot and unit cost.

*Source enhancement: Seema — same-day receipt with cost entry establishes correct cost layer timing and prevents mis-sequenced valuation.*

**Acceptance Criteria:**
- Each receipt creates a distinct layer
- Tracks: original qty, remaining qty, unit cost, date
- Multiple receipts create multiple layers
- Layer timestamp is set at receipt time (not PO creation time) to ensure correct FIFO ordering
- Provisional cost layers (from receipts with ISSUE flag) can be corrected via a cost update transaction that creates a new adjustment layer — original layer is never modified

---

### Story F2 - Consume Inventory Using FIFO
**Role:** System (automated)
**Goal:** Consume oldest cost layers first during issues or builds so COGS and valuation follow FIFO rules.

*Source enhancement: Seema — FIFO is enforced financially at consumption, not physically at pick. WIP allocation preserves layers; consumption depletes them.*

**Acceptance Criteria:**
- Oldest layer depleted first
- Partial layer consumption supported
- Layer consumption logged
- FIFO applies at these events: Issue (5.1), Dispose (5.2), Assembly Build (4.2), Negative Adjustment (5.5)
- FIFO does NOT apply at: Move (3.1 — layers transfer), WIP Checkout (5.6 — layers preserved)
- Assembly builds consume WIP component layers and roll up cost into the finished goods layer

---

### Story F3 - FIFO Inventory Valuation Report
**Role:** Finance / Admin
**Goal:** Run valuation reports based on remaining FIFO layers so financial reporting is accurate.

**Acceptance Criteria:**
- Inventory value by part and location
- Layer-level detail
- Export to CSV

---

### Story F4 - Audit Trail & Cost Integrity Controls
**Role:** Admin
**Goal:** Prevent unauthorized edits to cost layers so FIFO costing remains reliable.

**Acceptance Criteria:**
- FIFO layers are immutable once created — no editing of historical quantities, costs, or dates
- Corrections are always made via new transactions (adjustments, not edits)
- Admin-only adjustments
- Full transaction log with user and timestamp
- All inventory mutations produce an audit record (no silent changes)
- Supported transaction types: RECEIVE, ISSUE, MOVE, DISPOSE, RETURN, ADJUSTMENT
- `GET /api/inventory/transactions` supports filtering by part_id, location_id, and limit
- Results ordered by created_at DESC (newest first)
- No PUT or DELETE endpoints exist for transactions or FIFO layers (immutability enforced by design)

---

## Epic 7: Mobile Warehouse & Admin Reporting

### Story 7.1 - Mobile Barcode Interface
**Role:** Warehouse Staff
**Goal:** Use a mobile-friendly web app for scanning so warehouse operations are fast and accurate.

**Acceptance Criteria:**
- Camera-based barcode scanning
- Supported operations: Receiving, Transfers, Issues, Cycle Counts

---

### Story 7.2 - Admin Dashboard
**Role:** Leadership / Admin
**Goal:** View high-level inventory status so operational and financial oversight is simplified.

*Source enhancement: Seema Gupta — Inventory Management Proposal, Section 9 (Launch Success Metrics)*

**Implemented (current):**
- `GET /api/dashboard` returns three data sections:
- **Inventory by location type:** total quantity and total value grouped by location type (Warehouse, Regional Site, Contract Manufacturer) — aggregated from inventory and FIFO layers tables
- **Low-stock alerts:** parts with quantity_on_hand between 1 and 5, sorted by lowest quantity first — includes part_number, description, location_name, quantity_on_hand
- **Open PO summary:** all POs with status ≠ 'Closed', including supplier_name, expected_delivery_date, total_value, total_qty_ordered, total_qty_received

**Not yet implemented (future — from Seema's launch success criteria):**
- Same-day receipt rate (target: ≥ 90%)
- ISSUE flag backlog: count of open issues, count aged > 14 days
- Adjustment rate: adjust-in count trending month-over-month (target: downward)
- WIP inventory by project
- Cycle count accuracy for high-value parts (target: ≥ 98%)
- Assembly cost integrity: last audit pass/fail status

---

## Epic 8: Admin & Catalog Management

*Source: BarCloud Tutorial (Admin User)*

### Story 8.1 - Part Images
**Role:** Inventory Admin
**Goal:** Attach photos to parts so warehouse staff can visually identify items.

**Acceptance Criteria:**
- Upload one or more images per part
- Images visible in part detail and search results
- Supports common formats (JPEG, PNG)

---

### Story 8.2 - Barcode Label Printing
**Role:** Inventory Admin / Warehouse Staff
**Goal:** Print barcode labels for parts so physical inventory can be scanned efficiently.

**Acceptance Criteria:**
- Generate barcode from part number
- Print to label printer (e.g., Dymo)
- Batch printing for multiple parts

---

### Story 8.3 - User Management & Authentication
**Role:** Admin
**Goal:** Add, edit, and remove user accounts so access is controlled, and authenticate users via Google OAuth.

**Implemented (current):**

*Authentication:*
- Google OAuth 2.0 login (via Passport.js)
- Session-based auth with 7-day session expiry
- Email allowlist: only users pre-added to the users table can authenticate
- `GET /auth/me` returns current user (id, email, name, picture, role)
- `POST /auth/logout` destroys session and clears cookie
- Dev mode: auth bypassed when GOOGLE_CLIENT_ID is not configured
- Test mode: auth bypassed when NODE_ENV=test

*User CRUD (admin-only via requireAdmin middleware):*
- `GET /api/users` — list all users
- `POST /api/users` — add user to allowlist (email required, name optional, role defaults to "viewer")
- `PUT /api/users/:id` — update user name and/or role
- `DELETE /api/users/:id` — remove user from allowlist (cannot delete own account)
- Email is trimmed and lowercased on creation
- Valid roles: admin, warehouse, procurement, viewer
- Duplicate email detection (409)

*Middleware:*
- `requireAuth` — protects all `/api/*` routes; returns 401 if unauthenticated
- `requireAdmin` — protects user management routes; returns 403 if authenticated but non-admin

**Not yet implemented (deferred):**
- Role-based enforcement on non-admin API endpoints (all authenticated users can currently access all routes)
- User deactivation (admins delete users from allowlist instead of deactivating)

---

## Epic 9: Discrepancy Management (ISSUE Flag)

*Source: Seema Gupta — Inventory Management Proposal, Sections 4 and 5B*

### Story 9.1 - Flag and Track Discrepancies (ISSUE Overlay)
**Role:** System (automated) / Inventory Admin (manual)
**Goal:** Surface inventory records that need reconciliation without blocking operational availability, so discrepancies are visible and actionable.

**Acceptance Criteria:**
- ISSUE is a boolean flag on inventory records (not a physical state — it does not block AVAILABLE)
- ISSUE is set automatically when:
  - Receipt quantity ≠ PO line quantity
  - Receipt occurs without a matching PO ("PO missing")
  - Unit cost is provisional or unknown at receipt time
  - Wrong part received (part received ≠ part on PO line)
  - Part master record is incomplete (missing cost, manufacturer, or classification)
- ISSUE can also be set manually by Inventory Admin with a reason
- Each ISSUE record includes: reason code, date flagged, part, location, and optional notes
- ISSUE flag is visible on all inventory views (inventory list, part detail, valuation report)

---

### Story 9.2 - Resolve ISSUE Items (Weekly Cleanup Queue)
**Role:** Inventory Admin
**Goal:** Review and resolve flagged discrepancies on a regular cadence so the ISSUE backlog does not grow unchecked.

**Acceptance Criteria:**
- ISSUE queue view: list of all open ISSUE items, sortable by age and reason
- For each ISSUE item, admin can:
  - Resolve: correct the underlying data (e.g., link to PO, update cost, fix part number) and clear the flag
  - Accept variance: document the accepted discrepancy with a note and clear the flag
  - Escalate: add a note and keep the flag open for leadership review
- Resolution is logged in the audit trail (who, when, action taken)
- Aging rule: ISSUE items open > 14 days without documented rationale are highlighted as overdue
- Dashboard metric: total open ISSUEs, count aged > 14 days (see Story 7.2)

---

### Story 9.3 - Prevent ISSUE Backlog Growth
**Role:** System (automated)
**Goal:** Provide guardrails so the ISSUE queue does not become a dumping ground for unresolved problems.

**Acceptance Criteria:**
- Weekly summary notification: count of new ISSUEs, resolved ISSUEs, and aged ISSUEs
- If any ISSUE is > 30 days old without action, it appears as a critical alert on the dashboard
- Monthly report: ISSUE creation rate, resolution rate, average time-to-resolve
- Adjustment rate tracking: system tracks the ratio of adjustment transactions to total transactions, flagging upward trends (adjustment misuse risk per Seema's proposal)

---

## Summary: Roles

| Role | Key Responsibilities |
|---|---|
| **Inventory Admin** | Part catalog, variants, locations, assembly conversion, ISSUE resolution, adjustments |
| **Procurement User** | Purchase orders (PO creation in accounting system) |
| **Warehouse Staff / Ops** | Receiving, transfers, issues, project checkout, scanning |
| **Operations Admin** | BOMs |
| **Workshop Staff** | Finished goods assembly (physical build) |
| **Finance / Admin** | Valuation reports, audit trail, assembly cost audit |
| **Leadership / Admin** | Dashboard oversight, ISSUE escalation review |

### Key Personnel (from Seema's proposal)
- **Steven** — PO creation / upload
- **Tyler** — Receiving, system control for WIP moves, assembly conversion

## Summary: Epics at a Glance

| # | Epic | Stories | Priority Signals |
|---|---|---|---|
| 1 | Core Inventory & Part Master Data | 1.1, 1.2, 1.3 | Foundation — build first |
| 2 | Purchase Orders & Receiving | 2.1, 2.2 | Core workflow; includes discrepancy handling |
| 3 | Inventory Transfers | 3.1, 3.2, 3.3 | Core workflow (3.1 = general moves, 3.2-3.3 = CM shipments) |
| 4 | Light In-House Manufacturing | 4.1, 4.2 | Depends on Epic 1 (BOMs); assembly conversion centralized |
| 5 | Inventory Operations | 5.1–5.7 | Issue, dispose, reorder, returns, adjustments, **project checkout (NEW)**, WIP return (NEW) |
| 6 | FIFO Costing | F1, F2, F3, F4 | Cross-cutting — woven into Epics 2-5; WIP preserves layers, consumption depletes them |
| 7 | Mobile Warehouse & Admin Reporting | 7.1, 7.2 | UX layer; dashboard now includes operational health metrics |
| 8 | Admin & Catalog Management | 8.1, 8.2, 8.3 | Part images, barcode printing, user management |
| 9 | Discrepancy Management (ISSUE Flag) | 9.1, 9.2, 9.3 | **NEW epic** — surfacing and resolving exceptions without blocking operations |
