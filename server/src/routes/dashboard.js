import { Router } from 'express';
import { query } from '../db/connection.js';

const router = Router();

// GET /api/dashboard — aggregated dashboard data
router.get('/', async (req, res) => {
  try {
    // 1. Inventory by location type
    const inventoryByType = await query(`
      SELECT l.type,
             COALESCE(SUM(i.quantity_on_hand), 0) AS total_qty,
             COALESCE(SUM(fl.remaining_qty * fl.unit_cost), 0) AS total_value
      FROM locations l
      LEFT JOIN inventory i ON i.location_id = l.id
      LEFT JOIN fifo_layers fl ON fl.location_id = l.id AND fl.remaining_qty > 0
      GROUP BY l.type
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
