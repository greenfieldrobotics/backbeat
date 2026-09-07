// Cross-module workflow: commission an asset.
//
// This is the whole point of the modular-monolith design: a single user action that
// spans TWO feature modules, executed atomically in ONE database transaction.
//
//   1. Gear:  create the asset.
//   2. Stash: issue the parts consumed to build/deploy it out of inventory (FIFO),
//             tagging each inventory transaction with a reference back to the asset.
//
// If any step fails, the whole thing rolls back — you never end up with an asset that
// "consumed" parts that were never deducted, or vice versa. Modules are organized in
// separate folders, but nothing stops them composing here.

import { withTransaction } from '../db/connection.js';
import { createAsset } from '../modules/gear/services/assetService.js';
import { issueParts } from '../modules/stash/services/inventoryService.js';

/**
 * @param {object} input
 * @param {object} input.asset            - asset fields (asset_tag, serial_number, asset_type, location_id, ...)
 * @param {Array}  [input.consume]        - parts to issue: [{ part_id, location_id, quantity }]
 */
export async function commissionAsset({ asset, consume = [] }) {
  return withTransaction(async (client) => {
    // Gear module
    const createdAsset = await createAsset(client, {
      ...asset,
      status: asset?.status || 'In Use',
    });

    // Stash module — issue each consumed part, referenced back to the new asset
    const partsIssued = [];
    for (const line of consume) {
      const issued = await issueParts(client, {
        part_id: line.part_id,
        location_id: line.location_id,
        quantity: line.quantity,
        reason: `Commissioned asset ${createdAsset.asset_tag}`,
        target_ref: createdAsset.asset_tag,
        reference_type: 'ASSET',
        reference_id: createdAsset.id,
      });
      partsIssued.push(issued);
    }

    return { asset: createdAsset, parts_issued: partsIssued };
  });
}
