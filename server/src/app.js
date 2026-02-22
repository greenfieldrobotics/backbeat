import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db/connection.js';
import passport from './auth/passport.js';
import { requireAuth } from './auth/authMiddleware.js';
import authRoutes from './auth/authRoutes.js';
import partsRouter from './routes/parts.js';
import locationsRouter from './routes/locations.js';
import suppliersRouter from './routes/suppliers.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import inventoryRouter from './routes/inventory.js';
import dashboardRouter from './routes/dashboard.js';
import usersRouter from './routes/users.js';

const app = express();

// Railway (and similar platforms) terminate TLS at their proxy
app.set('trust proxy', 1);

// CORS — allow credentials (cookies) from the frontend origin
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'backbeat-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Auth routes (unprotected — must be accessible to log in)
app.use('/auth', authRoutes);

// Health check (unprotected — for monitoring)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', module: 'Stash', version: '0.1.0' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'Database unreachable' });
  }
});

// Protect all /api routes
app.use('/api', requireAuth);

// API routes
app.use('/api/parts', partsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/users', usersRouter);

// Production: serve built React client
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

export default app;
