import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdmin } from '../auth/authMiddleware.js';

const router = Router();

const VALID_ROLES = ['admin', 'warehouse', 'procurement', 'viewer'];

// All user management routes require admin
router.use(requireAdmin);

// GET /api/users — list all users
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, role, picture, created_at, last_login_at FROM users ORDER BY name, email'
    );
    res.json(rows);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/users — add user to allowlist
router.post('/', async (req, res) => {
  const { email, name, role } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const { rows } = await query(
      'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id, email, name, role, created_at, last_login_at',
      [email.trim().toLowerCase(), (name || '').trim(), role || 'viewer']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id — update user role/name
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, role } = req.body;

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const updates = [];
    const params = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(name.trim());
    }
    if (role !== undefined) {
      updates.push(`role = $${idx++}`);
      params.push(role);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    const { rows } = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, created_at, last_login_at`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id — remove user from allowlist
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  // Prevent self-deletion (in test/dev mode, there's no req.user, so skip check)
  if (req.user && req.user.id === parseInt(id)) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
