// Stash inventory services — reusable business logic extracted from the route handlers
// so it can be composed inside a larger transaction (e.g. by cross-module workflows).
//
// Every function takes a `client` (a pg client already inside a BEGIN) as its first
// argument. It does NOT manage the transaction itself — the caller owns BEGIN/COMMIT/ROLLBACK.
// On failure it throws an Error with a `.status` property for the HTTP layer to use.

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Issue parts out of inventory using FIFO cost consumption.
 * Reused by POST /api/stash/inventory/issue and by the commission-asset workflow.
 */
export async function issueParts(client, {
  part_id,
  location_id,
  quantity,
  reason = null,
  target_ref = null,
  reference_type = 'MANUAL',
  reference_id = null,
}) {
  if (!part_id || !location_id || !quantity || quantity <= 0) {
    throw httpError('part_id, location_id, and positive quantity are required', 400);
  }

  const { rows: partRows } = await client.query('SELECT * FROM parts WHERE id = $1', [part_id]);
  if (partRows.length === 0) throw httpError('Part not found', 404);
  const part = partRows[0];

  const { rows: locRows } = await client.query('SELECT * FROM locations WHERE id = $1', [location_id]);
  if (locRows.length === 0) throw httpError('Location not found', 404);
  const location = locRows[0];

  const { rows: invRows } = await client.query(
    'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
    [part_id, location_id]
  );
  const inv = invRows[0];
  if (!inv || inv.quantity_on_hand < quantity) {
    throw httpError(
      `Insufficient inventory. Available: ${inv ? inv.quantity_on_hand : 0}, Requested: ${quantity}`,
      400
    );
  }

  // Consume FIFO layers oldest first
  const { rows: layers } = await client.query(`
    SELECT * FROM fifo_layers
    WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0
    ORDER BY created_at ASC, id ASC
  `, [part_id, location_id]);

  let remainingToIssue = quantity;
  let totalCost = 0;
  const layersConsumed = [];

  for (const layer of layers) {
    if (remainingToIssue <= 0) break;

    const consumeQty = Math.min(remainingToIssue, layer.remaining_qty);
    const consumeCost = consumeQty * layer.unit_cost;

    await client.query(
      'UPDATE fifo_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2',
      [consumeQty, layer.id]
    );

    layersConsumed.push({
      layer_id: layer.id,
      quantity_consumed: consumeQty,
      unit_cost: layer.unit_cost,
      cost: consumeCost,
      source_ref: layer.source_ref,
    });

    totalCost += consumeCost;
    remainingToIssue -= consumeQty;
  }

  // Update inventory
  await client.query(
    'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_id = $2 AND location_id = $3',
    [quantity, part_id, location_id]
  );

  // Audit trail
  const avgCost = totalCost / quantity;
  await client.query(`
    INSERT INTO inventory_transactions (transaction_type, part_id, location_id, quantity, unit_cost, total_cost, reference_type, reference_id, target_ref, reason, fifo_layers_consumed)
    VALUES ('ISSUE', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [part_id, location_id, -quantity, avgCost, -totalCost, reference_type, reference_id, target_ref, reason, JSON.stringify(layersConsumed)]);

  return {
    part_number: part.part_number,
    location: location.name,
    quantity_issued: quantity,
    total_cost: totalCost,
    average_unit_cost: avgCost,
    target_ref,
    fifo_layers_consumed: layersConsumed,
  };
}
