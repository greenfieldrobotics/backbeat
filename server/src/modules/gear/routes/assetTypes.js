import { Router } from 'express';
import pool from '../../../db/connection.js';
import {
  listAssetTypes,
  getAssetType,
  createAssetType,
  updateAssetType,
  deleteAssetType,
} from '../services/assetTypeService.js';
import { getLabelSetting, setDefaultSymbology } from '../services/labelService.js';
import { requireAdmin } from '../../../core/auth/authMiddleware.js';

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

// POST /api/gear/asset-types - Create an asset type (Phase 12: admin-only)
router.post('/', requireAdmin, async (req, res) => {
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

// PUT /api/gear/asset-types/:id - Update an asset type (Phase 12: admin-only)
router.put('/:id', requireAdmin, async (req, res) => {
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

// GET /api/gear/asset-types/:id/label-setting - default label symbology for this
// type (G2.4). Data, not a hardcoded per-type switch — see labelService.js.
router.get('/:id/label-setting', async (req, res) => {
  try {
    res.json(await getLabelSetting(pool, req.params.id));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// PUT /api/gear/asset-types/:id/label-setting - set this type's default label
// symbology. Deliberately its own satellite table, not a column on asset_types
// (CLAUDE.md forbids a spine column without the platform owner's approval).
router.put('/:id/label-setting', async (req, res) => {
  try {
    res.json(await setDefaultSymbology(pool, req.params.id, req.body.default_symbology));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// DELETE /api/gear/asset-types/:id - Delete an asset type (Phase 12: admin-only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await deleteAssetType(pool, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
