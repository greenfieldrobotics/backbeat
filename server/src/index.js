import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import partsRouter from './routes/parts.js';
import locationsRouter from './routes/locations.js';
import suppliersRouter from './routes/suppliers.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import inventoryRouter from './routes/inventory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', module: 'Stash', version: '0.1.0' });
});

app.listen(PORT, () => {
  console.log(`Backbeat Stash API running on http://localhost:${PORT}`);
});

export default app;
