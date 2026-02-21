import express from 'express';
import cors from 'cors';
import pool from './db/connection.js';
import partsRouter from './routes/parts.js';
import locationsRouter from './routes/locations.js';
import suppliersRouter from './routes/suppliers.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import inventoryRouter from './routes/inventory.js';

const app = express();

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

export default app;
