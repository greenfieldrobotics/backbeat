import { Router } from 'express';
import pool from '../../../db/connection.js';
import {
  listAssetModels,
  getAssetModel,
  createAssetModel,
  updateAssetModel,
  deleteAssetModel,
} from '../services/assetModelService.js';

const router = Router();

// GET /api/gear/asset-models - List all asset models
router.get('/', async (req, res) => {
  res.json(await listAssetModels(pool));
});

// GET /api/gear/asset-models/:id - Get single asset model
router.get('/:id', async (req, res) => {
  try {
    res.json(await getAssetModel(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// POST /api/gear/asset-models - Create an asset model
router.post('/', async (req, res) => {
  const { asset_type_id, manufacturer, model_name, specs, active } = req.body;

  try {
    const model = await createAssetModel(pool, { asset_type_id, manufacturer, model_name, specs, active });
    res.status(201).json(model);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/gear/asset-models/:id - Update an asset model
router.put('/:id', async (req, res) => {
  const { asset_type_id, manufacturer, model_name, specs, active } = req.body;

  try {
    res.json(await updateAssetModel(pool, req.params.id, { asset_type_id, manufacturer, model_name, specs, active }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// DELETE /api/gear/asset-models/:id - Delete an asset model
router.delete('/:id', async (req, res) => {
  try {
    await deleteAssetModel(pool, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
