import { Router } from 'express';
import { query } from '../db/connection.js';

const router = Router();

// GET /api/dashboard — aggregated dashboard data
router.get('/', async (req, res) => {
  try {
    // 1. Inventory by location type (aggregate separately to avoid cross-product)
    const inventoryByType = await query(`
      SELECT l.type,
             COALESCE(inv.total_qty, 0) AS total_qty,
             COALESCE(val.total_value, 0) AS total_value
      FROM (SELECT DISTINCT type FROM locations) l
      LEFT JOIN (
        SELECT l2.type, SUM(i.quantity_on_hand) AS total_qty
        FROM inventory i
        JOIN locations l2 ON i.location_id = l2.id
        GROUP BY l2.type
      ) inv ON inv.type = l.type
      LEFT JOIN (
        SELECT l2.type, SUM(fl.remaining_qty * fl.unit_cost) AS total_value
        FROM fifo_layers fl
        JOIN locations l2 ON fl.location_id = l2.id
        WHERE fl.remaining_qty > 0
        GROUP BY l2.type
      ) val ON val.type = l.type
      ORDER BY l.type
    `);

    // 2. Low-stock alerts — parts where any location has qty <= 5 and > 0
    const lowStock = await query(`
      SELECT p.part_number, p.description, l.name AS location_name, i.quantity_on_hand
      FROM inventory i
      JOIN parts p ON i.part_id = p.id
      JOIN locations l ON i.location_id = l.id
      WHERE i.quantity_on_hand <= 5 AND i.quantity_on_hand > 0
      ORDER BY i.quantity_on_hand ASC
    `);

    // 3. Open PO summary — non-Closed POs with line item totals
    const openPOs = await query(`
      SELECT po.id, po.po_number, po.status, s.name AS supplier_name,
             po.expected_delivery_date,
             COALESCE(SUM(li.quantity_ordered * li.unit_cost), 0) AS total_value,
             COALESCE(SUM(li.quantity_ordered), 0) AS total_qty_ordered,
             COALESCE(SUM(li.quantity_received), 0) AS total_qty_received
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      JOIN po_line_items li ON li.purchase_order_id = po.id
      WHERE po.status != 'Closed'
      GROUP BY po.id, po.po_number, po.status, s.name, po.expected_delivery_date
      ORDER BY po.created_at DESC
    `);

    res.json({
      inventory_by_type: inventoryByType.rows,
      low_stock_alerts: lowStock.rows,
      open_purchase_orders: openPOs.rows,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

export default router;
