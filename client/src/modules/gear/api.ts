// Gear's typed API module, layered over the shared core/httpClient. This is the module
// Phase 6 introduces; other modules still use the untyped core/api.js (§6.1 / convergence
// task 7 — the rest of the client converts later).
import { apiRequest, type ApiResult } from '../../core/httpClient';
import type { Asset, AssetType, LifecycleState, AssetEvent, AssetInput, AssetLink, AssetLinkInput } from './types';

export const gearApi = {
  getAssets: (): Promise<ApiResult<Asset[]>> => apiRequest('/gear/assets'),

  getAsset: (id: number): Promise<ApiResult<Asset>> => apiRequest(`/gear/assets/${id}`),

  createAsset: (data: AssetInput): Promise<ApiResult<Asset>> =>
    apiRequest('/gear/assets', { method: 'POST', body: JSON.stringify(data) }),

  updateAsset: (id: number, data: AssetInput): Promise<ApiResult<Asset>> =>
    apiRequest(`/gear/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteAsset: (id: number): Promise<ApiResult<null>> =>
    apiRequest(`/gear/assets/${id}`, { method: 'DELETE' }),

  // Read-only history, newest first (G3.2) — there is no corresponding write call.
  getAssetEvents: (id: number): Promise<ApiResult<AssetEvent[]>> => apiRequest(`/gear/assets/${id}/events`),

  // Resolve a scanned label (G2.2). Server normalizes case/whitespace, so the raw
  // route param is passed through untouched — only URL-encoded for the path segment.
  getAssetBySerial: (serial: string): Promise<ApiResult<Asset>> =>
    apiRequest(`/gear/assets/by-serial/${encodeURIComponent(serial)}`),

  getAssetTypes: (): Promise<ApiResult<AssetType[]>> => apiRequest('/gear/asset-types'),

  getLifecycleStates: (): Promise<ApiResult<LifecycleState[]>> => apiRequest('/gear/lifecycle-states'),

  // Scan-to-locate (G3.3). Reuses the general PUT — sending only location_id leaves
  // every other field at its current value (see updateAsset() in assetService.js) — so
  // this writes exactly the one `moved` event, nothing else.
  moveAsset: (id: number, location_id: number): Promise<ApiResult<Asset>> =>
    apiRequest(`/gear/assets/${id}`, { method: 'PUT', body: JSON.stringify({ location_id }) }),

  // One asset's link history (G5.1), both as parent and as child.
  getAssetLinks: (id: number, asOf?: string): Promise<ApiResult<AssetLink[]>> =>
    apiRequest(`/gear/assets/${id}/links${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''}`),

  // Two-scan linking (G5.2). 409s if the child already has an open link.
  createLink: (data: AssetLinkInput): Promise<ApiResult<AssetLink>> =>
    apiRequest('/gear/asset-links', { method: 'POST', body: JSON.stringify(data) }),

  closeLink: (id: number): Promise<ApiResult<AssetLink>> =>
    apiRequest(`/gear/asset-links/${id}/close`, { method: 'PATCH', body: JSON.stringify({}) }),
};
