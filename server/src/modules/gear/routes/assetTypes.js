import { Router } from 'express';
import pool from '../../../db/connection.js';
import {
  listAssetTypes,
  getAssetType,
  createAssetType,
  updateAssetType,
  deleteAssetType,
} from '../services/assetTypeService.js';

const router = Router();

// GET /api/gear/asset-types - List all asset types
router.get('/', async (req, res) => {
  res.json(await listAssetTypes(pool));
});

// GET /api/gear/asset-types/:id - Get single asset type
router.get('/:id', async (req, res) => {
  try {
    res.json(await getAssetType(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/gear/asset-types - Create an asset type
router.post('/', async (req, res) => {
  const { name, description, supports_location, supports_linking, supports_maintenance, active } = req.body;

  try {
    const assetType = await createAssetType(pool, {
      name, description, supports_location, supports_linking, supports_maintenance, active,
    });
    res.status(201).json(assetType);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/gear/asset-types/:id - Update an asset type
router.put('/:id', async (req, res) => {
  const { name, description, supports_location, supports_linking, supports_maintenance, active } = req.body;

  try {
    res.json(await updateAssetType(pool, req.params.id, {
      name, description, supports_location, supports_linking, supports_maintenance, active,
    }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// DELETE /api/gear/asset-types/:id - Delete an asset type
router.delete('/:id', async (req, res) => {
  try {
    await deleteAssetType(pool, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
