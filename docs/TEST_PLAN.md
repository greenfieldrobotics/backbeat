# Backbeat / Stash Module — Test Plan

> **Purpose:** Provide Claude Code with the edge cases, numeric scenarios, and cross-feature
> workflows that are NOT obvious from the User Stories alone. Claude Code should use this
> document alongside `USER_STORIES.md` and `IMPLEMENTATION_STATUS.md` when generating
> automated tests.
>
> **Scope:** API integration tests against a real PostgreSQL database. Each test suite should
> set up its own data (no dependency on seed data) and clean up afterward.

---

## Test Infrastructure Notes

- **Database:** Tests run against a real PostgreSQL instance (Docker). Each test file should
  use transactions or truncation to isolate test data.
- **Server:** The Express app (`server/src/index.js`) exports `app` — tests should use
  `supertest` (or similar) against the app directly, not a running server.
- **Numeric precision:** All cost values are `NUMERIC(12,4)` in Postgres. Tests should
  compare costs to 4 decimal places.
- **FIFO layer ordering:** Layers are consumed `ORDER BY created_at ASC, id ASC`. Tests
  that create multiple layers must control timestamps or insertion order.

---

## 1. Parts Catalog (Story 1.1)

### Happy Path
- Create a part with all fields populated; verify all fields returned correctly
- List parts; verify sort order is by `part_number`
- Update a part's description and classification; verify `updated_at` changes
- Delete a part with no inventory; verify 204 response

### Validation & Edge Cases
- **Missing part_number:** POST with no `part_number` → 400
- **Duplicate part_number:** Create two parts with the same part_number → 409 on second
- **Update to duplicate part_number:** Update part A's part_number to match part B → 409
- **Delete part with inventory:** Create part, receive inventory, attempt delete → 409
  with message about existing inventory
- **Get non-existent part:** GET `/api/parts/99999` → 404
- **Update non-existent part:** PUT `/api/parts/99999` → 404
- **Update with no fields:** PUT with empty body → 400
- **Default values:** Create part with only `part_number` → verify `unit_of_measure` = "EA",
  `classification` = "General", `description` = ""

### Search & Filter
- **Search by part_number:** Create 3 parts, search with partial part_number → only matching parts returned
- **Search by description:** Search matches description substring (case-insensitive via ILIKE)
- **Search by manufacturer:** Search matches manufacturer substring
- **Filter by classification:** Create parts with different classifications, filter → only matching classification returned
- **Combined search + classification filter:** Both conditions applied simultaneously

---

## 2. Locations (Story 1.3)

### Happy Path
- Create locations of each type: Warehouse, Regional Site, Contract Manufacturer
- List locations; verify sorted by name
- Update location name and type
- Delete location with no inventory

### Validation & Edge Cases
- **Missing name or type:** POST with missing fields → 400
- **Invalid type:** POST with `type: "Office"` → 400 (CHECK constraint)
- **Duplicate name:** Create two locations with same name → 409
- **Delete location with inventory:** → 409
- **Update to duplicate name:** → 409
- **Update with invalid type:** → 400

---

## 3. Suppliers

### Happy Path
- Create a supplier; verify 201 and returned fields
- List suppliers; verify sorted by name

### Validation & Edge Cases
- **Missing name:** POST with no name → 400
- **Duplicate name:** → 409

---

## 4. Purchase Orders (Stories 2.1, 2.2)

### PO Creation (Story 2.1)
- Create PO with one line item → verify PO number format `PO-YYYY-NNN`, status = "Draft"
- Create PO with multiple line items → all line items returned with correct part info
- **PO number auto-increment:** Create two POs → second PO number increments
- **Missing supplier_id:** → 400
- **Non-existent supplier:** → 400
- **Empty line_items array:** → 400
- **Missing line_items:** → 400
- **Line item missing part_id:** → 400
- **Line item with non-existent part_id:** → 400
- **Line item missing quantity_ordered:** → 400
- **Line item missing unit_cost:** → 400

### PO Status Updates
- Update status Draft → Ordered → verify status changes
- **Invalid status value:** → 400
- **Non-existent PO:** → 404

### PO Receiving (Story 2.2)

#### Happy Path
- Receive full quantity against an Ordered PO → status becomes "Closed"
- Receive partial quantity → status becomes "Partially Received"
- Receive remainder after partial → status becomes "Closed"
- Verify FIFO layer created with correct: part_id, location_id, source_type = "PO_RECEIPT",
  source_ref = PO number, original_qty, remaining_qty, unit_cost
