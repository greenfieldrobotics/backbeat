// Gear label generation (Phase 7, G2.4) — server-side only.
//
// Runs entirely in Node via bwip-js, an npm dependency committed like any other
// server dependency. Nothing here is loaded from a CDN, and nothing about barcode
// generation ships to the client bundle at all — the client only ever receives the
// finished SVG as data. That trivially satisfies the self-hosting constraint (§6.3)
// that Phase 8's camera *decoder* has to work harder for, because there is no
// runtime request of any kind, from any origin, involved in producing a code.
//
// Generation is not decoding: this is a different library from Phase 8's ZXing
// reader, which only ever runs in the browser to interpret a live camera frame.
// bwip-js never touches the decode path and zxing-wasm never touches this one.
//
// The encoded value is always `<LABEL_HOST>/a/<serial>` — the path-based URL Phase
// 5's route resolves (§6.4: a URL fragment is never sent to a server, so the serial
// has to be in the path). LABEL_HOST is read from configuration (an env var),
// never hardcoded, so pointing labels at the durable host once G2.3 lands is a
// one-line config change, not a code change.
import bwipjs from 'bwip-js';
import { executeSqlStrict, executeSqlWrite } from '../../../db/connection.js';
import { httpError } from '../../../core/http.js';
import { getAsset } from './assetService.js';
import { getAssetType } from './assetTypeService.js';

export const SYMBOLOGIES = ['qr', 'datamatrix'];
const DEFAULT_SYMBOLOGY = 'qr';

// Module size and quiet zone are fixed per symbology, not left at whatever bwip-js
// renders by default — a code that looks fine on a screen can be physically
// unreadable once printed small and scuffed.
//
// bwip-js's `scale` is points-per-module at its fixed 72dpi output (1 point =
// 1/72in = 0.3528mm), so scale:3 -> ~1.06mm/module and scale:2 -> ~0.71mm/module.
// QR gets the larger module: robots/vehicles/trailers/bins have the surface for it
// and it maximizes scan reliability at a phone-camera distance. DataMatrix gets the
// smaller module: VCUs/small electronics need the smaller footprint, and
// DataMatrix's error correction tolerates the smaller mark better than QR does.
// `paddingwidth`/`paddingheight` (also points, same conversion) add an explicit
// quiet zone on top of whatever margin the symbol's own spec already bakes in.
//
// For a representative `<host>/a/<serial>` URL against the http://localhost:5173
// dev default, this renders a QR label at roughly 70x70mm and a DataMatrix label at
// roughly 35x35mm — both scale up with a longer configured host (e.g. a real
// domain), because the physical size of a 2D code is a function of how much text
// it encodes, not just its module count. See handoff/phase-7-response.md for the
// measurements this was calibrated against.
const SYMBOLOGY_SPECS = {
  qr: { bcid: 'qrcode', scale: 3, paddingwidth: 4, paddingheight: 4 },
  datamatrix: { bcid: 'datamatrix', scale: 2, paddingwidth: 3, paddingheight: 3 },
};

/** The host printed on every label. Configuration, never a hardcoded string (§6.4) —
 * the dev default matches the Vite dev server's own default origin, not a
 * production value.
 */
export function getLabelHost() {
  return process.env.LABEL_HOST || 'http://localhost:5173';
}

/** `<host>/a/<serial>` — path-based, never a fragment (§6.4), reusing Phase 5's
 * `/a/:serial` route as-is.
 */
export function buildLabelUrl(serial) {
  return `${getLabelHost()}/a/${encodeURIComponent(serial)}`;
}

function assertValidSymbology(symbology) {
  if (!SYMBOLOGIES.includes(symbology)) {
    throw httpError(`symbology must be one of: ${SYMBOLOGIES.join(', ')}`, 400);
  }
}

/**
 * Per-type default symbology (G2.4's asset-class table), read as data — never a
 * hardcoded per-type `switch` (that breaks the moment someone adds a type, which
 * G1.2 exists to make possible without a code change). No row for a type means
 * "not yet configured", not an error: every asset type that predates this table
 * falls back to DEFAULT_SYMBOLOGY.
 */
export async function getDefaultSymbology(db, assetTypeId) {
  if (!assetTypeId) return DEFAULT_SYMBOLOGY;
  const rows = await executeSqlStrict(
    db,
    'SELECT default_symbology FROM asset_type_label_settings WHERE asset_type_id = $1',
    [assetTypeId]
  );
  return rows.length > 0 ? rows[0].default_symbology : DEFAULT_SYMBOLOGY;
}

/**
 * Sets a type's default symbology. Existence check + explicit INSERT-or-UPDATE
 * rather than `ON CONFLICT` — requirements §6.2 rules that out for new service code
 * (SQL Server has no equivalent), the same convention assetTypeService.js already
 * follows for its own uniqueness checks.
 */
