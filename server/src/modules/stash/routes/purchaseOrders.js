import { Router } from 'express';
import pool, { withTransaction } from '../../../db/connection.js';
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
} from '../services/purchaseOrderService.js';

const router = Router();

// GET /api/purchase-orders - List all POs
router.get('/', async (req, res) => {
  res.json(await listPurchaseOrders(pool));
});

// GET /api/purchase-orders/:id - Get PO with line items
router.get('/:id', async (req, res) => {
  try {
    res.json(await getPurchaseOrder(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/purchase-orders - Create a PO
router.post('/', async (req, res) => {
  const { supplier_id, expected_delivery_date, line_items } = req.body;

  try {
    const po = await withTransaction(client =>
      createPurchaseOrder(client, { supplier_id, expected_delivery_date, line_items })
    );
    res.status(201).json(po);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/purchase-orders/:id/status - Update PO status
router.put('/:id/status', async (req, res) => {
  try {
    res.json(await updatePurchaseOrderStatus(pool, req.params.id, req.body.status));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/purchase-orders/:id/receive - Receive items against a PO
router.post('/:id/receive', async (req, res) => {
  const { location_id, items } = req.body;

  try {
    const result = await withTransaction(client =>
      receivePurchaseOrder(client, req.params.id, { location_id, items })
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

export default router;
