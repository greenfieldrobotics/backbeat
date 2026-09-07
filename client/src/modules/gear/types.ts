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