export async function setDefaultSymbology(db, assetTypeId, symbology) {
  assertValidSymbology(symbology);
  await getAssetType(db, assetTypeId); // 404s if the type doesn't exist

  const existing = await executeSqlStrict(
    db,
    'SELECT asset_type_id FROM asset_type_label_settings WHERE asset_type_id = $1',
    [assetTypeId]
  );
  if (existing.length > 0) {
    await executeSqlWrite(
      db,
      'UPDATE asset_type_label_settings SET default_symbology = $1 WHERE asset_type_id = $2',
      [symbology, assetTypeId]
    );
  } else {
    await executeSqlWrite(
      db,
      'INSERT INTO asset_type_label_settings (asset_type_id, default_symbology) VALUES ($1, $2)',
      [assetTypeId, symbology]
    );
  }
  return { asset_type_id: Number(assetTypeId), default_symbology: symbology };
}

export async function getLabelSetting(db, assetTypeId) {
  await getAssetType(db, assetTypeId); // 404s if the type doesn't exist
  const default_symbology = await getDefaultSymbology(db, assetTypeId);
  return { asset_type_id: Number(assetTypeId), default_symbology };
}

/** Renders the barcode only — no `<text>` node. The human-readable serial (G2.4)
 * is composed alongside it by the caller (route JSON, then client layout), not
 * baked into this SVG, so label styling never has to reach into bwip-js's own text
 * rendering, and the serial shown is always exactly the stored serial, never
 * whatever bwip-js chooses to echo from the encoded URL.
 */
/**
 * bwip-js's SVG has a `viewBox` but no `width`/`height` attributes, which leaves a
 * browser with no intrinsic size to fall back on — some collapse it to zero height
 * (invisible) rather than rendering it at the viewBox's own dimensions. Stamping
 * explicit physical `width`/`height` (in mm, derived from bwip-js's fixed 72dpi
 * output — 1 point = 25.4/72 mm) fixes that AND makes the artifact self-describing:
 * printing it at 100% scale reproduces the exact module size and quiet zone chosen
 * in SYMBOLOGY_SPECS, not whatever size the browser happened to guess.
 */
function addPhysicalDimensions(svg) {
  const match = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  if (!match) return svg;
  const mmPerPoint = 25.4 / 72;
  const widthMm = (parseFloat(match[1]) * mmPerPoint).toFixed(2);
  const heightMm = (parseFloat(match[2]) * mmPerPoint).toFixed(2);
  return svg.replace('<svg ', `<svg width="${widthMm}mm" height="${heightMm}mm" `);
}

function renderSvg(symbology, text) {
  const spec = SYMBOLOGY_SPECS[symbology];
  const svg = bwipjs.toSVG({
    bcid: spec.bcid,
    text,
    scale: spec.scale,
    paddingwidth: spec.paddingwidth,
    paddingheight: spec.paddingheight,
    includetext: false,
  });
  return addPhysicalDimensions(svg);
}

/**
 * Generates one asset's label: the symbology used (an explicit override, else the
 * asset's type's configured default), the encoded URL, the SVG markup, and the
 * serial to print alongside it (G2.4). Throws 400 if the asset has no serial —
 * there is nothing to encode.
 */
export async function generateAssetLabel(db, assetId, { symbology } = {}) {
  const asset = await getAsset(db, assetId); // 404s if the asset doesn't exist
  if (!asset.serial_number) {
    throw httpError('Asset has no serial number — nothing to encode on a label', 400);
  }
  const effectiveSymbology = symbology || await getDefaultSymbology(db, asset.asset_type_id);
  assertValidSymbology(effectiveSymbology);
  const url = buildLabelUrl(asset.serial_number);
  const svg = renderSvg(effectiveSymbology, url);
  return {
    asset_id: asset.id,
    serial_number: asset.serial_number,
    asset_type_name: asset.asset_type_name,
    symbology: effectiveSymbology,
    url,
    svg,
  };
}

/**
 * Batch form for a print sheet (G2.4's "printable sheet of multiple labels").
 * Per-asset failures (no serial, unknown id) are collected in `errors` rather than
 * failing the whole sheet, so one bad row doesn't block printing the rest.
 * `symbology`, if given, forces every label in the sheet to one symbology; if
 * omitted, each asset uses its own type's configured default.
 */
export async function generateAssetLabels(db, assetIds, { symbology } = {}) {
  const labels = [];
  const errors = [];
  for (const assetId of assetIds) {
    try {
      labels.push(await generateAssetLabel(db, assetId, { symbology }));
    } catch (err) {
      if (!err.status) throw err;
      errors.push({ asset_id: Number(assetId), error: err.message });
    }
  }
  return { labels, errors };
}
