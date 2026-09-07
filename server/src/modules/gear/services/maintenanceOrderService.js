// Gear maintenance-order services — all SQL for `maintenance_orders` lives here.
//
// G6.1: a work order against an asset, open -> in_progress -> closed, with a service
// history per asset (getMaintenanceOrdersForAsset). The data model is not
// type-specific, but §2.3's L3 gate still applies: assertSupportsMaintenance() below
// is the capability check, mirroring assetLinkService.js's getLinkableAsset() for
// L2/supports_linking. componentInstallationService.js imports it too — installing a
// wear component on an asset is a maintenance action on that asset in the same sense
// a work order is, so both share one gate rather than two copies drifting apart.
//
// NO PARTS-CONSUMED FIELD ANYWHERE ON THIS TABLE, ON PURPOSE. See the schema.js
// comment above CREATE TABLE maintenance_orders for why: G6.2 is deferred, not
// deleted (requirements §7.8), and a missing Stash/Shopify integration is not a
// licence to build the parallel parts log G6.2 existed to prevent.

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

const VALID_STATUSES = ['open', 'in_progress', 'closed'];

export async function getMaintenanceOrder(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM maintenance_orders WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Maintenance order not found', 404);
  return rows[0];
}

/** An asset's service history, newest first (G6.1). */
export async function getMaintenanceOrdersForAsset(db, assetId) {
  return executeSqlStrict(
    db,
    'SELECT * FROM maintenance_orders WHERE asset_id = $1 ORDER BY opened_at DESC, id DESC',
    [assetId]
  );
}

/**
 * Capability check (§2.3): only an asset whose type has reached L3
 * (supports_maintenance) may have a maintenance order opened against it, or a
 * component installed on it. G6.1 says work orders apply to any asset "regardless
 * of type" — that describes the data model, not a licence to skip this check; the
 * application must still check the flag before accepting the action.
 */
export async function assertSupportsMaintenance(db, assetId) {
  const rows = await executeSqlStrict(db, `
    SELECT a.id, a.serial_number, t.name AS asset_type_name, t.supports_maintenance
    FROM assets a
    JOIN asset_types t ON a.asset_type_id = t.id
    WHERE a.id = $1
  `, [assetId]);
  if (rows.length === 0) throw httpError('Asset not found', 404);
  const asset = rows[0];
  if (!asset.supports_maintenance) {
    throw httpError(
      `Asset type '${asset.asset_type_name}' does not support maintenance (L3) — ` +
      `enable supports_maintenance on its asset type first`,
      400
    );
  }
  return asset;
}

/** Open a work order (G6.1). Only asset_id is required — everything else is filled
 * in as the work progresses, the same "cheap to start" bias as asset registration. */
export async function createMaintenanceOrder(db, { asset_id, description = null }, actorUserId = null) {
  if (!asset_id) throw httpError('asset_id is required', 400);
  await assertSupportsMaintenance(db, asset_id);

  const id = await executeSqlInsert(db, `
    INSERT INTO maintenance_orders (asset_id, description, actor_user_id)
    VALUES ($1, $2, $3)
  `, [asset_id, description, actorUserId]);

  return getMaintenanceOrder(db, id);
}

/**
 * Advance or annotate a work order. `status`, when given, must be one of
 * open/in_progress/closed; closed is terminal (same shape as lifecycle_states'
 * is_terminal) so a closed order cannot be reopened — correct it with a new order
 * instead. closed_at is stamped the first time status becomes 'closed' and never
 * accepted directly from the caller, matching how asset_links computes valid_to
 * rather than trusting a client-supplied close timestamp for "did this happen".
 */
export async function updateMaintenanceOrder(db, id, { status, description } = {}, actorUserId = null) {
  const existing = await getMaintenanceOrder(db, id);

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
  }
  if (existing.status === 'closed' && status !== undefined && status !== 'closed') {
    throw httpError('A closed maintenance order cannot be reopened', 409);
  }

  const nextStatus = status !== undefined ? status : existing.status;
  const nextDescription = description !== undefined ? description : existing.description;
  const nextClosedAt = nextStatus === 'closed' ? (existing.closed_at || new Date()) : existing.closed_at;
  const nextActorUserId = actorUserId !== null ? actorUserId : existing.actor_user_id;

  await executeSqlWrite(db, `
    UPDATE maintenance_orders SET
      status = $1,
      description = $2,
      closed_at = $3,
      actor_user_id = $4
    WHERE id = $5
  `, [nextStatus, nextDescription, nextClosedAt, nextActorUserId, id]);

  return getMaintenanceOrder(db, id);
}
