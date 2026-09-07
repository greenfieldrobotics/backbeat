import { Router } from 'express';
import { withTransaction } from '../../../db/connection.js';
import { createLink, closeLink } from '../services/assetLinkService.js';

const router = Router();

// POST /api/gear/asset-links - Open a link (G5.1, G5.2)
// Wrapped in a transaction even though this is a single insert, for the same reason
// every other Gear write route is: consistency with the rest of the module, and so a
// future rule (e.g. writing a note alongside the link) can be added without touching
// the transaction boundary.
router.post('/', async (req, res) => {
  const { parent_asset_id, child_asset_id, link_type, valid_from, notes } = req.body;

  try {
    const link = await withTransaction(client => createLink(client, {
      parent_asset_id, child_asset_id, link_type, valid_from, notes,
    }, req.user?.id));
    res.status(201).json(link);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PATCH /api/gear/asset-links/:id/close - Close an open link
router.patch('/:id/close', async (req, res) => {
  const { valid_to } = req.body;

  try {
    res.json(await withTransaction(client => closeLink(client, req.params.id, { valid_to })));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

export default router;
