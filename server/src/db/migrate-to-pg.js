// One-time migration script: SQLite → PostgreSQL
// Exports all data from the existing SQLite database and imports into PostgreSQL.
//
// Usage: node src/db/migrate-to-pg.js
//
// Prerequisites:
//   - PostgreSQL must be running (docker compose up postgres)
//   - DATABASE_URL env var must be set (or defaults to localhost)
//   - server/data/backbeat.db must exist (the SQLite database)

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import pg from 'pg';
import { initializeDatabase } from './schema.js';

// Parse NUMERIC as float (same as connection.js)
pg.types.setTypeParser(1700, parseFloat);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'backbeat.db');

// --- Connect to both databases ---
console.log('Opening SQLite database:', DB_PATH);
const sqlite = new Database(DB_PATH, { readonly: true });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://backbeat:backbeat@localhost:5432/backbeat',
});

console.log('Connected to PostgreSQL');

// --- Create PostgreSQL schema ---
console.log('Creating PostgreSQL schema...');
await initializeDatabase(pool);

// --- Helper: migrate a table ---
async function migrateTable(tableName, columns) {
  const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (empty)`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const vals = columns.map(c => row[c] ?? null);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const colNames = columns.join(', ');
      await client.query(
        `INSERT INTO ${tableName} (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        vals
      );
    }

    await client.query('COMMIT');
    console.log(`  ${tableName}: ${rows.length} rows migrated`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Helper: reset sequence ---
async function resetSequence(tableName) {
  const seqName = `${tableName}_id_seq`;
  const { rows } = await pool.query(`SELECT MAX(id) as max_id FROM ${tableName}`);
  const maxId = rows[0].max_id;
  if (maxId) {
    await pool.query(`SELECT setval('${seqName}', $1)`, [maxId]);
    console.log(`  ${seqName} → ${maxId}`);
  }
}

// --- Migrate tables in FK dependency order ---
console.log('\nMigrating data...');

await migrateTable('parts', [
  'id', 'part_number', 'description', 'unit_of_measure', 'classification',
  'cost', 'cost_125', 'cost_600', 'mfg_part_number', 'manufacturer',
  'reseller', 'reseller_part_number', 'notes', 'created_at', 'updated_at'
]);

await migrateTable('locations', [
  'id', 'name', 'type', 'created_at', 'updated_at'
]);

await migrateTable('suppliers', [
  'id', 'name', 'created_at'
]);

await migrateTable('purchase_orders', [
  'id', 'po_number', 'supplier_id', 'status', 'expected_delivery_date',
  'created_at', 'updated_at'
]);

await migrateTable('po_line_items', [
  'id', 'purchase_order_id', 'part_id', 'quantity_ordered', 'quantity_received',
  'unit_cost', 'created_at'
]);

await migrateTable('fifo_layers', [
  'id', 'part_id', 'location_id', 'source_type', 'source_ref',
  'original_qty', 'remaining_qty', 'unit_cost', 'created_at'
]);

await migrateTable('inventory', [
  'id', 'part_id', 'location_id', 'quantity_on_hand'
]);

await migrateTable('inventory_transactions', [
  'id', 'transaction_type', 'part_id', 'location_id', 'to_location_id',
  'quantity', 'unit_cost', 'total_cost', 'reference_type', 'reference_id',
  'target_ref', 'reason', 'fifo_layers_consumed', 'created_at'
]);

// --- Reset sequences ---
console.log('\nResetting sequences...');
const tables = [
  'parts', 'locations', 'suppliers', 'purchase_orders',
  'po_line_items', 'fifo_layers', 'inventory', 'inventory_transactions'
];
for (const t of tables) {
  await resetSequence(t);
}

// --- Verify row counts ---
console.log('\nVerification — row counts:');
for (const t of tables) {
  const sqliteCount = sqlite.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
  const { rows } = await pool.query(`SELECT COUNT(*) as c FROM ${t}`);
  const pgCount = parseInt(rows[0].c);
  const match = sqliteCount === pgCount ? 'OK' : 'MISMATCH';
  console.log(`  ${t}: SQLite=${sqliteCount}  PostgreSQL=${pgCount}  ${match}`);
}

// --- Cleanup ---
sqlite.close();
await pool.end();
console.log('\nMigration complete!');
