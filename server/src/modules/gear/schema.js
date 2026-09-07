// Gear module — database schema (asset management)
// Owns: assets, asset_types, lifecycle_states, asset_models.
// Cross-module by design: `location_id` and `owner_party_id`/`custodian_party_id`
// reference shared/core tables (`locations`, `parties`), so a Gear asset can be
// reported alongside Stash inventory and shares one party list with it.

export async function createGearTables(pool) {
  await pool.query(`
    -- Assets tracked by the Gear module. This CREATE TABLE reflects the scaffold's
    -- ORIGINAL shape — the guarded migration below brings any table in this shape
    -- (freshly created here, or left over from before Phase 2) up to the current
    -- shape. That is also why this statement itself is never edited to the new
    -- shape directly: initializeDatabase() must stay safe to re-run against a
    -- database created at any point in this table's history.
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

    -- Event stream (G3.2) — append-only history of what happened to an asset and
    -- when we heard about it. occurred_at and created_at are separate columns on
    -- purpose (requirements §6.5 item 1): they are equal for the entire online-only
    -- era and stay two columns so offline capture (deferred, §7.1) has somewhere to
    -- put a real "when it happened" without retroactively rewriting created_at.
    -- from_value/to_value are text, not ids: lifecycle states (and parties) can be
    -- renamed or deactivated, and an event recording a name stays true forever where
    -- one recording an id would become unreadable the day that row changes.
    CREATE TABLE IF NOT EXISTS asset_events (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('registered', 'moved', 'custody_changed', 'state_changed', 'note')),
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      location_id INTEGER REFERENCES locations(id),
      party_id INTEGER REFERENCES parties(id),
      from_value TEXT,
      to_value TEXT,
      actor_user_id INTEGER REFERENCES users(id),
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_asset_events_asset_id ON asset_events(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_events_occurred_at ON asset_events(occurred_at);
  `);

  // Migrate `assets` onto the reference tables (Phase 2). Guarded and idempotent —
  // safe whether this is a brand-new table (just created above, in the old shape)
  // or one left over from before this migration existed.
  await pool.query(`
    -- Rename the identity column. asset_tag already carries the values that
    -- inventory_transactions.target_ref/.reason reference (via commissionAsset) —
    -- renaming preserves that history. The old serial_number column is dropped
    -- first because it was never populated from anywhere; do not repopulate
    -- serial_number from a different source, or those historical strings stop
    -- matching any asset.
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assets' AND column_name = 'asset_tag') THEN
        ALTER TABLE assets DROP COLUMN serial_number;
        ALTER TABLE assets RENAME COLUMN asset_tag TO serial_number;
      END IF;
    END $$;

    -- serial_number is optional (requirements §5.1) and unique only when present —
    -- a plain UNIQUE constraint would allow at most one NULL after a port to SQL
    -- Server, so this has to be a partial index instead (requirements §6.2).
    ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_tag_key;
    ALTER TABLE assets ALTER COLUMN serial_number DROP NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_assets_serial_number
      ON assets (serial_number) WHERE serial_number IS NOT NULL;

    -- asset_type (free text) -> asset_type_id (G1.2).
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'asset_type_id') THEN
        ALTER TABLE assets ADD COLUMN asset_type_id INTEGER REFERENCES asset_types(id);
      END IF;
    END $$;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assets' AND column_name = 'asset_type') THEN
        ALTER TABLE assets DROP COLUMN asset_type;
      END IF;
    END $$;
    DROP INDEX IF EXISTS idx_assets_type;
    CREATE INDEX IF NOT EXISTS idx_assets_asset_type_id ON assets(asset_type_id);

    -- status (CHECK constraint) -> lifecycle_state_id (G1.3). Dropping the column
    -- drops assets_status_check with it — the constraint is defined on that column.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'lifecycle_state_id') THEN
        ALTER TABLE assets ADD COLUMN lifecycle_state_id INTEGER REFERENCES lifecycle_states(id);
      END IF;
    END $$;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assets' AND column_name = 'status') THEN
        ALTER TABLE assets DROP COLUMN status;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_assets_lifecycle_state_id ON assets(lifecycle_state_id);

    -- Model catalog reference (G1.4) — optional, a unit need not carry a model yet.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'model_id') THEN
        ALTER TABLE assets ADD COLUMN model_id INTEGER REFERENCES asset_models(id);
      END IF;
    END $$;

    -- Ownership and custody (G1.5) — both optional at the DB level; the service
    -- defaults a newly created asset's owner to the Greenfield party.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'owner_party_id') THEN
        ALTER TABLE assets ADD COLUMN owner_party_id INTEGER REFERENCES parties(id);
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'custodian_party_id') THEN
        ALTER TABLE assets ADD COLUMN custodian_party_id INTEGER REFERENCES parties(id);
      END IF;
    END $$;

    -- Finance-adjacent dates (requirements §5.7) — custody/insurance only, not
    -- capitalization (out of scope).
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'acquired_at') THEN
        ALTER TABLE assets ADD COLUMN acquired_at TIMESTAMPTZ;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'disposed_at') THEN
        ALTER TABLE assets ADD COLUMN disposed_at TIMESTAMPTZ;
      END IF;
    END $$;

    -- Open attributes (G1.6) — read and written whole; never queried into, never
    -- indexed (requirements §6.2).
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'assets' AND column_name = 'attributes') THEN
        ALTER TABLE assets ADD COLUMN attributes JSONB;
      END IF;
    END $$;
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
