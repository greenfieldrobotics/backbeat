// Photograph-and-resolve-later (Phase 11, G4.3). Decoding happens client-side, reusing
// Phase 8's self-hosted decoder as-is (client/src/core/scanning/zxingDecoder.ts) — this
// service only ever receives an already-decoded serial, never an image. Its job is the
// two things that ARE server-side: resolving that serial to an asset, and writing the
// event exactly once even if the same photo is submitted twice (§7.1).
import { executeSqlStrict, executeSqlWrite } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';
import { getAssetBySerial } from './assetService.js';
import { createAssetEvent } from './assetEventService.js';

/**
 * Resolve a decoded still-photo scan to its asset and record a `photo_scan` event.
 *
 * `occurred_at` is when the photo was actually taken — an EXIF timestamp or a
 * user-entered value, both resolved client-side before this call — and is passed
 * straight through to createAssetEvent(), which falls back to NOW() (upload time)
 * only when it is null (the "last resort" §7.1 asks for). `client_key` is the
 * client's own idempotency key: when given and a row already exists for it, this
 * returns the event already written (`duplicate: true`) instead of writing a
 * second one. Omitting it is allowed — the key is nullable — and simply means no
 * dedup happens for that submission, not an error.
 */
export async function resolvePhotoScan(db, { serial, occurred_at = null, client_key = null, notes = null }, actorUserId = null) {
  if (!serial) throw httpError('serial is required', 400);
  const asset = await getAssetBySerial(db, serial); // 404s if no asset has this serial

  if (client_key) {
    const existing = await executeSqlStrict(
      db,
      `SELECT ae.* FROM asset_event_photo_keys k
       JOIN asset_events ae ON ae.id = k.asset_event_id
       WHERE k.client_key = $1`,
      [client_key]
    );
    if (existing.length > 0) {
      return { asset, event: existing[0], duplicate: true };
    }
  }

  const event = await createAssetEvent(db, {
    asset_id: asset.id,
    event_type: 'photo_scan',
    occurred_at,
    actor_user_id: actorUserId,
    notes,
  });

  if (client_key) {
    await executeSqlWrite(
      db,
      'INSERT INTO asset_event_photo_keys (client_key, asset_event_id) VALUES ($1, $2)',
      [client_key, event.id]
    );
  }

  return { asset, event, duplicate: false };
}
