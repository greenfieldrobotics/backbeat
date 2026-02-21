# Backbeat / Stash Module - MVP Proposal

> **Goal:** Deliver the smallest useful version of Stash that supports real inventory operations with accurate costing, then iterate.

---

## MVP Scope

### What's In

| Epic | Stories Included | Rationale |
|---|---|---|
| **1. Core Inventory** | 1.1 (Part Catalog), 1.3 (Locations) | Foundation — every other feature depends on parts and locations existing |
| **2. Purchase Orders & Receiving** | 2.1 (Create POs), 2.2 (Receive Inventory) | Primary way inventory enters the system |
| **5. Replacement Parts** | 5.1 (Issue Parts) | Primary way inventory leaves the system |
| **6. FIFO Costing** | F1 (Create Layers), F2 (Consume Layers), F3 (Valuation Report), F4 (Audit Trail) | FIFO must be baked in from day one — retrofitting it later is painful and error-prone. Valuation report needed to verify costing is correct. |
| **Infrastructure** | Auth (basic), Docker sandbox, CI/CD pipeline, test suite | Required for the system to be usable and safely modifiable |

### What's Deferred to Post-MVP

| Epic | Stories Deferred | Why |
|---|---|---|
| **1. Core Inventory** | 1.2 (Part Variants) | Variants add complexity; the 4 product configs can be managed as separate parts initially |
| **3. CM Transfers** | 3.1, 3.2 | Important but not needed for basic inventory tracking to start |
| **4. Workshop Manufacturing** | 4.1 (BOMs), 4.2 (Build Finished Goods) | Depends on variants; second phase |
| **5. Replacement Parts** | 5.2 (Reorder Alerts) | Nice-to-have; manual monitoring works initially |
| **7. Mobile & Reporting** | 7.1 (Barcode Scanning), 7.2 (Dashboard) | Desktop-first MVP; mobile and dashboard are UX polish |

---

## MVP User Workflows

### Workflow 1: Receive Inventory
```
Admin creates PO → Warehouse receives against PO → System creates FIFO cost layer → Inventory increases at location
```

### Workflow 2: Issue Parts for Service
```
Warehouse selects part → Enters quantity and reason → System consumes oldest FIFO layers → Inventory decreases at location
```

### Workflow 3: View Inventory
```
Admin views current stock by part and location → Sees quantity on hand and FIFO layer detail
```

### Workflow 4: Verify FIFO Costing
```
Admin runs valuation report → Sees inventory value by part, location, and FIFO layer → Exports to CSV for review
```

---

## MVP Technical Deliverables

### Database
- Parts table (part number, description, UOM, classification)
- Locations table
- Purchase Orders + PO Line Items tables
- Inventory table (part + location → quantity)
- FIFO Cost Layers table (part, location, receipt ref, original qty, remaining qty, unit cost, date)
- Inventory Transactions log (audit trail)

### API Endpoints
- CRUD: Parts, Locations
- PO lifecycle: Create, Update Status, Receive
- Inventory: Issue parts
- Query: Stock by part/location, FIFO layer detail
- Reports: FIFO valuation report with CSV export

### Frontend (Desktop-first)
- Part catalog management screen
- Location management screen
- PO creation and receiving screen
- Parts issue screen
- Inventory overview (stock levels by part and location)
- FIFO valuation report screen with CSV export

### Infrastructure
- Docker Compose local sandbox (app + DB + seed data)
- Basic authentication (approach TBD)
- GitHub Actions CI/CD pipeline
- Test suite: unit, integration, E2E

---

## MVP Success Criteria

1. A user can create a PO, receive inventory, and see stock levels update with correct FIFO cost layers
2. A user can issue parts and see FIFO consumption happen correctly (oldest first)
3. Every inventory transaction is logged with user, timestamp, and cost impact
4. The full test suite passes in CI before any merge to main
5. An admin can run the FIFO valuation report and export it to CSV to verify inventory value
6. A non-engineer can run the sandbox locally with `docker compose up`

---

## Suggested Build Order

| Phase | What | Depends On |
|---|---|---|
| **Phase 0** | Project scaffolding: Docker, DB, API skeleton, CI/CD, auth stub | Nothing |
| **Phase 1** | Parts + Locations (CRUD, UI, tests) | Phase 0 |
| **Phase 2** | POs + Receiving + FIFO layer creation | Phase 1 |
| **Phase 3** | Parts issuing + FIFO consumption + audit trail | Phase 2 |
| **Phase 4** | FIFO valuation report + CSV export | Phases 2-3 |
| **Phase 5** | Integration testing, seed data, polish | Phases 1-4 |

---

## Post-MVP Roadmap (Suggested Order)

1. **CM Transfers** (Epic 3) — track inventory leaving to the contract manufacturer
2. **Part Variants + BOMs + Workshop Builds** (Epics 1.2, 4) — support the 4 product configurations
3. **Reorder Alerts** (5.2) — min/max thresholds and low-stock warnings
5. **Mobile Barcode Scanning** (7.1) — camera-based scanning for warehouse staff
6. **Admin Dashboard** (7.2) — high-level operational overview
