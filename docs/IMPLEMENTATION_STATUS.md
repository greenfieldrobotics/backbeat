# Backbeat / Stash — Implementation Status
Last updated: 2026-02-21

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

## Partially Implemented
- **7.2** Admin Dashboard — basic stats only; missing CM vs warehouse, low-stock alerts, open PO summary

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
- **8.3** User Management & Auth
