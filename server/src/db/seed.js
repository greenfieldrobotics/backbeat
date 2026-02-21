import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = getDb();

// Drop and recreate tables to handle schema changes
db.pragma('foreign_keys = OFF');
db.exec(`
  DROP TABLE IF EXISTS inventory_transactions;
  DROP TABLE IF EXISTS fifo_layers;
  DROP TABLE IF EXISTS inventory;
  DROP TABLE IF EXISTS po_line_items;
  DROP TABLE IF EXISTS purchase_orders;
  DROP TABLE IF EXISTS suppliers;
  DROP TABLE IF EXISTS parts;
  DROP TABLE IF EXISTS locations;
`);
db.pragma('foreign_keys = ON');

// Re-import schema to recreate tables
const { initializeDatabase } = await import('./schema.js');
initializeDatabase(db);

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

const insertPart = db.prepare(`
  INSERT INTO parts (part_number, description, unit_of_measure, classification, cost, cost_125, cost_600, mfg_part_number, manufacturer, reseller, reseller_part_number, notes)
  VALUES (?, ?, 'EA', ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let partCount = 0;
let skipped = 0;

const insertParts = db.transaction(() => {
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
      insertPart.run(pn, description, classification, cost, cost125, cost600, mfgPartNum, manufacturer, reseller, resellerPartNum, notes);
      partCount++;
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        skipped++;
      } else {
        throw err;
      }
    }
  }
});

insertParts();

// --- Seed Locations ---
const insertLocation = db.prepare('INSERT INTO locations (name, type) VALUES (?, ?)');
const locations = [
  ['Main Warehouse', 'Warehouse'],
  ['Kansas Regional', 'Regional Site'],
  ['Texas Regional', 'Regional Site'],
  ['CM - FlexAssembly', 'Contract Manufacturer'],
];
locations.forEach(([name, type]) => insertLocation.run(name, type));

// --- Seed Suppliers from unique manufacturers in the item master ---
const manufacturers = db.prepare(
  "SELECT DISTINCT manufacturer FROM parts WHERE manufacturer IS NOT NULL AND manufacturer != '' ORDER BY manufacturer"
).all();
const insertSupplier = db.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)');
let supplierCount = 0;
for (const row of manufacturers) {
  insertSupplier.run(row.manufacturer);
  supplierCount++;
}

// --- Summary ---
const classificationCounts = db.prepare(
  'SELECT classification, COUNT(*) as count FROM parts GROUP BY classification ORDER BY classification'
).all();

console.log('Seed data loaded successfully.');
console.log(`  - ${partCount} parts loaded from item master (${skipped} duplicates skipped)`);
console.log(`  - ${locations.length} locations`);
console.log(`  - ${supplierCount} suppliers (auto-populated from manufacturers)`);
console.log('');
console.log('Parts by classification:');
for (const row of classificationCounts) {
  console.log(`  ${row.classification}: ${row.count}`);
}

closeDb();
