import { Router } from 'express';
import pool from '../../db/connection.js';
import { getDashboardData } from './dashboardService.js';

const router = Router();

// GET /api/dashboard — aggregated dashboard data
router.get('/', async (req, res) => {
  try {
    res.json(await getDashboardData(pool));
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

export default router;
