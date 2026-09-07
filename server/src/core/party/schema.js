// Party — core, shared database schema.
// Owns: parties.
// Core, not module-owned: owner/custodian on a Gear asset and, eventually, a Stash
// supplier all resolve to this one list (requirements §5.3). System users are the
// subset of parties that can log in; this table does not replace `users`.

export async function createPartyTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      party_type TEXT NOT NULL CHECK (party_type IN ('internal_entity', 'employee', 'customer', 'vendor')),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed Greenfield as the internal_entity party — the default asset owner (G1.5).
  const { rows } = await pool.query('SELECT COUNT(*) FROM parties');
  if (parseInt(rows[0].count) === 0) {
    await pool.query(
      `INSERT INTO parties (name, party_type) VALUES ('Greenfield', 'internal_entity')`
    );
    console.log('Seeded Greenfield party');
  }
}
