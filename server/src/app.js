import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db/connection.js';
import passport from './core/auth/passport.js';
import { requireAuth } from './core/auth/authMiddleware.js';
import { pingDatabase } from './core/health/healthService.js';
import authRoutes from './core/auth/authRoutes.js';
import usersRouter from './core/users/routes.js';
import locationsRouter from './core/locations/routes.js';
import partiesRouter from './core/party/routes.js';
import dashboardRouter from './core/dashboard/routes.js';
import partsRouter from './modules/stash/routes/parts.js';
import suppliersRouter from './modules/stash/routes/suppliers.js';
import purchaseOrdersRouter from './modules/stash/routes/purchaseOrders.js';
import inventoryRouter from './modules/stash/routes/inventory.js';
import assetsRouter from './modules/gear/routes/assets.js';
import assetTypesRouter from './modules/gear/routes/assetTypes.js';
import lifecycleStatesRouter from './modules/gear/routes/lifecycleStates.js';
import assetModelsRouter from './modules/gear/routes/assetModels.js';
import workflowsRouter from './workflows/routes.js';

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
    await pingDatabase(pool);
    res.json({ status: 'ok', service: 'Backbeat', modules: ['Stash', 'Gear'], version: '0.1.0' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'Database unreachable' });
  }
});

// Protect all /api routes
app.use('/api', requireAuth);

// Shared / core API routes (not module-specific — used across modules)
app.use('/api/users', usersRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/parties', partiesRouter);
app.use('/api/dashboard', dashboardRouter);

// Stash module API routes (namespaced under /api/stash)
app.use('/api/stash/parts', partsRouter);
app.use('/api/stash/suppliers', suppliersRouter);
app.use('/api/stash/purchase-orders', purchaseOrdersRouter);
app.use('/api/stash/inventory', inventoryRouter);

// Gear module API routes (namespaced under /api/gear)
app.use('/api/gear/assets', assetsRouter);
app.use('/api/gear/asset-types', assetTypesRouter);
app.use('/api/gear/lifecycle-states', lifecycleStatesRouter);
app.use('/api/gear/asset-models', assetModelsRouter);

// Cross-module workflows (operations that span more than one module)
app.use('/api/workflows', workflowsRouter);

// Production: serve built React client
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

export default app;
