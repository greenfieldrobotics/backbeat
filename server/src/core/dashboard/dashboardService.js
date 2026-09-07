// Dashboard services — all SQL for the cross-module dashboard lives here.
//
// The dashboard deliberately reads across modules (Stash inventory + POs joined to core
// locations). That is allowed: modules share one database, so a read that spans them is
// a single query, not an integration.

/** Stock quantity and FIFO value rolled up by location type. */
export async function getInventoryByLocationType(db) {
  // Aggregate quantity and value separately, then join — a single grouped query over
  // both inventory and fifo_layers would multiply rows together.
  const { rows } = await db.query(`
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
  return rows;
}

/** Part/location pairs running low — on hand but at or below five units. */
export async function getLowStockAlerts(db) {
  const { rows } = await db.query(`
    SELECT p.part_number, p.description, l.name AS location_name, i.quantity_on_hand
    FROM inventory i
    JOIN parts p ON i.part_id = p.id
    JOIN locations l ON i.location_id = l.id
    WHERE i.quantity_on_hand <= 5 AND i.quantity_on_hand > 0
    ORDER BY i.quantity_on_hand ASC
  `);
  return rows;
}

/** Every non-Closed PO with its line-item totals. */
export async function getOpenPurchaseOrders(db) {
  const { rows } = await db.query(`
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
  return rows;
}

/** Everything the dashboard page needs, in one call. */
export async function getDashboardData(db) {
  return {
    inventory_by_type: await getInventoryByLocationType(db),
    low_stock_alerts: await getLowStockAlerts(db),
    open_purchase_orders: await getOpenPurchaseOrders(db),
  };
}
