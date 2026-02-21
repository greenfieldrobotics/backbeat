# Backbeat / Stash Module - User Stories

> **Backbeat** is the ERP system. **Stash** is the inventory management module.
>
> Sources:
> - Greenfield Robotics - Consolidated User Stories (Including FIFO Costing)
> - BarCloud Tutorial (Base User) - legacy system workflows
> - BarCloud Tutorial (Admin User) - legacy system admin workflows

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

**Acceptance Criteria:**
- Fields: Supplier, Expected Delivery Date, Line Items
- Status flow: Draft → Ordered → Partially Received → Closed

---

### Story 2.2 - Receive PO Inventory (Mobile)
**Role:** Warehouse Staff
**Goal:** Scan and receive inventory against a PO so incoming parts are logged quickly and accurately.

**Acceptance Criteria:**
- Barcode scan or search
- Enter quantity received
- Inventory increases at selected location
- Creates FIFO cost layer

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

### Story 4.1 - Define BOMs
**Role:** Operations Admin
**Goal:** Define BOMs for 4 product variants so workshop builds deduct correct components.

**Acceptance Criteria:**
- Supports ~40 components per BOM
- Simple version control (optional)

---

### Story 4.2 - Build Finished Goods
**Role:** Workshop Staff
**Goal:** Record assembly of finished units so inventory reflects component consumption and product creation.

**Acceptance Criteria:**
- Select variant and quantity
- Consume components via FIFO
- Create finished goods FIFO layer with total cost

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

## Epic 6: FIFO Costing (Core Financial Requirement)

### Story F1 - Create FIFO Cost Layers on Receipt
**Role:** System (automated)
**Goal:** Create a FIFO cost layer on every receipt so inventory value is tracked by receipt lot and unit cost.

**Acceptance Criteria:**
- Each receipt creates a distinct layer
- Tracks: original qty, remaining qty, unit cost, date
- Multiple receipts create multiple layers

---

### Story F2 - Consume Inventory Using FIFO
**Role:** System (automated)
**Goal:** Consume oldest cost layers first during issues or builds so COGS and valuation follow FIFO rules.

**Acceptance Criteria:**
- Oldest layer depleted first
- Partial layer consumption supported
- Layer consumption logged

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

**Acceptance Criteria:**
- Inventory value summary
- Inventory at CM vs warehouse
- Low-stock alerts
- Open PO summary

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

### Story 8.3 - User Management
**Role:** Admin
**Goal:** Add, edit, and deactivate user accounts so access is controlled.

**Acceptance Criteria:**
- Add new users with role assignment
- Edit user details and roles
- Deactivate (not delete) users
- Roles: Admin, Warehouse Staff, Procurement, Viewer

---

## Summary: Roles

| Role | Key Responsibilities |
|---|---|
| **Inventory Admin** | Part catalog, variants, locations |
| **Procurement User** | Purchase orders |
| **Warehouse Staff** | Receiving, transfers, issues, scanning |
| **Operations Admin** | BOMs |
| **Workshop Staff** | Finished goods assembly |
| **Finance / Admin** | Valuation reports, audit trail |
| **Leadership / Admin** | Dashboard oversight |

## Summary: Epics at a Glance

| # | Epic | Stories | Priority Signals |
|---|---|---|---|
| 1 | Core Inventory & Part Master Data | 1.1, 1.2, 1.3 | Foundation - build first |
| 2 | Purchase Orders & Receiving | 2.1, 2.2 | Core workflow |
| 3 | Inventory Transfers | 3.1, 3.2, 3.3 | Core workflow (3.1 = general moves, 3.2-3.3 = CM shipments) |
| 4 | Light In-House Manufacturing | 4.1, 4.2 | Depends on Epic 1 (BOMs) |
| 5 | Replacement Parts & Regional Stock | 5.1, 5.2, 5.3, 5.4, 5.5 | 5.1 = issue, 5.2 = dispose, 5.3 = reorder alerts, 5.4 = returns, 5.5 = adjustments |
| 6 | FIFO Costing | F1, F2, F3, F4 | Cross-cutting - woven into Epics 2-5 |
| 7 | Mobile Warehouse & Admin Reporting | 7.1, 7.2 | UX layer on top of all workflows |
| 8 | Admin & Catalog Management | 8.1, 8.2, 8.3 | Part images, barcode printing, user management |
