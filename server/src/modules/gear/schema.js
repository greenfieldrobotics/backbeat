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
  `);
}
