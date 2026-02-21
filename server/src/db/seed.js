// Seed script for fresh PostgreSQL databases
// Reads parts from the item master CSV, creates locations and suppliers
//
// Usage: node src/db/seed.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { initializeDatabase } from './schema.js';

pg.types.setTypeParser(1700, parseFloat);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://backbeat:backbeat@localhost:5432/backbeat',
});

const client = await pool.connect();

try {
  await client.query('BEGIN');

  // Drop and recreate tables
  await client.query(`
    DROP TABLE IF EXISTS inventory_transactions CASCADE;
    DROP TABLE IF EXISTS fifo_layers CASCADE;
    DROP TABLE IF EXISTS inventory CASCADE;
    DROP TABLE IF EXISTS po_line_items CASCADE;
    DROP TABLE IF EXISTS purchase_orders CASCADE;
    DROP TABLE IF EXISTS suppliers CASCADE;
    DROP TABLE IF EXISTS parts CASCADE;
    DROP TABLE IF EXISTS locations CASCADE;
  `);

  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}

// Re-create schema
await initializeDatabase(pool);

// --- Load Item Master from CSV ---
const csvPath = path.join(dataDir, 'item_master.csv');
if (!fs.existsSync(csvPath)) {
  console.error(`Item master CSV not found at: ${csvPath}`);
  console.error('Copy your item master CSV to server/data/item_master.csv and re-run.');
  process.exit(1);
}

// Simple CSV parser (no external dependency needed)
function parseCSV(content) {
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

const csvContent = fs.readFileSync(csvPath, 'utf-8');
const records = parseCSV(csvContent);

// Classification mapping based on part number prefix
const CLASSIFICATION_MAP = {
  'GFA': 'Assembly',
  'GFB': 'Cutter System',
  'GFE': 'Electronics',
  'GFF': 'Sensor',
  'GFG': 'Track System',
  'GFH': 'Hardware',
  'GFP': 'Production',
  'GFW': 'Wiring',
  'GFZ': 'Misc',
};

function parseCost(str) {
  if (!str) return null;
  const cleaned = str.replace(/[$,]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

let partCount = 0;
let skipped = 0;

const seedClient = await pool.connect();
try {
  await seedClient.query('BEGIN');

  for (const row of records) {
    const pn = (row['GFR Part Num'] || '').trim();
    if (!pn) continue;

    const prefix = pn.substring(0, 3);
    const classification = CLASSIFICATION_MAP[prefix] || 'General';
    const description = (row['Description'] || '').trim();
    const cost = parseCost(row['Cost']);
    const cost125 = parseCost(row['Cost/125pcs']);
    const cost600 = parseCost(row['Cost/600pcs']);
    const mfgPartNum = (row['Mfg Part Num'] || '').trim() || null;
    const manufacturer = (row['Manufacturer'] || '').trim() || null;
    const reseller = (row['Reseller'] || '').trim() || null;
    const resellerPartNum = (row['Reseller Part Num'] || '').trim() || null;
    const notes = (row['Notes'] || '').trim() || null;

    try {
      await seedClient.query(`
        INSERT INTO parts (part_number, description, unit_of_measure, classification, cost, cost_125, cost_600, mfg_part_number, manufacturer, reseller, reseller_part_number, notes)
        VALUES ($1, $2, 'EA', $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (part_number) DO NOTHING
      `, [pn, description, classification, cost, cost125, cost600, mfgPartNum, manufacturer, reseller, resellerPartNum, notes]);
      partCount++;
    } catch (err) {
      if (err.code === '23505') {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  // --- Seed Locations ---
  const locations = [
    ['Main Warehouse', 'Warehouse'],
    ['Kansas Regional', 'Regional Site'],
    ['Texas Regional', 'Regional Site'],
    ['CM - FlexAssembly', 'Contract Manufacturer'],
  ];
  for (const [name, type] of locations) {
    await seedClient.query(
      'INSERT INTO locations (name, type) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      [name, type]
    );
  }

  // --- Seed Suppliers from unique manufacturers ---
  const { rows: manufacturers } = await seedClient.query(
    "SELECT DISTINCT manufacturer FROM parts WHERE manufacturer IS NOT NULL AND manufacturer != '' ORDER BY manufacturer"
  );
  let supplierCount = 0;
  for (const row of manufacturers) {
    await seedClient.query(
      'INSERT INTO suppliers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [row.manufacturer]
    );
    supplierCount++;
  }

  await seedClient.query('COMMIT');

  // --- Summary ---
  const { rows: classificationCounts } = await pool.query(
    'SELECT classification, COUNT(*) as count FROM parts GROUP BY classification ORDER BY classification'
  );

  console.log('Seed data loaded successfully.');
  console.log(`  - ${partCount} parts loaded from item master (${skipped} duplicates skipped)`);
  console.log(`  - ${locations.length} locations`);
  console.log(`  - ${supplierCount} suppliers (auto-populated from manufacturers)`);
  console.log('');
  console.log('Parts by classification:');
  for (const row of classificationCounts) {
    console.log(`  ${row.classification}: ${row.count}`);
  }
} catch (err) {
  await seedClient.query('ROLLBACK');
  console.error('Seed failed:', err);
  process.exit(1);
} finally {
  seedClient.release();
}

await pool.end();
