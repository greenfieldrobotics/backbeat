import { Router } from 'express';
import pool, { query } from '../../../db/connection.js';
import { createAsset } from '../services/assetService.js';

const router = Router();

const VALID_STATUSES = ['Available', 'In Use', 'Maintenance', 'Retired'];

// GET /api/gear/assets - List all assets (joined with their shared/core location)
router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT
      a.id,
      a.asset_tag,
      a.serial_number,
      a.asset_type,
      a.status,
      a.location_id,
      l.name AS location_name,
      a.notes,
      a.created_at,
      a.updated_at
    FROM assets a
    LEFT JOIN locations l ON a.location_id = l.id
    ORDER BY a.asset_tag
  `);
  res.json(rows);
});

// GET /api/gear/assets/:id - Get a single asset
router.get('/:id', async (req, res) => {
  const { rows } = await query(`
    SELECT a.*, l.name AS location_name
    FROM assets a
    LEFT JOIN locations l ON a.location_id = l.id
    WHERE a.id = $1
  `, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
  res.json(rows[0]);
});

// POST /api/gear/assets - Create an asset
router.post('/', async (req, res) => {
  try {
    const asset = await createAsset(pool, req.body);
    res.status(201).json(asset);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PUT /api/gear/assets/:id - Update an asset
router.put('/:id', async (req, res) => {
  const { asset_tag, serial_number, asset_type, status, location_id, notes } = req.body;

  if (asset_tag !== undefined && !asset_tag.trim()) {
    return res.status(400).json({ error: 'asset_tag cannot be empty' });
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const { rows: existingRows } = await query('SELECT * FROM assets WHERE id = $1', [req.params.id]);
  if (existingRows.length === 0) return res.status(404).json({ error: 'Asset not found' });
  const existing = existingRows[0];

  const locId = location_id === undefined ? existing.location_id : (location_id || null);
  if (locId) {
    const { rows: locRows } = await query('SELECT id FROM locations WHERE id = $1', [locId]);
    if (locRows.length === 0) return res.status(404).json({ error: 'Location not found' });
  }

  try {
    const { rows } = await query(`
      UPDATE assets SET
        asset_tag = $1,
        serial_number = $2,
        asset_type = $3,
        status = $4,
        location_id = $5,
        notes = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [
      asset_tag !== undefined ? asset_tag.trim() : existing.asset_tag,
      serial_number !== undefined ? serial_number : existing.serial_number,
      asset_type !== undefined ? asset_type : existing.asset_type,
      status !== undefined ? status : existing.status,
      locId,
      notes !== undefined ? notes : existing.notes,
      req.params.id,
    ]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An asset with that asset_tag already exists' });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/gear/assets/:id - Delete an asset
router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM assets WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Asset not found' });
  res.status(204).end();
});

export default router;
