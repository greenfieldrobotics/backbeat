// Backbeat / Stash Module - Database Schema
// PostgreSQL

export async function initializeDatabase(pool) {
  await pool.query(`
    -- Parts catalog
    CREATE TABLE IF NOT EXISTS parts (
      id SERIAL PRIMARY KEY,
      part_number TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      unit_of_measure TEXT NOT NULL DEFAULT 'EA',
      classification TEXT NOT NULL DEFAULT 'General',
      cost NUMERIC(12,4),
      cost_125 NUMERIC(12,4),
      cost_600 NUMERIC(12,4),
      mfg_part_number TEXT,
      manufacturer TEXT,
      reseller TEXT,
      reseller_part_number TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Stocking locations
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('Warehouse', 'Regional Site', 'Contract Manufacturer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Suppliers
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Purchase Orders
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      po_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Ordered', 'Partially Received', 'Closed')),
      expected_delivery_date TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- PO Line Items
    CREATE TABLE IF NOT EXISTS po_line_items (
      id SERIAL PRIMARY KEY,
      purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
      part_id INTEGER NOT NULL REFERENCES parts(id),
      quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
      quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
      unit_cost NUMERIC(12,4) NOT NULL CHECK (unit_cost >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- FIFO Cost Layers
    CREATE TABLE IF NOT EXISTS fifo_layers (
      id SERIAL PRIMARY KEY,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      source_type TEXT NOT NULL CHECK (source_type IN ('PO_RECEIPT', 'ADJUSTMENT', 'RETURN')),
      source_ref TEXT,
      original_qty INTEGER NOT NULL CHECK (original_qty > 0),
      remaining_qty INTEGER NOT NULL CHECK (remaining_qty >= 0),
      unit_cost NUMERIC(12,4) NOT NULL CHECK (unit_cost >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Inventory summary (denormalized for quick lookups, kept in sync via transactions)
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
      UNIQUE(part_id, location_id)
    );

    -- Audit trail for all inventory transactions
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id SERIAL PRIMARY KEY,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('RECEIVE', 'ISSUE', 'MOVE', 'DISPOSE', 'ADJUSTMENT', 'RETURN')),
      part_id INTEGER NOT NULL REFERENCES parts(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      to_location_id INTEGER REFERENCES locations(id),
      quantity INTEGER NOT NULL,
      unit_cost NUMERIC(12,4),
      total_cost NUMERIC(12,4),
      reference_type TEXT,
      reference_id INTEGER,
      target_ref TEXT,
      reason TEXT,
      fifo_layers_consumed TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Users (allowlist for authentication)
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

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_fifo_layers_part_location ON fifo_layers(part_id, location_id, remaining_qty);
    CREATE INDEX IF NOT EXISTS idx_inventory_part_location ON inventory(part_id, location_id);
    CREATE INDEX IF NOT EXISTS idx_po_line_items_po ON po_line_items(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_part ON inventory_transactions(part_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON inventory_transactions(created_at);
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

  return pool;
}
