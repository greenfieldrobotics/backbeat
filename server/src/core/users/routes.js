import { Router } from 'express';
import pool from '../../db/connection.js';
import { requireAdmin } from '../auth/authMiddleware.js';
import { listUsers, createUser, updateUser, deleteUser } from './userService.js';

const router = Router();

// All user management routes require admin
router.use(requireAdmin);

// GET /api/users — list all users
router.get('/', async (req, res) => {
  try {
    res.json(await listUsers(pool));
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/users — add user to allowlist
router.post('/', async (req, res) => {
  const { email, name, role } = req.body;

  try {
    const user = await createUser(pool, { email, name, role });
    res.status(201).json(user);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id — update user role/name
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, role } = req.body;

  try {
    const user = await updateUser(pool, id, { name, role });
    res.json(user);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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
    await deleteUser(pool, id);
    res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
