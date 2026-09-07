// Gear asset event services — all SQL for the append-only `asset_events` table
// lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument, same as every other service — this is what lets assetService write
// an event in the SAME transaction as the asset change that caused it (see
// assetService.js's module comment for why that matters).
//
// Append-only is enforced by omission: there is no update or delete function here,
// and routes/assets.js offers no route that would call one. History that can be
// edited is not history.

import { executeSqlStrict, executeSqlInsert } from '../../../db/connection.js';

/**
 * Write one event. `occurred_at` defaults to the transaction's NOW() when not given
 * (the online-only case — see the schema comment); a future offline-capture path can
 * pass an explicit, earlier timestamp without any change here. `actor_user_id` is
 * accepted as a plain argument, never looked up — callers (routes) are the ones with
 * access to `req.user`, and it is null in dev/test where auth is bypassed.
 */
export async function createAssetEvent(db, {
  asset_id,
  event_type,
  occurred_at = null,
  location_id = null,
  party_id = null,
  from_value = null,
  to_value = null,
  actor_user_id = null,
  notes = null,
}) {
  const id = await executeSqlInsert(db, `
    INSERT INTO asset_events (
      asset_id, event_type, occurred_at, location_id, party_id, from_value, to_value, actor_user_id, notes
    ) VALUES ($1, $2, COALESCE($3, NOW()), $4, $5, $6, $7, $8, $9)
  `, [asset_id, event_type, occurred_at, location_id, party_id, from_value, to_value, actor_user_id, notes]);

  const rows = await executeSqlStrict(db, 'SELECT * FROM asset_events WHERE id = $1', [id]);
  return rows[0];
}

/** One asset's history, newest first. Existence of the asset itself is the route's job. */
export async function getAssetEvents(db, asset_id) {
  return executeSqlStrict(db, `
    SELECT
      e.*,
      l.name AS location_name,
      p.name AS party_name,
      u.name AS actor_name
    FROM asset_events e
    LEFT JOIN locations l ON e.location_id = l.id
    LEFT JOIN parties p ON e.party_id = p.id
    LEFT JOIN users u ON e.actor_user_id = u.id
    WHERE e.asset_id = $1
    ORDER BY e.occurred_at DESC, e.id DESC
  `, [asset_id]);
}
