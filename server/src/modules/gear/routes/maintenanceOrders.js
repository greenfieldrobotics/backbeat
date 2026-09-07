import { Router } from 'express';
import pool, { withTransaction } from '../../../db/connection.js';
import {
  getMaintenanceOrder,
  createMaintenanceOrder,
  updateMaintenanceOrder,
} from '../services/maintenanceOrderService.js';

const router = Router();

// GET /api/gear/maintenance-orders/:id - Get a single maintenance order
router.get('/:id', async (req, res) => {
  try {
    res.json(await getMaintenanceOrder(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/gear/maintenance-orders - Open a work order (G6.1)
router.post('/', async (req, res) => {
  const { asset_id, description } = req.body;

  try {
    const order = await withTransaction(client => createMaintenanceOrder(client, { asset_id, description }, req.user?.id));
    res.status(201).json(order);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PATCH /api/gear/maintenance-orders/:id - Advance status and/or update the description
router.patch('/:id', async (req, res) => {
  const { status, description } = req.body;

  try {
    res.json(await withTransaction(client => updateMaintenanceOrder(client, req.params.id, { status, description }, req.user?.id)));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

export default router;
