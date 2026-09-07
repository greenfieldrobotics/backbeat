import { Router } from 'express';
import pool from '../../../db/connection.js';
import { listSuppliers, createSupplier } from '../services/supplierService.js';

const router = Router();

// GET /api/suppliers
router.get('/', async (req, res) => {
  res.json(await listSuppliers(pool));
});

// POST /api/suppliers
router.post('/', async (req, res) => {
  try {
    const supplier = await createSupplier(pool, { name: req.body.name });
    res.status(201).json(supplier);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
