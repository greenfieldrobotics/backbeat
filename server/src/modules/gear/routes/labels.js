import { Router } from 'express';
import pool from '../../../db/connection.js';
import { generateAssetLabel, generateAssetLabels } from '../services/labelService.js';

const router = Router();

// GET /api/gear/labels?ids=1,2,3[&symbology=qr|datamatrix] - a batch of labels for
// a print sheet (G2.4). Per-asset failures (no serial, unknown id) are reported in
// `errors` rather than failing the whole request.
router.get('/', async (req, res) => {
  const idsParam = req.query.ids;
  if (!idsParam) {
    return res.status(400).json({ error: 'ids query parameter is required (comma-separated asset ids)' });
  }
  const ids = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);
  res.json(await generateAssetLabels(pool, ids, { symbology: req.query.symbology || undefined }));
});

// GET /api/gear/labels/:assetId[?symbology=qr|datamatrix] - one asset's label.
// symbology overrides the asset type's configured default — a battery may go
// either way depending on available flat area (G2.4).
router.get('/:assetId', async (req, res) => {
  try {
    res.json(await generateAssetLabel(pool, req.params.assetId, { symbology: req.query.symbology || undefined }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
