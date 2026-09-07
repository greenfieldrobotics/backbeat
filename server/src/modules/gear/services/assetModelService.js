// Gear asset model services — all SQL for the `asset_models` table lives here.
//
// Every function takes a `db` (the pool, or a pg client already inside a BEGIN) as its
// first argument so it can run standalone or compose inside a caller's transaction.
// Uniqueness on (manufacturer, model_name) is enforced with an explicit existence
// check before the insert/update — see assetTypeService.js for why this replaces a
// caught 23505. `specs` is the model's own open attributes field: read and written
// whole, never queried into (requirements §6.2).

import { executeSqlStrict, executeSqlWrite, executeSqlInsert } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';

export async function listAssetModels(db) {
  return executeSqlStrict(db, 'SELECT * FROM asset_models ORDER BY manufacturer, model_name');
}

export async function getAssetModel(db, id) {
  const rows = await executeSqlStrict(db, 'SELECT * FROM asset_models WHERE id = $1', [id]);
  if (rows.length === 0) throw httpError('Asset model not found', 404);
  return rows[0];
}

async function assertAssetTypeExists(db, asset_type_id) {
  const rows = await executeSqlStrict(db, 'SELECT id FROM asset_types WHERE id = $1', [asset_type_id]);
  if (rows.length === 0) throw httpError('Asset type not found', 400);
}

async function assertNoDuplicate(db, manufacturer, model_name, excludeId = null) {
  const dup = excludeId === null
    ? await executeSqlStrict(db, 'SELECT id FROM asset_models WHERE manufacturer = $1 AND model_name = $2', [manufacturer, model_name])
    : await executeSqlStrict(db, 'SELECT id FROM asset_models WHERE manufacturer = $1 AND model_name = $2 AND id != $3', [manufacturer, model_name, excludeId]);
  if (dup.length > 0) throw httpError('An asset model with that manufacturer and model_name already exists', 409);
}

export async function createAssetModel(db, {
  asset_type_id,
  manufacturer,
  model_name,
  specs = null,
  active = true,
}) {
  if (!asset_type_id) throw httpError('asset_type_id is required', 400);
  if (!manufacturer || !manufacturer.trim()) throw httpError('manufacturer is required', 400);
  if (!model_name || !model_name.trim()) throw httpError('model_name is required', 400);

  await assertAssetTypeExists(db, asset_type_id);
  await assertNoDuplicate(db, manufacturer.trim(), model_name.trim());

  const id = await executeSqlInsert(db, `
    INSERT INTO asset_models (asset_type_id, manufacturer, model_name, specs, active)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    asset_type_id,
    manufacturer.trim(),
    model_name.trim(),
    specs === null ? null : JSON.stringify(specs),
    active === undefined ? true : !!active,
  ]);

  return getAssetModel(db, id);
}

export async function updateAssetModel(db, id, changes) {
  const existing = await getAssetModel(db, id);
  const { asset_type_id, manufacturer, model_name, specs, active } = changes;

  if (manufacturer !== undefined && !manufacturer.trim()) throw httpError('manufacturer cannot be empty', 400);
  if (model_name !== undefined && !model_name.trim()) throw httpError('model_name cannot be empty', 400);

  if (asset_type_id !== undefined) {
    await assertAssetTypeExists(db, asset_type_id);
  }

  const nextManufacturer = manufacturer !== undefined ? manufacturer.trim() : existing.manufacturer;
  const nextModelName = model_name !== undefined ? model_name.trim() : existing.model_name;
  if (nextManufacturer !== existing.manufacturer || nextModelName !== existing.model_name) {
    await assertNoDuplicate(db, nextManufacturer, nextModelName, id);
  }

  await executeSqlWrite(db, `
    UPDATE asset_models SET
      asset_type_id = $1,
      manufacturer = $2,
      model_name = $3,
      specs = $4,
      active = $5
    WHERE id = $6
  `, [
    asset_type_id !== undefined ? asset_type_id : existing.asset_type_id,
    nextManufacturer,
    nextModelName,
    specs !== undefined ? (specs === null ? null : JSON.stringify(specs)) : (existing.specs === null ? null : JSON.stringify(existing.specs)),
    active !== undefined ? !!active : existing.active,
    id,
  ]);

  return getAssetModel(db, id);
}

export async function deleteAssetModel(db, id) {
  const rowCount = await executeSqlWrite(db, 'DELETE FROM asset_models WHERE id = $1', [id]);
  if (rowCount === 0) throw httpError('Asset model not found', 404);
}
