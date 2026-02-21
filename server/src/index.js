import express from 'express';
import cors from 'cors';
import pool, { closePool } from './db/connection.js';
import { initializeDatabase } from './db/schema.js';
import partsRouter from './routes/parts.js';
import locationsRouter from './routes/locations.js';
import suppliersRouter from './routes/suppliers.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import inventoryRouter from './routes/inventory.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/parts', partsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/inventory', inventoryRouter);

// Health check — pings the database to confirm connectivity
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', module: 'Stash', version: '0.1.0' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'Database unreachable' });
  }
});

async function start() {
  await initializeDatabase(pool);

  app.listen(PORT, () => {
    console.log(`Backbeat Stash API running on http://localhost:${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — closing database pool');
  await closePool();
  process.exit(0);
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
