// HTTP routes for cross-module workflows (mounted at /api/workflows).
import { Router } from 'express';
import { commissionAsset } from './commissionAsset.js';

const router = Router();

// POST /api/workflows/commission-asset
// Body: { asset: {...}, consume: [{ part_id, location_id, quantity }] }
router.post('/commission-asset', async (req, res) => {
  try {
    const result = await commissionAsset({ ...(req.body || {}), actorUserId: req.user?.id });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

export default router;
