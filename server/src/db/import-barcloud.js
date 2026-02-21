// Import BarCloud transaction history into Backbeat/Stash
// Replays all transactions chronologically to build correct FIFO state
//
// Usage: node src/db/import-barcloud.js <path-to-csv>

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { initializeDatabase } from './schema.js';

pg.types.setTypeParser(1700, parseFloat);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CSV Parser (reused from seed.js) ---
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

// --- Date Parser ---
// Handles both "M/D/YYYY" and "M/D/YY H:MM" formats
function parseDate(dateStr) {
  if (!dateStr) return null;
  dateStr = dateStr.trim();

  // "M/D/YY H:MM" format (e.g., "8/5/24 9:57")
  const shortMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (shortMatch) {
    const [, m, d, yy, hh, mm] = shortMatch;
    const year = 2000 + parseInt(yy);
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${hh.padStart(2, '0')}:${mm}:00`;
  }

  // "M/D/YYYY" format (e.g., "8/30/2023")
  const longMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (longMatch) {
    const [, m, d, yyyy] = longMatch;
    return `${yyyy}-${m.padStart(2, '0')}-${d.padStart(2, '0')} 12:00:00`;
  }

  console.warn(`  Warning: Could not parse date "${dateStr}"`);
  return null;
}

// --- Location Mapping ---
// BarCloud location IDs → Stash location IDs
// BarCloud 1 = Main Warehouse (Stash id 1)
// BarCloud 2 = Kansas Regional (Stash id 2)
// "0001" is treated as 1 (leading zeros)
function mapLocationId(bcLocId) {
  if (!bcLocId) return null;
  const cleaned = bcLocId.replace(/^0+/, '') || '0';
  const id = parseInt(cleaned);
  if (id === 1) return 1; // Main Warehouse
  if (id === 2) return 2; // Kansas Regional
  return null; // Unknown (e.g., 99 = test)
}

// --- Reason Mapping ---
// BarCloud "Customer ID" → Stash reason
function mapReason(customerId) {
  if (!customerId) return null;
  const lower = customerId.toLowerCase().trim();
  if (lower === 'repair') return 'Repair';
  if (lower === 'new robot') return 'New Robot';
  if (lower === 'r&d') return 'R&D';
  if (lower === 'enhance') return 'Enhance';
  if (lower === '0' || lower === '') return null;
  return null; // Ignore other values like "Grand Total", "Usage", "Total", etc.
}

// --- Classification for new parts ---
const CLASSIFICATION_MAP = {
  'GFA': 'Assembly',
  'GFB': 'Cutter System',
  'GFE': 'Electronics',
  'GFF': 'Sensor',
  'GFG': 'Track System',
  'GFH': 'Hardware',
  'GFP': 'Production',
  'GFT': 'Tools',
  'GFW': 'Wiring',
  'GFZ': 'Misc',
};

// ===== MAIN =====
const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node src/db/import-barcloud.js <path-to-csv>');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://backbeat:backbeat@localhost:5432/backbeat',
});

const csvContent = fs.readFileSync(csvPath, 'utf-8');
const rows = parseCSV(csvContent);

console.log(`Loaded ${rows.length} rows from BarCloud history`);

// --- Step 1: Find and auto-create missing parts ---
const existingParts = new Map();
const { rows: partsRows } = await pool.query('SELECT id, part_number FROM parts');
for (const p of partsRows) {
  existingParts.set(p.part_number, p.id);
}

const missingParts = new Set();
const skipItems = new Set(['TEST001_FIFO']); // Skip test data

for (const row of rows) {
  const pn = (row['Stock Item #'] || '').trim();
  if (!pn || skipItems.has(pn)) continue;
  if (!existingParts.has(pn)) {
    missingParts.add(pn);
  }
}

if (missingParts.size > 0) {
  console.log(`\nCreating ${missingParts.size} missing parts from BarCloud history:`);
  for (const pn of [...missingParts].sort()) {
    const prefix = pn.substring(0, 3);
    const classification = CLASSIFICATION_MAP[prefix] || 'General';
    const description = `(Imported from BarCloud - no description available)`;
    await pool.query(
      'INSERT INTO parts (part_number, description, unit_of_measure, classification) VALUES ($1, $2, $3, $4)',
      [pn, description, 'EA', classification]
    );
    const { rows: newRows } = await pool.query('SELECT id FROM parts WHERE part_number = $1', [pn]);
    existingParts.set(pn, newRows[0].id);
    console.log(`  + ${pn} → id ${newRows[0].id} (${classification})`);
  }
}

// --- Step 2: Parse and sort transactions chronologically ---
const transactions = [];
let skipped = 0;

for (const row of rows) {
  const partNumber = (row['Stock Item #'] || '').trim();
  if (!partNumber || skipItems.has(partNumber)) {
    skipped++;
    continue;
  }

  const txType = (row['Inventory History Type'] || '').trim();
  const quantity = parseInt(row['Quantity Change'] || '0');
  const cost = parseFloat((row['Cost'] || '0').replace(/[$,]/g, ''));
  const fromLocBC = (row['Move From Location ID'] || '').trim();
  const toLocBC = (row['Move To Location ID'] || '').trim();
  const historyDate = parseDate(row['History Date']);
  const customerId = (row['Customer ID'] || '').trim();

  if (!txType || !historyDate) {
    skipped++;
    continue;
  }

  const partId = existingParts.get(partNumber);
  if (!partId) {
    skipped++;
    continue;
  }

  transactions.push({
    partNumber,
    partId,
    txType,
    quantity,
    unitCost: cost,
    fromLocationId: mapLocationId(fromLocBC),
    toLocationId: mapLocationId(toLocBC),
    date: historyDate,
    reason: mapReason(customerId),
    rawRow: row,
  });
}

// Sort by date, then by type priority (Receive first, then others)
const TYPE_ORDER = { Receive: 0, Return: 1, Adjust: 2, Move: 3, Issue: 4, Dispose: 5 };
transactions.sort((a, b) => {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) return dateCompare;
  return (TYPE_ORDER[a.txType] || 99) - (TYPE_ORDER[b.txType] || 99);
});

console.log(`\nParsed ${transactions.length} transactions (${skipped} skipped)`);
console.log(`Date range: ${transactions[0]?.date} to ${transactions[transactions.length - 1]?.date}`);

// --- Step 3: Replay transactions ---
// Helper functions using a dedicated client for the whole import transaction
const client = await pool.connect();

async function getInventory(partId, locationId) {
  const { rows } = await client.query(
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [partId, locationId]
  );
  return rows[0] || null;
}

async function upsertInventory(partId, locationId, qtyDelta) {
  const inv = await getInventory(partId, locationId);
  if (inv) {
    await client.query(
      'UPDATE inventory SET quantity_on_hand = quantity_on_hand + $1 WHERE part_id = $2 AND location_id = $3',
      [qtyDelta, partId, locationId]
    );
  } else {
    await client.query(
      'INSERT INTO inventory (part_id, location_id, quantity_on_hand) VALUES ($1, $2, $3)',
      [partId, locationId, qtyDelta]
    );
  }
}

async function insertFifoLayer(partId, locationId, sourceType, sourceRef, originalQty, remainingQty, unitCost, createdAt) {
  await client.query(`
    INSERT INTO fifo_layers (part_id, location_id, source_type, source_ref, original_qty, remaining_qty, unit_cost, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [partId, locationId, sourceType, sourceRef, originalQty, remainingQty, unitCost, createdAt]);
}

async function getFifoLayers(partId, locationId) {
  const { rows } = await client.query(`
    SELECT * FROM fifo_layers
    WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0
    ORDER BY created_at ASC, id ASC
  `, [partId, locationId]);
  return rows;
}

async function consumeFifoLayer(consumeQty, layerId) {
  await client.query(
    'UPDATE fifo_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2',
    [consumeQty, layerId]
  );
}

async function insertTransaction(txType, partId, locationId, toLocationId, qty, unitCost, totalCost, targetRef, reason, fifoConsumed, createdAt) {
  await client.query(`
    INSERT INTO inventory_transactions (transaction_type, part_id, location_id, to_location_id, quantity, unit_cost, total_cost, reference_type, target_ref, reason, fifo_layers_consumed, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'BARCLOUD_IMPORT', $8, $9, $10, $11)
  `, [txType, partId, locationId, toLocationId, qty, unitCost, totalCost, targetRef, reason, fifoConsumed, createdAt]);
}

async function consumeFifo(partId, locationId, quantity) {
  const layers = await getFifoLayers(partId, locationId);
  let remaining = quantity;
  let totalCost = 0;
  const consumed = [];

  for (const layer of layers) {
    if (remaining <= 0) break;
    const consumeQty = Math.min(remaining, layer.remaining_qty);
    const consumeCost = consumeQty * layer.unit_cost;

    await consumeFifoLayer(consumeQty, layer.id);
    consumed.push({
      layer_id: layer.id,
      quantity_consumed: consumeQty,
      unit_cost: layer.unit_cost,
      cost: consumeCost,
    });
    totalCost += consumeCost;
    remaining -= consumeQty;
  }

  if (remaining > 0) {
    return { consumed, totalCost, shortfall: remaining };
  }
  return { consumed, totalCost, shortfall: 0 };
}

const counts = { Receive: 0, Issue: 0, Move: 0, Dispose: 0, Return: 0, Adjust: 0 };
const warnings = [];

try {
  await client.query('BEGIN');

  for (const tx of transactions) {
    switch (tx.txType) {
      case 'Receive': {
        const locationId = tx.toLocationId || 1;
        await insertFifoLayer(
          tx.partId, locationId, 'PO_RECEIPT', `BC-Import-${tx.date}`,
          tx.quantity, tx.quantity, tx.unitCost, tx.date
        );
        await upsertInventory(tx.partId, locationId, tx.quantity);
        await insertTransaction(
          'RECEIVE', tx.partId, locationId, null,
          tx.quantity, tx.unitCost, tx.quantity * tx.unitCost,
          null, null, null, tx.date
        );
        counts.Receive++;
        break;
      }

      case 'Issue': {
        const locationId = tx.fromLocationId || 1;
        const { consumed, totalCost, shortfall } = await consumeFifo(tx.partId, locationId, tx.quantity);

        if (shortfall > 0) {
          await insertFifoLayer(
            tx.partId, locationId, 'ADJUSTMENT', `BC-Gap-${tx.date}`,
            shortfall, shortfall, tx.unitCost, tx.date
          );
          const gapResult = await consumeFifo(tx.partId, locationId, shortfall);
          consumed.push(...gapResult.consumed);
          warnings.push(`  FIFO gap: ${tx.partNumber} @ loc ${locationId}, short ${shortfall} on ${tx.date} (created gap layer)`);
          await upsertInventory(tx.partId, locationId, shortfall);
        }

        const avgCost = consumed.length > 0 ? (totalCost + (shortfall * tx.unitCost)) / tx.quantity : tx.unitCost;
        await upsertInventory(tx.partId, locationId, -tx.quantity);

        await insertTransaction(
          'ISSUE', tx.partId, locationId, null,
          -tx.quantity, avgCost, -(tx.quantity * avgCost),
          null, tx.reason, JSON.stringify(consumed), tx.date
        );
        counts.Issue++;
        break;
      }

      case 'Move': {
        const fromId = tx.fromLocationId;
        const toId = tx.toLocationId;
        if (!fromId || !toId) {
          warnings.push(`  Skipped Move: ${tx.partNumber} - missing location on ${tx.date}`);
          break;
        }

        const { consumed, totalCost, shortfall } = await consumeFifo(tx.partId, fromId, tx.quantity);

        if (shortfall > 0) {
          await insertFifoLayer(
            tx.partId, fromId, 'ADJUSTMENT', `BC-Gap-${tx.date}`,
            shortfall, shortfall, tx.unitCost, tx.date
          );
          const gapResult = await consumeFifo(tx.partId, fromId, shortfall);
          consumed.push(...gapResult.consumed);
          await upsertInventory(tx.partId, fromId, shortfall);
          warnings.push(`  FIFO gap: ${tx.partNumber} @ loc ${fromId}, short ${shortfall} for Move on ${tx.date}`);
        }

        for (const c of consumed) {
          await insertFifoLayer(
            tx.partId, toId, 'PO_RECEIPT', `BC-Move-${tx.date}`,
            c.quantity_consumed, c.quantity_consumed, c.unit_cost, tx.date
          );
        }

        await upsertInventory(tx.partId, fromId, -tx.quantity);
        await upsertInventory(tx.partId, toId, tx.quantity);

        const avgCost = tx.quantity > 0 ? (totalCost + (shortfall * tx.unitCost)) / tx.quantity : tx.unitCost;
        await insertTransaction(
          'MOVE', tx.partId, fromId, toId,
          tx.quantity, avgCost, tx.quantity * avgCost,
          null, null, JSON.stringify(consumed), tx.date
        );
        counts.Move++;
        break;
      }

      case 'Dispose': {
        const locationId = tx.fromLocationId || 1;
        const { consumed, totalCost, shortfall } = await consumeFifo(tx.partId, locationId, tx.quantity);

        if (shortfall > 0) {
          await insertFifoLayer(
            tx.partId, locationId, 'ADJUSTMENT', `BC-Gap-${tx.date}`,
            shortfall, shortfall, tx.unitCost, tx.date
          );
          const gapResult = await consumeFifo(tx.partId, locationId, shortfall);
          consumed.push(...gapResult.consumed);
          await upsertInventory(tx.partId, locationId, shortfall);
          warnings.push(`  FIFO gap: ${tx.partNumber} @ loc ${locationId}, short ${shortfall} for Dispose on ${tx.date}`);
        }

        const avgCost = consumed.length > 0 ? (totalCost + (shortfall * tx.unitCost)) / tx.quantity : tx.unitCost;
        await upsertInventory(tx.partId, locationId, -tx.quantity);

        await insertTransaction(
          'DISPOSE', tx.partId, locationId, null,
          -tx.quantity, avgCost, -(tx.quantity * avgCost),
          null, 'BarCloud disposal', JSON.stringify(consumed), tx.date
        );
        counts.Dispose++;
        break;
      }

      case 'Return': {
        const locationId = tx.toLocationId || 1;
        await insertFifoLayer(
          tx.partId, locationId, 'RETURN', `BC-Return-${tx.date}`,
          tx.quantity, tx.quantity, tx.unitCost, tx.date
        );
        await upsertInventory(tx.partId, locationId, tx.quantity);

        await insertTransaction(
          'RETURN', tx.partId, locationId, null,
          tx.quantity, tx.unitCost, tx.quantity * tx.unitCost,
          null, tx.reason, null, tx.date
        );
        counts.Return++;
        break;
      }

      case 'Adjust': {
        const locationId = tx.fromLocationId || tx.toLocationId || 1;

        if (tx.quantity >= 0) {
          await insertFifoLayer(
            tx.partId, locationId, 'ADJUSTMENT', `BC-Adjust-${tx.date}`,
            tx.quantity, tx.quantity, tx.unitCost, tx.date
          );
          await upsertInventory(tx.partId, locationId, tx.quantity);

          await insertTransaction(
            'ADJUSTMENT', tx.partId, locationId, null,
            tx.quantity, tx.unitCost, tx.quantity * tx.unitCost,
            null, 'Physical count (BarCloud)', null, tx.date
          );
        } else {
          const absQty = Math.abs(tx.quantity);
          const { consumed, totalCost, shortfall } = await consumeFifo(tx.partId, locationId, absQty);

          if (shortfall > 0) {
            await insertFifoLayer(
              tx.partId, locationId, 'ADJUSTMENT', `BC-Gap-${tx.date}`,
              shortfall, shortfall, tx.unitCost, tx.date
            );
            const gapResult = await consumeFifo(tx.partId, locationId, shortfall);
            consumed.push(...gapResult.consumed);
            await upsertInventory(tx.partId, locationId, shortfall);
            warnings.push(`  FIFO gap: ${tx.partNumber} @ loc ${locationId}, short ${shortfall} for Adjust on ${tx.date}`);
          }

          await upsertInventory(tx.partId, locationId, -absQty);

          const avgCost = consumed.length > 0 ? (totalCost + (shortfall * tx.unitCost)) / absQty : tx.unitCost;
          await insertTransaction(
            'ADJUSTMENT', tx.partId, locationId, null,
            -absQty, avgCost, -(absQty * avgCost),
            null, 'Physical count (BarCloud)', JSON.stringify(consumed), tx.date
          );
        }
        counts.Adjust++;
        break;
      }

      default:
        warnings.push(`  Unknown transaction type: ${tx.txType} for ${tx.partNumber} on ${tx.date}`);
    }
  }

  await client.query('COMMIT');
  console.log('\nImport completed successfully!');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('\nImport FAILED:', err.message);
  console.error(err.stack);
  client.release();
  await pool.end();
  process.exit(1);
}

// --- Summary ---
console.log('\nTransaction counts:');
for (const [type, count] of Object.entries(counts)) {
  console.log(`  ${type}: ${count}`);
}
console.log(`  Total: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);

if (warnings.length > 0) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) {
    console.log(w);
  }
}

// Final inventory state (use pool, client is still held)
client.release();

const { rows: invSummary } = await pool.query(`
  SELECT COUNT(DISTINCT part_id) as parts, COUNT(*) as rows, SUM(quantity_on_hand) as total_qty
  FROM inventory WHERE quantity_on_hand > 0
`);

const { rows: fifoSummary } = await pool.query(`
  SELECT COUNT(*) as layers, SUM(remaining_qty) as total_qty, SUM(remaining_qty * unit_cost) as total_value
  FROM fifo_layers WHERE remaining_qty > 0
`);

console.log('\nFinal inventory state:');
console.log(`  Parts with stock: ${invSummary[0].parts}`);
console.log(`  Inventory rows: ${invSummary[0].rows}`);
console.log(`  Total items on hand: ${invSummary[0].total_qty}`);
console.log(`  Active FIFO layers: ${fifoSummary[0].layers}`);
console.log(`  Total FIFO qty: ${fifoSummary[0].total_qty}`);
console.log(`  Total inventory value: $${fifoSummary[0].total_value?.toFixed(2) || '0.00'}`);

// Verify inventory matches FIFO layers
const { rows: mismatches } = await pool.query(`
  SELECT i.part_id, p.part_number, i.location_id, l.name as location_name,
    i.quantity_on_hand as inv_qty,
    COALESCE(f.fifo_qty, 0) as fifo_qty
  FROM inventory i
  JOIN parts p ON i.part_id = p.id
  JOIN locations l ON i.location_id = l.id
  LEFT JOIN (
    SELECT part_id, location_id, SUM(remaining_qty) as fifo_qty
    FROM fifo_layers WHERE remaining_qty > 0
    GROUP BY part_id, location_id
  ) f ON i.part_id = f.part_id AND i.location_id = f.location_id
  WHERE i.quantity_on_hand != COALESCE(f.fifo_qty, 0)
`);

if (mismatches.length > 0) {
  console.log(`\nINVENTORY/FIFO MISMATCHES (${mismatches.length}):`);
  for (const m of mismatches) {
    console.log(`  ${m.part_number} @ ${m.location_name}: inv=${m.inv_qty} fifo=${m.fifo_qty}`);
  }
} else {
  console.log('\nInventory/FIFO integrity check: PASSED (all quantities match)');
}

await pool.end();
