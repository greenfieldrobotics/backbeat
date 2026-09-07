import { Router } from 'express';
import pool, { withTransaction } from '../../../db/connection.js';
import {
  listInventory,
  listFifoLayers,
  moveInventory,
  disposeInventory,
  issueParts,
  returnParts,
  adjustInventory,
  listTransactions,
  getValuation,
} from '../services/inventoryService.js';

const router = Router();

// GET /api/inventory - Current stock levels
router.get('/', async (req, res) => {
  res.json(await listInventory(pool));
});

// GET /api/inventory/fifo-layers - All FIFO layers with remaining qty > 0
router.get('/fifo-layers', async (req, res) => {
  const { part_id, location_id, include_depleted } = req.query;
  res.json(await listFifoLayers(pool, { part_id, location_id, include_depleted }));
});

// POST /api/inventory/move - Move inventory between locations (Story 3.1)
router.post('/move', async (req, res) => {
  const { part_id, from_location_id, to_location_id, quantity } = req.body;

  try {
    const result = await withTransaction(client =>
      moveInventory(client, { part_id, from_location_id, to_location_id, quantity })
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/inventory/dispose - Dispose of inventory (Story 5.2)
router.post('/dispose', async (req, res) => {
  const { part_id, location_id, quantity, reason } = req.body;

  try {
    const result = await withTransaction(client =>
      disposeInventory(client, { part_id, location_id, quantity, reason })
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/stash/inventory/issue - Issue parts (FIFO consumption) (Story 5.1)
router.post('/issue', async (req, res) => {
  const { part_id, location_id, quantity, reason, target_ref } = req.body;

  try {
    const result = await withTransaction(client =>
      issueParts(client, { part_id, location_id, quantity, reason, target_ref })
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/inventory/return - Return parts to inventory (Story 5.4)
router.post('/return', async (req, res) => {
  const { part_id, location_id, quantity, unit_cost, reason, reference } = req.body;

  try {
    const result = await withTransaction(client =>
      returnParts(client, { part_id, location_id, quantity, unit_cost, reason, reference })
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/inventory/adjust - Adjust inventory count (Story 5.5)
router.post('/adjust', async (req, res) => {
  const { part_id, location_id, new_quantity, unit_cost, reason } = req.body;

  try {
    const result = await withTransaction(client =>
      adjustInventory(client, { part_id, location_id, new_quantity, unit_cost, reason })
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /api/inventory/transactions - Audit trail
router.get('/transactions', async (req, res) => {
  const { part_id, location_id, limit: queryLimit } = req.query;
  const limit = parseInt(queryLimit) || 100;

  res.json(await listTransactions(pool, { part_id, location_id, limit }));
});

// GET /api/inventory/valuation - FIFO valuation report
router.get('/valuation', async (req, res) => {
  const { format } = req.query;
  const { layers, summary, grand_total: grandTotal } = await getValuation(pool);

  if (format === 'csv') {
    const csvLines = [
      'Part Number,Description,Location,Source,Original Qty,Remaining Qty,Unit Cost,Total Value,Receipt Date',
    ];
    for (const row of layers) {
      csvLines.push([
        row.part_number,
        `"${row.part_description}"`,
        `"${row.location_name}"`,
        row.source_ref,
        row.original_qty,
        row.remaining_qty,
        row.unit_cost.toFixed(2),
        row.total_value.toFixed(2),
        row.receipt_date,
      ].join(','));
    }
    csvLines.push('');
    csvLines.push(`,,,,,,Grand Total,"${grandTotal.toFixed(2)}",`);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=fifo_valuation_report.csv');
    return res.send(csvLines.join('\n'));
  }

  res.json({ layers, summary, grand_total: grandTotal });
});

export default router;
