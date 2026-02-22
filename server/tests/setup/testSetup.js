import { query } from '../../src/db/connection.js';

/**
 * Truncate all tables in the correct order (respecting foreign keys).
 * Call this in beforeEach() to isolate tests.
 */
export async function truncateAllTables() {
  await query(`
    TRUNCATE TABLE
      inventory_transactions,
      fifo_layers,
      inventory,
      po_line_items,
      purchase_orders,
      suppliers,
      locations,
      parts,
      users
    RESTART IDENTITY CASCADE
  `);
}
