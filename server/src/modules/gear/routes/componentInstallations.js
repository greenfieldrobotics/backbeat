import { Router } from 'express';
import pool, { withTransaction } from '../../../db/connection.js';
import {
  getComponentInstallation,
  createComponentInstallation,
  removeComponentInstallation,
} from '../services/componentInstallationService.js';

const router = Router();

// GET /api/gear/component-installations/:id - Get a single installation record
router.get('/:id', async (req, res) => {
  try {
    res.json(await getComponentInstallation(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/gear/component-installations - Install a component (G6.3)
router.post('/', async (req, res) => {
  const { asset_model_id, installed_on_asset_id, installed_at_hours, notes } = req.body;

  try {
    const installation = await withTransaction(client => createComponentInstallation(client, {
      asset_model_id, installed_on_asset_id, installed_at_hours, notes,
    }, req.user?.id));
    res.status(201).json(installation);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PATCH /api/gear/component-installations/:id/remove - Remove an installed component
router.patch('/:id/remove', async (req, res) => {
  const { removed_at_hours, condition_on_removal } = req.body;

  try {
    res.json(await withTransaction(client => removeComponentInstallation(client, req.params.id, {
      removed_at_hours, condition_on_removal,
    })));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

export default router;