- Verify inventory record created/updated at receiving location
- Verify audit trail transaction logged with type = "RECEIVE"

#### Validation & Edge Cases
- **Receive against Draft PO:** → 400 ("PO must be in Ordered status")
- **Receive against Closed PO:** → 400 ("Cannot receive against a closed PO")
- **Receive more than remaining:** Order 10, receive 10, try to receive 1 more → 400
- **Non-existent location:** → 400
- **Non-existent line_item_id:** → 400
- **line_item_id from different PO:** → 400
- **Quantity zero or negative:** → 400
- **Missing location_id:** → 400
- **Empty items array:** → 400

#### Multi-Line Receiving
- PO with 3 line items: receive all of line 1 and part of line 2 → status = "Partially Received"
- Then receive rest of line 2 and all of line 3 → status = "Closed"
- Each receipt creates a separate FIFO layer

---

## 5. FIFO Costing — Numeric Scenarios (Stories F1–F4)

> **These are the most critical tests in the system.** Each scenario includes exact numbers
> that Claude Code should use as assertions.

### Scenario 5A: Basic FIFO Consumption
```
Setup:
  Receive 10 units @ $5.00  → Layer A (remaining: 10, cost: $5.00)
  Receive 10 units @ $7.00  → Layer B (remaining: 10, cost: $7.00)

Action: Issue 15 units

Expected:
  Layer A remaining: 0  (consumed 10)
  Layer B remaining: 5  (consumed 5)
  Total cost of issue: (10 × $5.00) + (5 × $7.00) = $85.00
  Remaining inventory value: 5 × $7.00 = $35.00
```

### Scenario 5B: Exact Layer Depletion
```
Setup:
  Receive 10 units @ $5.00  → Layer A

Action: Issue exactly 10 units

Expected:
  Layer A remaining: 0
  Total cost of issue: $50.00
  Inventory quantity on hand: 0
  No FIFO layers with remaining_qty > 0 for this part/location
```

### Scenario 5C: Single Unit from Multiple Layers
```
Setup:
  Receive 1 unit @ $10.00  → Layer A
  Receive 1 unit @ $20.00  → Layer B
  Receive 1 unit @ $30.00  → Layer C

Action: Issue 2 units

Expected:
  Layer A remaining: 0
  Layer B remaining: 0
  Layer C remaining: 1
  Total cost of issue: $10.00 + $20.00 = $30.00
  Remaining inventory value: $30.00
```

### Scenario 5D: High-Precision Cost Values
```
Setup:
  Receive 100 units @ $3.7525  → Layer A

Action: Issue 37 units

Expected:
  Layer A remaining: 63
  Total cost of issue: 37 × $3.7525 = $138.8425
  Remaining value: 63 × $3.7525 = $236.4075
```

### Scenario 5E: Multiple Receipts, Same Part, Same Cost
```
Setup:
  Receive 5 units @ $10.00   → Layer A
  Receive 5 units @ $10.00   → Layer B (separate layer, even though same cost)

Action: Issue 7 units

Expected:
  Layer A remaining: 0 (consumed 5)
  Layer B remaining: 3 (consumed 2)
  Two distinct layers should exist (not merged), even at the same unit cost
  Total cost of issue: $70.00
```

---

## 6. Issue Parts (Story 5.1)

### Happy Path
- Issue parts with reason and target_ref → verify response includes cost breakdown
- Verify inventory quantity decreases
- Verify audit trail transaction with type = "ISSUE", negative quantity, reason, target_ref
- Verify fifo_layers_consumed JSON in audit trail contains layer details

### Validation & Edge Cases
- **Insufficient inventory:** Try to issue 100 when only 5 on hand → 400 with available/requested quantities
- **Zero inventory:** Issue from part/location with no inventory record → 400
- **Non-existent part:** → 404
- **Non-existent location:** → 404
- **Quantity zero:** → 400
- **Negative quantity:** → 400
- **Missing part_id:** → 400
- **Optional fields:** Issue without reason or target_ref → succeeds (both are optional)

---

## 7. Move Inventory (Story 3.1)

### Happy Path
- Move inventory between two locations → source decreases, destination increases
- Verify FIFO layers: source layer reduced, new layer created at destination with same
  unit_cost and source_type
- Verify audit trail transaction with type = "MOVE", to_location_id populated

