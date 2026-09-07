// Gear component-installation services — all SQL for `component_installations`.
//
// G6.3: per-installation wear records against an asset_model — installed on asset X
// at hour Y, removed at hour Z, condition on removal — never against an asset of the
// component's own. Blades stay inventory (§5.6): a wear part cannot carry a durable
// label, so this table never creates an asset row for the installed component, only
// references one (installed_on_asset_id, the host it was installed on).
//
// "Which design lasts longest" (G6.3) is answered by getComponentInstallationsForModel
// below — every installation of one model, across every asset it has ever been on —
// not by per-unit identity.
//
// Shares the L3 gate with maintenance orders (§2.3, supports_maintenance): installing
// a component on an asset is a maintenance action on that asset, so it is gated the
// same way opening a work order is — see assertSupportsMaintenance() in
// maintenanceOrderService.js.

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';
import { assertSupportsMaintenance } from './maintenanceOrderService.js';

const SELECT_WITH_JOINS = `
  SELECT
    ci.*,
    m.manufacturer AS model_manufacturer,
    m.model_name AS model_model_name,
    a.serial_number AS installed_on_serial_number
  FROM component_installations ci
  JOIN asset_models m ON ci.asset_model_id = m.id
  JOIN assets a ON ci.installed_on_asset_id = a.id
`;

export async function getComponentInstallation(db, id) {
  const rows = await executeSqlStrict(db, `${SELECT_WITH_JOINS} WHERE ci.id = $1`, [id]);
  if (rows.length === 0) throw httpError('Component installation not found', 404);
  return rows[0];
}

/** Every installation this asset has hosted, current and past. */
export async function getComponentInstallationsForAsset(db, assetId) {
  return executeSqlStrict(
    db,
    `${SELECT_WITH_JOINS} WHERE ci.installed_on_asset_id = $1 ORDER BY ci.installed_at_hours DESC, ci.id DESC`,
    [assetId]
  );
}

/** Every installation of one model, across every asset it has ever been on — the
 * comparison G6.3 exists for, without per-blade identity. */
export async function getComponentInstallationsForModel(db, modelId) {
  return executeSqlStrict(
    db,
    `${SELECT_WITH_JOINS} WHERE ci.asset_model_id = $1 ORDER BY ci.installed_at_hours DESC, ci.id DESC`,
    [modelId]
  );
}

async function assertAssetModelExists(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT id FROM asset_models WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Asset model not found', 400);
}

function assertHours(value, field) {
  if (value === undefined || value === null || value === '' || isNaN(Number(value))) {
    throw httpError(`${field} is required and must be a number`, 400);
  }
}

/** Install a component (G6.3): records the model and the host asset's hour reading
 * at install. Creates no asset row for the component itself. */
export async function createComponentInstallation(db, {
  asset_model_id,
  installed_on_asset_id,
  installed_at_hours,
  notes = null,
}, actorUserId = null) {
  if (!asset_model_id) throw httpError('asset_model_id is required', 400);
  if (!installed_on_asset_id) throw httpError('installed_on_asset_id is required', 400);
  assertHours(installed_at_hours, 'installed_at_hours');

  await assertAssetModelExists(db, asset_model_id);
  await assertSupportsMaintenance(db, installed_on_asset_id);

  const id = await executeSqlInsert(db, `
    INSERT INTO component_installations (asset_model_id, installed_on_asset_id, installed_at_hours, actor_user_id, notes)
    VALUES ($1, $2, $3, $4, $5)
  `, [asset_model_id, installed_on_asset_id, installed_at_hours, actorUserId, notes]);

  return getComponentInstallation(db, id);
}

/** Remove an installed component, recording the host's hour reading and its
 * condition at removal (G6.3). 404 if it doesn't exist, 409 if already removed. */
export async function removeComponentInstallation(db, id, { removed_at_hours, condition_on_removal = null } = {}) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM component_installations WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Component installation not found', 404);
  const existing = rows[0];
  if (existing.removed_at_hours !== null) throw httpError('This installation has already been removed', 409);
  assertHours(removed_at_hours, 'removed_at_hours');
  if (Number(removed_at_hours) < Number(existing.installed_at_hours)) {
    throw httpError('removed_at_hours cannot be less than installed_at_hours', 400);
  }

  await executeSqlWrite(
    db,
    'UPDATE component_installations SET removed_at_hours = $1, condition_on_removal = $2 WHERE id = $3',
    [removed_at_hours, condition_on_removal, id]
  );

  return getComponentInstallation(db, id);
}
