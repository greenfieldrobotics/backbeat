// Gear asset services — all SQL for the `assets` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a cross-module transaction —
// see `workflows/commissionAsset.js`.
//
// Registration is deliberately cheap (§2.3): only asset_type_id and lifecycle_state_id
// are required. serial_number is optional — some things have no serial or an illegible
// one (requirements §5.1) — so uniqueness on it is a partial index (ux_assets_serial_number
// in schema.js), never a plain UNIQUE constraint, and duplicate detection here is an
// explicit existence check rather than a caught 23505 (see assetTypeService.js for why:
// SQL Server has no equivalent error code, and this module is meant to be born portable).

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';
import { createAssetEvent } from './assetEventService.js';

const SELECT_WITH_JOINS = `
  SELECT
    a.*,
    l.name AS location_name,
    t.name AS asset_type_name,
    s.name AS lifecycle_state_name,
    m.manufacturer AS model_manufacturer,
    m.model_name AS model_model_name,
    op.name AS owner_party_name,
    cp.name AS custodian_party_name
  FROM assets a
  LEFT JOIN locations l ON a.location_id = l.id
  LEFT JOIN asset_types t ON a.asset_type_id = t.id
  LEFT JOIN lifecycle_states s ON a.lifecycle_state_id = s.id
  LEFT JOIN asset_models m ON a.model_id = m.id
  LEFT JOIN parties op ON a.owner_party_id = op.id
  LEFT JOIN parties cp ON a.custodian_party_id = cp.id
`;

/**
 * Trim and uppercase — the one rule for turning a serial into its stored/lookup
 * form (G2.1). Exported so the by-serial lookup (Phase 5, label scanning) applies
 * the exact same rule reads use on write, rather than a second copy that could
 * drift: a label scanned lowercase or with stray whitespace must still resolve.
 * Empty/absent -> null.
 */
export function normalizeSerial(serial_number) {
  if (serial_number === undefined || serial_number === null) return null;
  const trimmed = String(serial_number).trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
}

async function getDefaultOwnerPartyId(db) {
  const rows = await executeSqlStrict(
    db,
    `SELECT id FROM parties WHERE name = 'Greenfield' AND party_type = 'internal_entity'`
  );
  if (rows.length === 0) {
    throw httpError('Default owner party (Greenfield) not found — has the database been seeded?', 500);
  }
  return rows[0].id;
}

/** Event from_value/to_value record names, not ids (§6.5 item 2) — null in, null out. */
async function lifecycleStateName(db, id) {
  if (!id) return null;
  const rows = await executeSqlStrict(db, 'SELECT name FROM lifecycle_states WHERE id = $1', [id]);
  return rows[0]?.name ?? null;
}

async function partyName(db, id) {
  if (!id) return null;
  const rows = await executeSqlStrict(db, 'SELECT name FROM parties WHERE id = $1', [id]);
  return rows[0]?.name ?? null;
}

/** Assets always travel with the display names of everything they reference. */
export async function listAssets(db) {
  return executeSqlStrict(db, `${SELECT_WITH_JOINS} ORDER BY a.serial_number NULLS LAST, a.id`);
}

export async function getAsset(db, id) {
  const rows = await executeSqlStrict(db, `${SELECT_WITH_JOINS} WHERE a.id = $1`, [id]);
  if (rows.length === 0) throw httpError('Asset not found', 404);
  return rows[0];
}

/**
 * Resolve a scanned label to its asset (G2.2). A missing serial is a normal
 * outcome — labels outlive assets — so this throws the same 404 shape as
 * getAsset(), not a distinct error, and the route/UI treat it as a not-found
 * state rather than a crash.
 */
export async function getAssetBySerial(db, serial) {
  const normalized = normalizeSerial(serial);
  if (normalized === null) throw httpError('Asset not found', 404);
  const rows = await executeSqlStrict(db, `${SELECT_WITH_JOINS} WHERE a.serial_number = $1`, [normalized]);
  if (rows.length === 0) throw httpError('Asset not found', 404);
  return rows[0];
}

/** Raw row (no joins) — used internally by updateAsset for its "existing" defaults. */
async function getAssetRaw(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM assets WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Asset not found', 404);
  return rows[0];
}

/**
 * Register an asset. Only asset_type_id and lifecycle_state_id are required (§2.3) —
 * everything else, including serial_number, is optional. owner_party_id defaults to
 * the Greenfield party when omitted (G1.5). Writes a `registered` event using the
 * same `db` as the insert (G3.2) — the caller (a route or `commissionAsset`) is
 * responsible for that being a transaction client, not the bare pool, so the two
 * writes commit or roll back together. `actorUserId` is whoever is making the
 * change, or null in dev/test where there is no `req.user` — passed in, never
 * looked up here.
 */