### FIFO Layer Transfer Scenarios

#### Scenario 7A: Move Splits a FIFO Layer
```
Setup:
  Location A has 10 units in one layer @ $5.00

Action: Move 3 units from A to B

Expected at Location A:
  Layer remaining: 7, unit_cost: $5.00

Expected at Location B:
  New layer: original_qty = 3, remaining_qty = 3, unit_cost = $5.00
  source_type preserved from original layer
```

#### Scenario 7B: Move Spans Multiple Layers
```
Setup:
  Location A:
    Layer 1: 5 units @ $10.00
    Layer 2: 5 units @ $20.00

Action: Move 7 units from A to B

Expected at Location A:
  Layer 1 remaining: 0
  Layer 2 remaining: 3

Expected at Location B:
  New layer from Layer 1: 5 units @ $10.00
  New layer from Layer 2: 2 units @ $20.00
  Total value moved: (5 × $10) + (2 × $20) = $90.00
```

#### Scenario 7C: Move to Location with Existing Inventory
```
Setup:
  Location A: 10 units @ $5.00
  Location B: 5 units @ $8.00 (already has inventory of same part)

Action: Move 3 units from A to B

Expected:
  Location B inventory quantity: 8 (5 + 3)
  Location B has two layers: the original 5 @ $8.00 AND the new 3 @ $5.00
  Layers are NOT merged — separate layers maintained
```

### Validation & Edge Cases
- **Same source and destination:** → 400
- **Insufficient inventory:** → 400 with available/requested
- **Non-existent part:** → 404
- **Non-existent source location:** → 404
- **Non-existent destination location:** → 404
- **Zero quantity:** → 400
- **Negative quantity:** → 400

---

## 8. Dispose Inventory (Story 5.2)

### Happy Path
- Dispose inventory with reason → verify FIFO consumption, inventory decrease
- Verify audit trail transaction with type = "DISPOSE", negative quantity, reason logged

### Validation & Edge Cases
- **Missing reason:** → 400 (reason is required for disposal)
- **Insufficient inventory:** → 400
- **Non-existent part:** → 404
- **Non-existent location:** → 404
- **Zero/negative quantity:** → 400

### FIFO Consumption
- Disposal consumes layers oldest-first, same as Issue (apply Scenario 5A–5E logic)

---

## 8a. Return Parts to Inventory (Story 5.4)

> Schema already supports `source_type: 'RETURN'`. These tests cover the API endpoint
> and UI workflow once built.

### Happy Path
- Return 5 units of a part to a location at $10.00/unit → verify:
  - New FIFO layer created with source_type = "RETURN", original_qty = 5, remaining_qty = 5, unit_cost = $10.00
  - Inventory quantity_on_hand increases by 5
  - Audit trail transaction logged with type = "RETURN", positive quantity, unit_cost, total_cost
- Return with reason and original issue reference (e.g., reason: "unused", reference: "repair")
  → verify reason and reference stored in audit trail

### Validation & Edge Cases
- **Missing part_id:** → 400
- **Missing location_id:** → 400
- **Missing quantity:** → 400
- **Zero or negative quantity:** → 400
- **Missing unit_cost:** → 400 (cost is required for returns — it creates a new layer)
- **Negative unit_cost:** → 400
- **Non-existent part:** → 404
- **Non-existent location:** → 404
- **Optional fields:** Return without reason or original reference → succeeds (both optional
  but recommended for traceability)

