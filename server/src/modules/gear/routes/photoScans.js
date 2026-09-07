import { Router } from 'express';
import { withTransaction } from '../../../db/connection.js';
import { resolvePhotoScan } from '../services/photoScanService.js';

const router = Router();

// POST /api/gear/photo-scans - Resolve a decoded still-photo scan to its asset and
// record it (Phase 11, G4.3). The image itself never reaches this route — decoding
// happens client-side, reusing Phase 8's self-hosted decoder — so the body carries
// only the already-decoded serial plus when the photo was actually taken and the
// client's own idempotency key. Wrapped in a transaction for the same reason every
// other Gear write route is: the event insert and the idempotency-key insert must
// commit or roll back together.
router.post('/', async (req, res) => {
  const { serial, occurred_at, client_key, notes } = req.body;

  try {
    const result = await withTransaction(client => resolvePhotoScan(client, {
      serial, occurred_at, client_key, notes,
    }, req.user?.id));
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

export default router;