export async function createAsset(db, {
  serial_number = null,
  asset_type_id,
  lifecycle_state_id,
  model_id = null,
  location_id = null,
  owner_party_id,
  custodian_party_id = null,
  acquired_at = null,
  disposed_at = null,
  attributes = null,
  notes = null,
}, actorUserId = null) {
  if (!asset_type_id) throw httpError('asset_type_id is required', 400);
  if (!lifecycle_state_id) throw httpError('lifecycle_state_id is required', 400);

  const typeRows = await executeSqlStrict(db, 'SELECT id FROM asset_types WHERE id = $1', [asset_type_id]);
  if (typeRows.length === 0) throw httpError('Asset type not found', 404);

  const stateRows = await executeSqlStrict(db, 'SELECT id FROM lifecycle_states WHERE id = $1', [lifecycle_state_id]);
  if (stateRows.length === 0) throw httpError('Lifecycle state not found', 404);

  if (model_id) {
    const modelRows = await executeSqlStrict(db, 'SELECT id FROM asset_models WHERE id = $1', [model_id]);
    if (modelRows.length === 0) throw httpError('Asset model not found', 404);
  }

  if (location_id) {
    const locRows = await executeSqlStrict(db, 'SELECT id FROM locations WHERE id = $1', [location_id]);
    if (locRows.length === 0) throw httpError('Location not found', 404);
  }

  let resolvedOwnerPartyId = owner_party_id;
  if (resolvedOwnerPartyId === undefined || resolvedOwnerPartyId === null) {
    resolvedOwnerPartyId = await getDefaultOwnerPartyId(db);
  } else {
    const ownerRows = await executeSqlStrict(db, 'SELECT id FROM parties WHERE id = $1', [resolvedOwnerPartyId]);
    if (ownerRows.length === 0) throw httpError('Owner party not found', 404);
  }

  if (custodian_party_id) {
    const custodianRows = await executeSqlStrict(db, 'SELECT id FROM parties WHERE id = $1', [custodian_party_id]);
    if (custodianRows.length === 0) throw httpError('Custodian party not found', 404);
  }

  const normalizedSerial = normalizeSerial(serial_number);
  if (normalizedSerial !== null) {
    const dup = await executeSqlStrict(db, 'SELECT id FROM assets WHERE serial_number = $1', [normalizedSerial]);
    if (dup.length > 0) throw httpError('An asset with that serial_number already exists', 409);
  }

  const id = await executeSqlInsert(db, `
    INSERT INTO assets (
      serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
      owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [
    normalizedSerial,
    asset_type_id,
    lifecycle_state_id,
    model_id,
    location_id,
    resolvedOwnerPartyId,
    custodian_party_id,
    acquired_at,
    disposed_at,
    attributes === null ? null : JSON.stringify(attributes),
    notes,
  ]);

  await createAssetEvent(db, {
    asset_id: id,
    event_type: 'registered',
    location_id,
    actor_user_id: actorUserId,
  });

  return getAsset(db, id);
}

/** Patch an asset — fields left out of `changes` keep their current value. */
export async function updateAsset(db, id, changes, actorUserId = null) {
  const existing = await getAssetRaw(db, id);
  const {
    serial_number, asset_type_id, lifecycle_state_id, model_id, location_id,
    owner_party_id, custodian_party_id, acquired_at, disposed_at, attributes, notes,
  } = changes;

  const nextAssetTypeId = asset_type_id !== undefined ? asset_type_id : existing.asset_type_id;
  if (!nextAssetTypeId) throw httpError('asset_type_id is required', 400);
  const nextLifecycleStateId = lifecycle_state_id !== undefined ? lifecycle_state_id : existing.lifecycle_state_id;
  if (!nextLifecycleStateId) throw httpError('lifecycle_state_id is required', 400);

  if (asset_type_id !== undefined) {
    const rows = await executeSqlStrict(db, 'SELECT id FROM asset_types WHERE id = $1', [asset_type_id]);
    if (rows.length === 0) throw httpError('Asset type not found', 404);
  }
  if (lifecycle_state_id !== undefined) {
    const rows = await executeSqlStrict(db, 'SELECT id FROM lifecycle_states WHERE id = $1', [lifecycle_state_id]);
    if (rows.length === 0) throw httpError('Lifecycle state not found', 404);
  }
  if (model_id !== undefined && model_id !== null) {
    const rows = await executeSqlStrict(db, 'SELECT id FROM asset_models WHERE id = $1', [model_id]);
    if (rows.length === 0) throw httpError('Asset model not found', 404);
  }

  // Omitted keeps the current location; an explicit falsy value clears it.
  const locId = location_id === undefined ? existing.location_id : (location_id || null);
  if (locId) {
    const rows = await executeSqlStrict(db, 'SELECT id FROM locations WHERE id = $1', [locId]);
    if (rows.length === 0) throw httpError('Location not found', 404);
  }

  if (owner_party_id !== undefined && owner_party_id !== null) {
    const rows = await executeSqlStrict(db, 'SELECT id FROM parties WHERE id = $1', [owner_party_id]);
    if (rows.length === 0) throw httpError('Owner party not found', 404);
  }
  if (custodian_party_id !== undefined && custodian_party_id !== null) {
    const rows = await executeSqlStrict(db, 'SELECT id FROM parties WHERE id = $1', [custodian_party_id]);
    if (rows.length === 0) throw httpError('Custodian party not found', 404);
  }

  const normalizedSerial = serial_number !== undefined ? normalizeSerial(serial_number) : existing.serial_number;
  if (normalizedSerial !== null && normalizedSerial !== existing.serial_number) {
    const dup = await executeSqlStrict(db, 'SELECT id FROM assets WHERE serial_number = $1 AND id != $2', [normalizedSerial, id]);
    if (dup.length > 0) throw httpError('An asset with that serial_number already exists', 409);
  }

  // Custody is who HOLDS the asset (custodian_party_id) — distinct from who owns it
  // (G1.5). Computed here, not just inline in the UPDATE call, because the event
  // diff below needs the same "next" value.
  const nextCustodianPartyId = custodian_party_id !== undefined ? custodian_party_id : existing.custodian_party_id;

  await executeSqlWrite(db, `
    UPDATE assets SET
      serial_number = $1,
      asset_type_id = $2,
      lifecycle_state_id = $3,
      model_id = $4,
      location_id = $5,
      owner_party_id = $6,
      custodian_party_id = $7,
      acquired_at = $8,
      disposed_at = $9,
      attributes = $10,
      notes = $11,
      updated_at = NOW()
    WHERE id = $12
  `, [
    normalizedSerial,
    nextAssetTypeId,
    nextLifecycleStateId,
    model_id !== undefined ? model_id : existing.model_id,
    locId,
    owner_party_id !== undefined ? owner_party_id : existing.owner_party_id,
    nextCustodianPartyId,
    acquired_at !== undefined ? acquired_at : existing.acquired_at,
    disposed_at !== undefined ? disposed_at : existing.disposed_at,
    attributes !== undefined
      ? (attributes === null ? null : JSON.stringify(attributes))
      : (existing.attributes === null ? null : JSON.stringify(existing.attributes)),
    notes !== undefined ? notes : existing.notes,
    id,
  ]);

  // One event per dimension that actually changed — never for a value re-set to
  // what it already was — using the same `db` as the UPDATE above (G3.2). If the
  // caller passed the bare pool instead of a transaction client, these commit
  // independently of the UPDATE and of each other; that is exactly the failure mode
  // routes/assets.js's withTransaction wrapping exists to prevent.
  if (nextLifecycleStateId !== existing.lifecycle_state_id) {
    // Sequential, not Promise.all: `db` may be a single transaction client, which
    // cannot run overlapping queries.
    const fromName = await lifecycleStateName(db, existing.lifecycle_state_id);
    const toName = await lifecycleStateName(db, nextLifecycleStateId);
    await createAssetEvent(db, {
      asset_id: id,
      event_type: 'state_changed',
      from_value: fromName,
      to_value: toName,
      actor_user_id: actorUserId,
    });
  }

  if (locId !== existing.location_id) {
    await createAssetEvent(db, {
      asset_id: id,
      event_type: 'moved',
      location_id: locId,
      actor_user_id: actorUserId,
    });
  }

  if (nextCustodianPartyId !== existing.custodian_party_id) {
    const fromName = await partyName(db, existing.custodian_party_id);
    const toName = await partyName(db, nextCustodianPartyId);
    await createAssetEvent(db, {
      asset_id: id,
      event_type: 'custody_changed',
      party_id: nextCustodianPartyId,
      from_value: fromName,
      to_value: toName,
      actor_user_id: actorUserId,
    });
  }

  return getAsset(db, id);
}

/**
 * Every asset now has at least a `registered` event (asset_events.asset_id has no
 * ON DELETE CASCADE — nothing in this schema uses one), so deleting the asset
 * itself must also delete its event history in the same operation, not leave it
 * orphaned against a foreign key. This is not the same thing as the append-only
 * rule being violated: that rule is about an event being edited or removed while
 * its asset still exists. Once the asset itself is gone there is no subject left
 * for the history to describe. The route wraps this call in a transaction so the
 * two deletes commit or roll back together.
 */
export async function deleteAsset(db, id) {
  await executeSqlWrite(db, 'DELETE FROM asset_events WHERE asset_id = $1', [id]);
  const rowCount = await executeSqlWrite(db, 'DELETE FROM assets WHERE id = $1', [id]);
  if (rowCount === 0) throw httpError('Asset not found', 404);
}