### FIFO Layer Creation
- Return creates a NEW layer — it never modifies existing layers
- Returned units are available for future FIFO consumption in the correct chronological position
  (i.e., the return layer's created_at timestamp places it after all prior layers)

### Scenario 8a-A: Return After Full Issue
```
Setup:
  Receive 10 units @ $5.00  → Layer A
  Issue all 10 units (Layer A depleted)

Action: Return 3 units @ $5.00

Expected:
  Layer A: remaining = 0 (unchanged — never modified)
  New Layer B: source_type = RETURN, original_qty = 3, remaining_qty = 3, unit_cost = $5.00
  Inventory quantity_on_hand: 3
  Valuation: 3 × $5.00 = $15.00
```

### Scenario 8a-B: Return at Different Cost Than Original Issue
```
Setup:
  Receive 10 units @ $5.00, issue 5

Action: Return 2 units @ $3.00 (e.g., depreciated value)

Expected:
  New RETURN layer: 2 units @ $3.00
  Inventory: 5 (remaining from original) + 2 (returned) = 7
  Valuation: (5 × $5.00) + (2 × $3.00) = $31.00
```

---

## 8b. Adjust Inventory (Story 5.5)

> Schema already supports `source_type: 'ADJUSTMENT'`. These tests cover the API endpoint
> once built. This is the highest-volume correction mechanism (12% of historical transactions).

### Negative Adjustment (Shortage — Physical Count < System)

#### Happy Path
- System has 10 units, physical count is 7 → adjust to 7
  - Verify delta calculated: -3
  - FIFO layers consumed oldest-first (same logic as Issue/Dispose)
  - Inventory quantity_on_hand decremented by 3
  - Audit trail: type = "ADJUSTMENT", quantity = -3, before_qty = 10, after_qty = 7, reason logged

#### Scenario 8b-A: Negative Adjustment Spanning Multiple Layers
```
Setup:
  Receive 5 units @ $10.00  → Layer A
  Receive 5 units @ $20.00  → Layer B
  System shows 10 units on hand

Action: Adjust to 3 (physical count = 3, delta = -7)

Expected:
  Layer A remaining: 0 (consumed 5)
  Layer B remaining: 3 (consumed 2)
  Total cost of adjustment: (5 × $10) + (2 × $20) = $90.00
  Inventory quantity_on_hand: 3
  Valuation: 3 × $20 = $60.00
```

#### Scenario 8b-B: Negative Adjustment to Zero
```
Setup:
  Receive 5 units @ $8.00  → Layer A

Action: Adjust to 0 (physical count = 0)

Expected:
  Layer A remaining: 0
  Total cost of adjustment: 5 × $8.00 = $40.00
  Inventory quantity_on_hand: 0
  No active FIFO layers for this part/location
```

### Positive Adjustment (Overage — Physical Count > System)

#### Happy Path
- System has 5 units, physical count is 8 → adjust to 8
  - Verify delta calculated: +3
  - New FIFO layer created: source_type = "ADJUSTMENT", original_qty = 3, remaining_qty = 3
  - Inventory quantity_on_hand incremented by 3
  - Audit trail: type = "ADJUSTMENT", quantity = +3, before_qty = 5, after_qty = 8, reason logged

#### Scenario 8b-C: Positive Adjustment With Specified Cost
```
Setup:
  Receive 5 units @ $10.00  → Layer A
  System shows 5 on hand

Action: Adjust to 8, unit_cost = $12.00 (e.g., found documentation of missed receipt)

Expected:
  Layer A: unchanged (5 remaining @ $10.00)
  New Layer B: source_type = ADJUSTMENT, original_qty = 3, remaining_qty = 3, unit_cost = $12.00
  Inventory quantity_on_hand: 8
  Valuation: (5 × $10) + (3 × $12) = $86.00
```

#### Scenario 8b-D: Positive Adjustment With No Cost Specified (Use Most Recent Layer)
```
Setup:
  Receive 5 units @ $10.00  → Layer A
  Receive 3 units @ $15.00  → Layer B

Action: Adjust to 10 (delta = +2), no unit_cost provided

Expected:
  New ADJUSTMENT layer: 2 units @ $15.00 (most recent layer cost used as fallback)
  Inventory quantity_on_hand: 10
  Valuation: (5 × $10) + (3 × $15) + (2 × $15) = $125.00
```

#### Scenario 8b-E: Positive Adjustment From Zero Inventory
```
Setup:
  No inventory exists for this part/location (no layers, no inventory record)

Action: Adjust to 5, unit_cost = $7.50

Expected:
  New ADJUSTMENT layer: 5 units @ $7.50
  Inventory record created: quantity_on_hand = 5
  Valuation: 5 × $7.50 = $37.50
```

### Adjustment Where Count Equals System (No-Op)
- System has 10, physical count is 10 → delta = 0
- No FIFO layers created or consumed
- No audit trail record (or an informational record with delta = 0 — design decision)
- Inventory unchanged

### Validation & Edge Cases
- **Missing part_id:** → 400
- **Missing location_id:** → 400
- **Missing new_quantity (physical count):** → 400
- **Negative new_quantity:** → 400 (physical count can't be negative)
- **Non-existent part:** → 404
- **Non-existent location:** → 404
- **Missing reason:** → 400 (reason is required per Story 5.5 controls)
- **Positive adjustment without unit_cost and no existing layers:** → 400 (no cost fallback available)

### Controls
- Adjustment is admin-only (once auth is implemented, verify non-admin users receive 403)
- Reason code is required on every adjustment
- Audit trail includes before_qty, after_qty, delta, cost impact, and reason

### FIFO Immutability
- Negative adjustments consume layers — they never modify existing layer quantities directly
- Positive adjustments create new layers — they never increase remaining_qty on existing layers
- Historical layers are never edited, only new transactions are created

---

## 9. Valuation Report (Story F3)

### Happy Path
- Create inventory across multiple parts and locations via PO receipts
- GET `/api/inventory/valuation` → verify:
  - `layers` array contains all active FIFO layers (remaining_qty > 0)
  - `summary` array groups by part + location with correct totals
  - `grand_total` equals sum of all (remaining_qty × unit_cost)
- Depleted layers (remaining_qty = 0) are NOT included

### CSV Export
- GET `/api/inventory/valuation?format=csv` → verify:
  - Content-Type is `text/csv`
  - Content-Disposition header contains filename
  - CSV has correct header row
  - Grand total row at bottom
  - Values match JSON response

### Valuation Math
```
Setup:
  Part X at Location 1:
    Layer A: 10 remaining @ $5.00 = $50.00
    Layer B: 5 remaining @ $7.50 = $37.50
  Part X at Location 2:
    Layer C: 3 remaining @ $6.00 = $18.00
  Part Y at Location 1:
    Layer D: 20 remaining @ $2.25 = $45.00

Expected:
  Summary for Part X / Location 1: qty=15, value=$87.50
  Summary for Part X / Location 2: qty=3, value=$18.00
  Summary for Part Y / Location 1: qty=20, value=$45.00
  Grand total: $150.50
```

---

## 10. FIFO Layer Query Endpoint

- **Default (no params):** Returns only layers with remaining_qty > 0
- **include_depleted=true:** Returns all layers including depleted ones
- **Filter by part_id:** Only layers for that part
- **Filter by location_id:** Only layers at that location
- **Combined filters:** part_id + location_id
- **Sort order:** Ordered by part_id, location_id, created_at ASC

---

## 11. Audit Trail / Transactions (Story F4)

### Coverage
- Every transaction type produces an audit record: RECEIVE, ISSUE, MOVE, DISPOSE, RETURN, ADJUSTMENT
- Each record includes: transaction_type, part_id, location_id, quantity, unit_cost,
  total_cost, created_at (auto-timestamped)
- MOVE transactions include to_location_id
- ISSUE transactions include target_ref and reason
- DISPOSE transactions include reason
- RECEIVE transactions include reference_id (PO id) and reason
- RETURN transactions include reason and optional original issue reference
- ADJUSTMENT transactions include before_qty, after_qty (or delta), reason, and cost impact

### Query Filtering
- Filter by part_id → only transactions for that part
- Filter by location_id → only transactions for that location
- Default limit = 100
- Custom limit parameter respected
- Results ordered by created_at DESC (newest first)

### Immutability (Story F4)
- There is no PUT or DELETE endpoint for transactions — verify the router has no such routes
- There is no PUT or DELETE endpoint for FIFO layers — verify no direct mutation routes exist
- Corrections happen through new transactions only

---

## 12. Cross-Feature Workflow Tests

> These tests verify that multiple features work correctly in sequence, which is where
> most real-world bugs occur.

### Workflow 12A: Full PO Lifecycle → Issue → Valuation
```
1. Create supplier
2. Create 2 parts
3. Create location (Warehouse)
4. Create PO with 2 line items (Part A: 10 @ $5, Part B: 5 @ $12)
5. Update PO status to Ordered
6. Receive all items at Warehouse
7. Verify PO status = Closed
8. Verify inventory: Part A = 10, Part B = 5
9. Verify 2 FIFO layers created
10. Issue 3 of Part A (reason: "repair", target: "Bot-42")
11. Verify Part A inventory = 7
12. Verify Part A FIFO layer remaining = 7
13. Run valuation report
14. Verify Part A value = 7 × $5 = $35
15. Verify Part B value = 5 × $12 = $60
16. Verify grand total = $95
17. Verify audit trail has 3 transactions (2 RECEIVE + 1 ISSUE)
```

### Workflow 12B: Receive → Move → Issue at New Location
```
1. Create Part, Location A, Location B, Supplier
2. Create + Order PO: 20 units @ $8.00
3. Receive at Location A
4. Move 12 units from A to B
5. Verify Location A: 8 units, Location B: 12 units
6. Verify FIFO layers: A has 8 remaining, B has new layer of 12 @ $8.00
7. Issue 5 units from Location B
8. Verify Location B: 7 units
9. Verify Location B FIFO layer: 7 remaining
10. Run valuation: A = 8 × $8 = $64, B = 7 × $8 = $56, total = $120
```

### Workflow 12C: Multiple Receipts → Move → Issue (FIFO Ordering Across Moves)
```
1. Receive 5 units @ $10 at Location A  → Layer 1
2. Receive 5 units @ $20 at Location A  → Layer 2
3. Move 7 units from A to B (should take 5 from Layer 1 + 2 from Layer 2)
4. Verify Location B has 2 layers: 5 @ $10 and 2 @ $20
5. Issue 6 units from Location B
6. Verify consumed: 5 @ $10 + 1 @ $20 = $70
7. Location B remaining: 1 unit @ $20 = $20
8. Location A remaining: 3 units @ $20 = $60
```

### Workflow 12D: Dispose After Partial Issue
```
1. Receive 10 units @ $15 at Warehouse
2. Issue 3 (cost = $45)
3. Dispose 2 (reason: "damaged", cost = $30)
4. Verify remaining: 5 units, one layer with remaining_qty = 5
5. Valuation = 5 × $15 = $75
6. Audit trail: 3 transactions (RECEIVE, ISSUE, DISPOSE) in correct chronological order
```

### Workflow 12E: Issue → Return → Re-Issue (FIFO Ordering of Return Layer)
```
1. Receive 10 units @ $5.00 at Warehouse → Layer A
2. Issue 10 units (Layer A depleted, cost = $50)
3. Return 4 units @ $5.00 (reason: "unused from repair") → Layer B (source_type: RETURN)
4. Receive 6 units @ $8.00 via new PO → Layer C (source_type: PO_RECEIPT)
5. Verify inventory: 10 units (4 returned + 6 new receipt)
6. Verify 2 active layers: Layer B (4 @ $5.00), Layer C (6 @ $8.00)
7. Issue 5 units
8. Verify FIFO order: Layer B consumed first (4 @ $5.00), then 1 from Layer C (1 @ $8.00)
9. Total cost of second issue: (4 × $5) + (1 × $8) = $28.00
10. Remaining: 5 units in Layer C @ $8.00 = $40.00
11. Audit trail: 4 transactions (RECEIVE, ISSUE, RETURN, RECEIVE, ISSUE) in chronological order
```

### Workflow 12F: Receive → Partial Issue → Negative Adjustment → Valuation
```
1. Receive 10 units @ $5.00 → Layer A
2. Receive 10 units @ $8.00 → Layer B
3. Issue 3 units (consumes 3 from Layer A, cost = $15)
4. Verify Layer A: 7 remaining, Layer B: 10 remaining
5. Physical count finds 14 units (system shows 17) → Adjust to 14 (delta = -3)
6. Verify adjustment consumes FIFO oldest-first: Layer A 7→4 (consumed 3)
7. Adjustment cost: 3 × $5.00 = $15.00
8. Final state: Layer A = 4 @ $5.00, Layer B = 10 @ $8.00
9. Valuation: (4 × $5) + (10 × $8) = $100.00
10. Inventory quantity_on_hand: 14
11. Audit trail: 4 transactions (2 RECEIVE, 1 ISSUE, 1 ADJUSTMENT)
```

### Workflow 12G: Positive Adjustment → Move → Issue (Adjustment Layer Participates in FIFO)
```
1. Receive 5 units @ $10.00 at Location A → Layer A
2. Adjust inventory at Location A to 8 (delta = +3, unit_cost = $12.00) → Layer B (ADJUSTMENT)
3. Verify inventory: 8 units, 2 layers (5 @ $10, 3 @ $12)
4. Move 6 units from Location A to Location B
5. Verify move consumes FIFO: 5 from Layer A + 1 from Layer B
6. Location A: 2 units (Layer B remainder: 2 @ $12.00)
7. Location B: 6 units (new layer 5 @ $10, new layer 1 @ $12)
8. Issue 4 units from Location B
9. Verify FIFO at Location B: consume 4 from the 5-unit layer @ $10 → cost = $40
10. Location B remaining: 1 @ $10 + 1 @ $12 = $22.00
11. Grand total valuation: Location A ($24) + Location B ($22) = $46.00
```

---

## 13. Inventory Summary Consistency

> The `inventory` table is denormalized. These tests verify it stays in sync with FIFO layers.

- After any receive, issue, move, dispose, return, or adjustment: `inventory.quantity_on_hand`
  must equal `SUM(fifo_layers.remaining_qty)` for the same part/location
- Test this invariant after each operation in the cross-feature workflows above
- **Specific test:** After Workflow 12C, for every part/location combination, query both
  the inventory table and sum the FIFO layers — they must match exactly
- **Specific test:** After Workflow 12F (which combines receive, issue, and negative adjustment),
  verify the invariant holds
- **Specific test:** After Workflow 12G (which combines receive, positive adjustment, move,
  and issue), verify the invariant holds at both locations

---

## 14. Transaction Atomicity

> All multi-step operations use database transactions. If any step fails, everything
> should roll back cleanly.

### Rollback Scenarios to Test
- **Receive with invalid line_item_id in the middle of a batch:** First item succeeds in
  the transaction, second item has a bad line_item_id → entire receive rolls back,
  no FIFO layers created, no inventory changes, no audit records
- **Issue that would create negative inventory:** Attempt should fail atomically — no
  partial FIFO consumption
- **Move with insufficient inventory:** Should fail atomically — source inventory unchanged,
  no layers created at destination
- **Negative adjustment larger than total inventory:** Adjust to -5 when system has 3 →
  should fail atomically, no layers consumed, inventory unchanged
- **Positive adjustment with invalid cost data:** If cost fallback logic fails (no cost
  provided, no existing layers), the entire adjustment should roll back cleanly

---

## 15. Health Check

- GET `/api/health` → 200 with `{ status: "ok", module: "Stash", version: "0.1.0" }`
- (If database is unreachable, returns 503 — this is difficult to test but worth noting)

---

## 16. Admin Dashboard (Story 7.2)

> The dashboard endpoint aggregates data from inventory, FIFO layers, locations, and POs.
> The $40M bug in production was a dashboard query issue — these tests prevent regression.

### Endpoint: GET /api/dashboard

#### Response Structure
- Verify response contains three top-level keys: `inventory_by_type`, `low_stock_alerts`, `open_purchase_orders`

#### Inventory by Location Type
```
Setup:
  Create Location A (type: Warehouse)
  Create Location B (type: Regional Site)
  Create Location C (type: Contract Manufacturer)
  Receive 10 units of Part X @ $5.00 at Location A (Warehouse)
  Receive 5 units of Part X @ $5.00 at Location B (Regional Site)
  Receive 3 units of Part Y @ $20.00 at Location A (Warehouse)

Expected inventory_by_type:
  Warehouse: total_qty = 13, total_value = (10 × $5) + (3 × $20) = $110.00
  Regional Site: total_qty = 5, total_value = 5 × $5 = $25.00
  Contract Manufacturer: total_qty = 0, total_value = $0.00 (or omitted)
```

#### Critical: No Double-Counting
- The sum of `total_qty` across all location types must equal the sum of all
  `inventory.quantity_on_hand` records
- The sum of `total_value` across all location types must equal the `grand_total`
  from the valuation report (`GET /api/inventory/valuation`)
- **Specific test:** After receiving, moving, issuing, and disposing inventory across
  multiple locations, verify dashboard totals still match valuation report totals exactly

#### Low Stock Alerts
- Parts with `quantity_on_hand` between 1 and 5 appear in `low_stock_alerts`
- Parts with `quantity_on_hand` = 0 do NOT appear (nothing to alert on)
- Parts with `quantity_on_hand` > 5 do NOT appear
- Each alert includes: part_number, description, location_name, quantity_on_hand
- Results sorted by lowest quantity first

#### Low Stock Threshold Scenarios
```
Setup:
  Part A at Location 1: qty = 3  → appears in alerts
  Part B at Location 1: qty = 5  → appears in alerts
  Part C at Location 1: qty = 6  → does NOT appear
  Part D at Location 1: qty = 0  → does NOT appear
  Part E at Location 1: qty = 1  → appears in alerts

Expected: 3 alerts, ordered: Part E (1), Part A (3), Part B (5)
```

#### Open Purchase Orders
- Only POs with status ≠ 'Closed' appear
- Each open PO includes: id, po_number, status, supplier_name, expected_delivery_date,
  total_value, total_qty_ordered, total_qty_received
- **Aggregation test:** Create PO with 3 line items (10 @ $5, 20 @ $8, 5 @ $15) →
  total_value = $335, total_qty_ordered = 35, total_qty_received = 0
- **Partial receipt:** Receive some items → total_qty_received updates correctly
- **Closed POs excluded:** Close a PO → it no longer appears in open_purchase_orders

#### Dashboard After Transactions
- After issue: inventory_by_type totals decrease, low_stock_alerts may gain entries
- After move: location-type totals shift (e.g., Warehouse decreases, Regional Site increases)
  but grand total stays the same
- After dispose: totals decrease
- After return: totals increase
- After adjustment: totals change by the adjustment delta

#### Empty State
- No inventory, no POs → dashboard returns empty arrays and zero totals without errors

---

## 17. Authentication & User Management (Story 8.3)

> Auth middleware bypasses in test mode (`NODE_ENV=test`), so these tests verify
> the middleware logic and user CRUD separately.

### Auth Middleware: requireAuth

> Note: `requireAuth` is bypassed when `NODE_ENV === 'test'` or when `GOOGLE_CLIENT_ID`
> is not configured. These tests verify the middleware's LOGIC, not the OAuth flow.

- **Unauthenticated request to protected endpoint:** → 401 `{ error: "Authentication required" }`
- **Authenticated request:** → passes through to handler
- **Dev mode (no GOOGLE_CLIENT_ID):** → bypasses auth (convenience for local development)

### Auth Middleware: requireAdmin

- **Unauthenticated request:** → 401 `{ error: "Authentication required" }`
- **Authenticated non-admin (role: warehouse):** → 403 `{ error: "Admin access required" }`
- **Authenticated non-admin (role: viewer):** → 403 `{ error: "Admin access required" }`
- **Authenticated admin:** → passes through to handler

### Auth Endpoint: GET /auth/me

- **Authenticated user:** → 200 with `{ id, email, name, picture, role }`
- **Unauthenticated (OAuth configured):** → 401 `{ error: "Not authenticated" }`
- **Dev mode (OAuth not configured):** → 200 with dev user `{ id: 0, email: "dev@localhost", name: "Dev User", role: "admin" }`

### Auth Endpoint: POST /auth/logout

- **Authenticated user:** → 200 `{ ok: true }`, session destroyed, cookie cleared

### User CRUD (Admin Only)

#### GET /api/users — List Users
- Returns array of all users sorted by name/email
- Each user includes: id, email, name, role, picture, created_at, last_login_at
- **Non-admin access:** → 403

#### POST /api/users — Create User (Add to Allowlist)

**Happy Path:**
- Create user with email, name, role → 201, user returned with all fields
- Create user with only email → 201, name defaults to "", role defaults to "viewer"
- Email is trimmed and lowercased: `" SEEMA@GreenField.com "` → stored as `"seema@greenfield.com"`

**Validation & Edge Cases:**
- **Missing email:** → 400 `{ error: "Email is required" }`
- **Duplicate email:** → 409 `{ error: "A user with this email already exists" }`
- **Invalid role:** `role: "superadmin"` → 400 `{ error: "Invalid role. Must be one of: admin, warehouse, procurement, viewer" }`
- **Valid roles:** admin, warehouse, procurement, viewer
- **Non-admin access:** → 403

#### PUT /api/users/:id — Update User

**Happy Path:**
- Update name → 200, name changed
- Update role → 200, role changed
- Update both → 200, both changed

**Validation & Edge Cases:**
- **Non-existent user:** → 404 `{ error: "User not found" }`
- **Invalid role:** → 400
- **No fields provided:** → 400 `{ error: "No fields to update" }`
- **Non-admin access:** → 403

#### DELETE /api/users/:id — Remove User

**Happy Path:**
- Delete existing user → 204
- Deleted user can no longer log in (removed from allowlist)

**Validation & Edge Cases:**
- **Non-existent user:** → 404 `{ error: "User not found" }`
- **Self-deletion:** Admin tries to delete their own account → 400 `{ error: "Cannot delete your own account" }`
- **Non-admin access:** → 403

### Allowlist Behavior (Integration)
- User NOT in users table cannot authenticate via Google OAuth → redirected to `/login?error=not-allowed`
- User IN users table authenticates successfully → session created, `/auth/me` returns their info
- Admin creates user → that email can now authenticate
- Admin deletes user → that email can no longer authenticate
