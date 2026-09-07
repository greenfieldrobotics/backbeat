export interface Asset {
  id: number;
  serial_number: string | null;
  asset_type_id: number | null;
  asset_type_name: string | null;
  lifecycle_state_id: number | null;
  lifecycle_state_name: string | null;
  location_id: number | null;
  location_name: string | null;
  owner_party_name: string | null;
  custodian_party_name: string | null;
  notes: string | null;
}

export interface AssetType {
  id: number;
  name: string;
}

export interface LifecycleState {
  id: number;
  name: string;
}

export interface AssetEvent {
  id: number;
  event_type: string;
  occurred_at: string;
  from_value: string | null;
  to_value: string | null;
  location_name: string | null;
  notes: string | null;
}

export interface AssetInput {
  serial_number: string;
  asset_type_id: number | string | null;
  lifecycle_state_id: number | string | null;
  location_id: number | string | null;
  notes: string;
}

// A dated parent/child edge (G5.1) — battery-in-robot, robot-on-trailer,
// RTK-base-serving-field all use this same shape, distinguished only by link_type.
export interface AssetLink {
  id: number;
  parent_asset_id: number;
  parent_serial_number: string | null;
  parent_asset_type_name: string;
  child_asset_id: number;
  child_serial_number: string | null;
  child_asset_type_name: string;
  link_type: string;
  valid_from: string;
  valid_to: string | null;
  notes: string | null;
}

export interface AssetLinkInput {
  parent_asset_id: number;
  child_asset_id: number;
  link_type: string;
  notes?: string;
}

export interface AssetModel {
  id: number;
  asset_type_id: number;
  manufacturer: string;
  model_name: string;
}

// A work order against an asset (G6.1) — open/in_progress/closed, with a service
// history per asset. Deliberately carries no field for parts consumed anywhere:
// that is G6.2, deferred (requirements §7.8), not built here.
export interface MaintenanceOrder {
  id: number;
  asset_id: number;
  status: 'open' | 'in_progress' | 'closed';
  description: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface MaintenanceOrderInput {
  asset_id: number;
  description?: string;
}

// Component wear by model (G6.3) — this model installed on an asset at hour Y,
// removed at hour Z, condition on removal. References an asset_model, never an
// asset of its own: installing a component creates no asset row (§5.6).
export interface ComponentInstallation {
  id: number;
  asset_model_id: number;
  model_manufacturer: string;
  model_model_name: string;
  installed_on_asset_id: number;
  installed_on_serial_number: string | null;
  installed_at_hours: number;
  removed_at_hours: number | null;
  condition_on_removal: string | null;
  notes: string | null;
}

export interface ComponentInstallationInput {
  asset_model_id: number;
  installed_on_asset_id: number;
  installed_at_hours: number;
  notes?: string;
}

// Label generation (Phase 7, G2.4). symbology is data-driven per asset type
// (asset_type_label_settings), never a hardcoded client-side switch — this type is
// just the two values the server currently supports.
export type LabelSymbology = 'qr' | 'datamatrix';

// The barcode SVG is rendered entirely server-side (bwip-js, self-hosted — see
// labelService.js) and carries no human-readable text node; the client displays
// serial_number alongside it separately (G2.4's "always printed alongside" rule).
export interface AssetLabel {
  asset_id: number;
  serial_number: string;
  asset_type_name: string | null;
  symbology: LabelSymbology;
  url: string;
  svg: string;
}

export interface LabelBatchResult {
  labels: AssetLabel[];
  errors: { asset_id: number; error: string }[];
}

export interface AssetTypeLabelSetting {
  asset_type_id: number;
  default_symbology: LabelSymbology;
}

// Photograph-and-resolve-later (Phase 11, G4.3). occurred_at is when the photo was
// taken (EXIF, or entered by the user) — omit it to fall back to upload time, the
// last resort (§7.1). client_key is the idempotency key: a second submission with the
// same key is a no-op, not a duplicate event. Both are resolved client-side before
// this is sent — see photoResolve.ts.
export interface PhotoScanInput {
  serial: string;
  occurred_at?: string | null;
  client_key?: string | null;
  notes?: string;
}

export interface PhotoScanResult {
  asset: Asset;
  event: AssetEvent;
  /** true if this client_key had already been submitted — no new event was written. */
  duplicate: boolean;
}
