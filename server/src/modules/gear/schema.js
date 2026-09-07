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

    -- Time-bounded parent/child edges between assets (G5.1, G5.2) — dated, never a
    -- column on either asset, because batteries and VCUs move and a column only ever
    -- holds the current value. One relationship type covers battery-in-robot,
    -- robot-on-trailer and RTK-base-serving-field alike: a new use case is a new
    -- link_type value, never a schema change.
    --
    -- valid_from doubles as "when this link actually began" (what an occurred_at
    -- column would otherwise hold) — see assetLinkService.js's module comment for why
    -- a separate column would carry no distinct information here. created_at is the
    -- system-heard-about-it time, kept separate from valid_from for the same reason
    -- asset_events splits occurred_at from created_at (§6.5 item 1); the two are equal
    -- until offline capture (deferred, §7.1) exists.
    CREATE TABLE IF NOT EXISTS asset_links (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      parent_asset_id INTEGER NOT NULL REFERENCES assets(id),
      child_asset_id INTEGER NOT NULL REFERENCES assets(id),
      link_type TEXT NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_user_id INTEGER REFERENCES users(id),
      notes TEXT,
      CHECK (parent_asset_id != child_asset_id)
    );

    CREATE INDEX IF NOT EXISTS idx_asset_links_parent_asset_id ON asset_links(parent_asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_links_child_asset_id ON asset_links(child_asset_id);

    -- "No overlapping active links" (G5.1) is exactly what a Postgres EXCLUDE
    -- constraint is for, and exactly what SQL Server cannot express at all (§6.2) — so
    -- no EXCLUDE constraint. The rule is enforced in the service layer (a clean 409
    -- when a child already has an open link) with this partial unique index as the
    -- backstop, so a race between two requests that both pass the service check before
    -- either commits still can't leave two open rows for one child. Scoped to
    -- child_asset_id only, deliberately: a parent MAY have several simultaneously-open
    -- children (a robot can carry a battery AND a VCU at once), so uniqueness must not
    -- apply on the parent side.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_asset_links_child_open
      ON asset_links (child_asset_id) WHERE valid_to IS NULL;

    -- Work orders / service history per asset (G6.1). Any asset MAY have one opened
    -- against it regardless of type — the data model is not type-specific — but the
    -- L3 capability gate (§2.3, supports_maintenance) is enforced in the service
    -- layer, not here (see maintenanceOrderService.js's assertSupportsMaintenance()),
    -- the same split assetLinkService.js uses for L2/supports_linking.
    --
    -- Deliberately carries no parts-consumed field, column, or JSON blob, on
    -- purpose. G6.2 (parts consumed) is deferred, not deleted (requirements §7.8):
    -- its mechanism was reading Stash's inventory transactions, which no longer
    -- applies now that Stash is on hold, but its principle still binds — whatever
    -- system holds inventory is the one record of parts consumed, and this table
    -- must never grow a parallel log to compensate for the missing integration.
    CREATE TABLE IF NOT EXISTS maintenance_orders (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
      description TEXT,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      actor_user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_maintenance_orders_asset_id ON maintenance_orders(asset_id);

    -- Component wear by model (G6.3) — per-installation records against an
    -- asset_model, never against an asset of the component's own. Blades stay
    -- inventory (§5.6): a wear part living in dirt and rock strikes cannot carry a
    -- label that outlives its service life, so per-blade identity is deferred
    -- (§7.5) and this table never creates an asset row for the installed
    -- component — it only ever references one (installed_on_asset_id).
    --
    -- installed_at_hours/removed_at_hours are the HOST asset's meter-hour reading,
    -- not a timestamp — the requirement's "at hour Y" is a usage measure, and it is
    -- the number that actually answers "which design lasts longest" (G6.3), not a
    -- wall-clock date. removed_at_hours NULL means still installed, the same
    -- open/closed shape asset_links uses for valid_to.
    CREATE TABLE IF NOT EXISTS component_installations (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      asset_model_id INTEGER NOT NULL REFERENCES asset_models(id),
      installed_on_asset_id INTEGER NOT NULL REFERENCES assets(id),
      installed_at_hours NUMERIC NOT NULL,
      removed_at_hours NUMERIC,
      condition_on_removal TEXT,
      actor_user_id INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (removed_at_hours IS NULL OR removed_at_hours >= installed_at_hours)
    );

    CREATE INDEX IF NOT EXISTS idx_component_installations_asset_model_id ON component_installations(asset_model_id);
    CREATE INDEX IF NOT EXISTS idx_component_installations_installed_on_asset_id ON component_installations(installed_on_asset_id);
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
