# Backbeat / Stash — Implementation Status
Last updated: 2026-02-22

## Implemented
- **1.1** Part Catalog — full CRUD, search/filter, all fields
- **1.3** Locations — CRUD with location types
- **2.1** Purchase Orders — create with line items, status flow
- **2.2** Receive PO Inventory — receipt creates FIFO layers
- **3.1** Move Inventory — between locations, FIFO layers transfer
- **5.1** Issue Parts — FIFO consumption with reason/target tracking
- **5.2** Dispose Inventory — FIFO consumption with reason
- **5.4** Return Parts — return to inventory with new FIFO layer, audit trail
- **5.5** Adjust Inventory — count-based adjustment with FIFO consumption/creation
- **F1** FIFO layers created on receipt
- **F2** FIFO consumption (oldest first, partial layers)
- **F3** Valuation Report with CSV export
- **F4** Audit trail for all transactions
- **7.2** Admin Dashboard — overview stats, inventory by location type, low-stock alerts (qty <= 5), open PO summary
- **8.3** User Management & Auth — Google OAuth login, session-based auth, email allowlist, admin UI for user CRUD, roles (admin/warehouse/procurement/viewer), requireAdmin middleware

## Not Yet Implemented (Deferred)
- **8.3 partial** — Role-based enforcement on non-admin endpoints (all authenticated users can access all API routes); user deactivation (admins remove users from allowlist instead)

## Not Implemented
- **1.2** Part Variants
- **3.2** Transfer Shipment to CM (packing list, status tracking)
- **3.3** Scan Outbound Transfer (mobile barcode)
- **4.1** Define BOMs
- **4.2** Build Finished Goods
- **5.3** Reorder Alerts (min/max levels)
- **7.1** Mobile Barcode Interface
- **8.1** Part Images
- **8.2** Barcode Label Printing
