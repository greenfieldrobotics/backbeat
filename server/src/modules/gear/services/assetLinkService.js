// Gear asset link services — all SQL for the `asset_links` table lives here.
//
// asset_links is the L2 "linked" relationship (§2.3): dated parent/child edges between
// assets, not a column on either side. Batteries and VCUs move between robots; a
// `vcu_id` column on the robot table would hold only the current value and destroy the
// history G5.1 exists to capture. One relationship type — this table — covers
// battery-in-robot, robot-on-trailer and RTK-base-serving-field: a new use case is a
// new `link_type` string, never a schema change.
//
// occurred_at / valid_from: the plan lists both as if they might be distinct columns.
// They are not, here. `occurred_at` would record "when the link actually began"; but
// that is also the definition of `valid_from` — the interval's start IS the moment the
// technician made the connection. There is no case where a link becomes valid at a
// time other than when it happened. So this table has one column, `valid_from`, doing
// both jobs, plus `created_at` for the distinct thing that genuinely differs:
// when the system heard about it (row-insert time). That split still matters — a link
// captured offline and submitted later must keep the technician's timestamp in
// valid_from, not the upload time — it is just one column short of what the plan
// sketched, not the same collapse the plan warns against avoiding.
//
// `valid_to` closing the interval is the same idea in reverse: whatever timestamp is
// given (or NOW() if none) IS when the link ended, not a separate fact recorded later
// by someone else. Offline capture and sync (§7.1) is deferred wholesale, so a
// "when did we hear about the close" column is not built speculatively here either.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument, same as every other service.

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

const SELECT_WITH_JOINS = `
  SELECT
    al.*,
    p.serial_number AS parent_serial_number,
    pt.name AS parent_asset_type_name,
    c.serial_number AS child_serial_number,
    ct.name AS child_asset_type_name
  FROM asset_links al
  JOIN assets p ON al.parent_asset_id = p.id
  JOIN asset_types pt ON p.asset_type_id = pt.id
  JOIN assets c ON al.child_asset_id = c.id
  JOIN asset_types ct ON c.asset_type_id = ct.id
`;

export async function getLink(db, id) {
  const rows = await executeSqlStrict(db, `${SELECT_WITH_JOINS} WHERE al.id = $1`, [id]);
  if (rows.length === 0) throw httpError('Link not found', 404);
  return rows[0];
}

/**
 * One asset's link history, both as parent and as child, newest first. With `asOf`
 * given, narrows to the single link (if any) under which this asset was someone's
 * child on that date — "which robot was this VCU in on that date", the query G5.1
 * exists for — including a link that has since closed.
 */
export async function getLinksForAsset(db, assetId, { asOf = null } = {}) {
  if (asOf) {
    return executeSqlStrict(db, `
      ${SELECT_WITH_JOINS}
      WHERE al.child_asset_id = $1
        AND al.valid_from <= $2
        AND (al.valid_to IS NULL OR al.valid_to > $2)
      ORDER BY al.valid_from DESC
    `, [assetId, asOf]);
  }
  return executeSqlStrict(db, `
    ${SELECT_WITH_JOINS}
    WHERE al.parent_asset_id = $1 OR al.child_asset_id = $1
    ORDER BY al.valid_from DESC, al.id DESC
  `, [assetId]);
}

/**
 * Capability check (§2.3): only asset types that have reached L2 (supports_linking)
 * may participate in a link, on either side. Without this, an L0 type ends up in a
 * parent/child relationship its own UI never expected to render, the exact failure
 * mode §2.3 calls out for the maintenance UI.
 */
async function getLinkableAsset(db, id, role) {
  const rows = await executeSqlStrict(db, `
    SELECT a.id, a.serial_number, t.name AS asset_type_name, t.supports_linking
    FROM assets a
    JOIN asset_types t ON a.asset_type_id = t.id
    WHERE a.id = $1
  `, [id]);
  if (rows.length === 0) {
    throw httpError(`${role === 'parent' ? 'Parent' : 'Child'} asset not found`, 404);
  }
  const asset = rows[0];
  if (!asset.supports_linking) {
    throw httpError(
      `Asset type '${asset.asset_type_name}' does not support linking (L2) — ` +
      `enable supports_linking on its asset type before linking assets of that type`,
      400
    );
  }
  return asset;
}

/**
 * Open a link (G5.1, G5.2). Rejects a second open link for the same child with a
 * clean 409 — the partial unique index (`ux_asset_links_child_open` in schema.js) is
 * the backstop for a race between two requests that both reach this check before
 * either commits, not the primary mechanism. To move a child to a new parent, close
 * its current link first (closeLink), then open a new one; that leaves both rows
 * intact and queryable (acceptance), rather than this function silently closing the
 * old link on the caller's behalf.
 */
export async function createLink(db, {
  parent_asset_id,
  child_asset_id,
  link_type,
  valid_from = null,
  notes = null,
}, actorUserId = null) {
  if (!parent_asset_id) throw httpError('parent_asset_id is required', 400);
  if (!child_asset_id) throw httpError('child_asset_id is required', 400);
  if (!link_type || !String(link_type).trim()) throw httpError('link_type is required', 400);
  if (Number(parent_asset_id) === Number(child_asset_id)) {
    throw httpError('An asset cannot be linked to itself', 400);
  }

  await getLinkableAsset(db, parent_asset_id, 'parent');
  await getLinkableAsset(db, child_asset_id, 'child');

  const open = await executeSqlStrict(
    db,
    'SELECT id FROM asset_links WHERE child_asset_id = $1 AND valid_to IS NULL',
    [child_asset_id]
  );
  if (open.length > 0) {
    throw httpError(
      'This asset already has an open link — close it before opening a new one',
      409
    );
  }

  const id = await executeSqlInsert(db, `
    INSERT INTO asset_links (parent_asset_id, child_asset_id, link_type, valid_from, actor_user_id, notes)
    VALUES ($1, $2, $3, COALESCE($4, NOW()), $5, $6)
  `, [parent_asset_id, child_asset_id, String(link_type).trim(), valid_from, actorUserId, notes]);

  return getLink(db, id);
}

/** Close an open link (sets valid_to). 404 if it doesn't exist, 409 if already closed. */
export async function closeLink(db, id, { valid_to = null } = {}) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM asset_links WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Link not found', 404);
  if (rows[0].valid_to !== null) throw httpError('Link is already closed', 409);

  await executeSqlWrite(db, 'UPDATE asset_links SET valid_to = COALESCE($1, NOW()) WHERE id = $2', [valid_to, id]);

  return getLink(db, id);
}
