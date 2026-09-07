// Backbeat — database schema orchestrator
// PostgreSQL
//
// This is a modular monolith: ONE database shared by all modules. This file creates
// the shared/core tables (used across modules) and then delegates to each feature
// module's own schema. Because everything lives in one database, cross-module
// relationships (e.g. a Gear asset referencing a shared location) and cross-module
// workflows (single-transaction operations spanning modules) work directly.
//
// To add a module: create modules/<name>/schema.js exporting create<Name>Tables(pool),
// import it here, and call it inside initializeDatabase() after the core tables.

import { createStashTables } from '../modules/stash/schema.js';
import { createGearTables } from '../modules/gear/schema.js';
import { createPartyTables } from '../core/party/schema.js';

// Shared/core tables — owned by no single feature module and referenced across modules.
async function createCoreTables(pool) {
  await pool.query(`
    -- Stocking / physical locations (shared: used by Stash inventory and Gear assets)
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('Warehouse', 'Regional Site', 'Contract Manufacturer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Users (allowlist for authentication) — shared identity across all modules
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'warehouse', 'procurement', 'viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
  `);

  // Migrate existing databases: expand role constraint and update old 'user' role
  await pool.query(`
    DO $$
    BEGIN
      -- Update old 'user' role to 'viewer'
      UPDATE users SET role = 'viewer' WHERE role = 'user';
      -- Drop old constraint and add new one (idempotent)
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'warehouse', 'procurement', 'viewer'));
    EXCEPTION WHEN OTHERS THEN
      -- Constraint already correct, ignore
      NULL;
    END $$;
  `);

  // Seed admin user if users table is empty
  const { rows } = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(rows[0].count) === 0) {
    await pool.query(
      `INSERT INTO users (email, name, role) VALUES ('nandan.kalle@greenfieldrobotics.com', 'Nandan Kalle', 'admin')`
    );
    console.log('Seeded admin user: nandan.kalle@greenfieldrobotics.com');
  }
}

export async function initializeDatabase(pool) {
  // Order matters: core tables first (modules reference them via foreign keys).
  await createCoreTables(pool);
  await createPartyTables(pool);
  await createStashTables(pool);
  await createGearTables(pool);
  return pool;
}
