// Gear module — database schema (asset management)
// Owns: assets.
// Cross-module by design: `location_id` references the shared/core `locations` table,
// so a Gear asset and Stash inventory can live at the same location and be reported together.

export async function createGearTables(pool) {
  await pool.query(`
    -- Assets tracked by the Gear module
    CREATE TABLE IF NOT EXISTS assets (
      id SERIAL PRIMARY KEY,
      asset_tag TEXT NOT NULL UNIQUE,
      serial_number TEXT,
      asset_type TEXT NOT NULL DEFAULT 'General',
      status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'In Use', 'Maintenance', 'Retired')),
      location_id INTEGER REFERENCES locations(id),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location_id);
    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

    -- Asset types as data (G1.2). Capability flags declare which Gear features a
    -- type has reached (§2.3) — the application checks these rather than assuming
    -- every type supports every feature.
    CREATE TABLE IF NOT EXISTS asset_types (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      supports_location BOOLEAN NOT NULL DEFAULT false,
      supports_linking BOOLEAN NOT NULL DEFAULT false,
      supports_maintenance BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true
    );

    -- Lifecycle states as data (G1.3) — extending the vocabulary is an admin
    -- action, not a migration.
    CREATE TABLE IF NOT EXISTS lifecycle_states (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_terminal BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true
    );

    -- Model catalog (G1.4) — specifications held once per model rather than per
    -- unit. manufacturer is NOT NULL on purpose (requirements §6.5 item 3).
    CREATE TABLE IF NOT EXISTS asset_models (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      asset_type_id INTEGER NOT NULL REFERENCES asset_types(id),
      manufacturer TEXT NOT NULL,
      model_name TEXT NOT NULL,
      specs JSONB,
      active BOOLEAN NOT NULL DEFAULT true,
      UNIQUE (manufacturer, model_name)
    );
  `);

  // Seed the starting lifecycle states — same four values as the existing
  // `assets.status` CHECK constraint (Phase 2 migrates assets onto this table).
  const { rows } = await pool.query('SELECT COUNT(*) FROM lifecycle_states');
  if (parseInt(rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO lifecycle_states (name, sort_order, is_terminal) VALUES
        ('Available', 1, false),
        ('In Use', 2, false),
        ('Maintenance', 3, false),
        ('Retired', 4, true)
    `);
    console.log('Seeded lifecycle states');
  }
}
