// Gear's typed API module, layered over the shared core/httpClient. This is the module
// Phase 6 introduces; other modules still use the untyped core/api.js (§6.1 / convergence
// task 7 — the rest of the client converts later).
import { apiRequest, type ApiResult } from '../../core/httpClient';
import type {
  Asset, AssetType, LifecycleState, AssetEvent, AssetInput, AssetLink, AssetLinkInput,
  AssetModel, MaintenanceOrder, MaintenanceOrderInput, ComponentInstallation, ComponentInstallationInput,
  AssetLabel, LabelBatchResult, LabelSymbology, AssetTypeLabelSetting, PhotoScanInput, PhotoScanResult,
} from './types';

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

  getAssetModels: (): Promise<ApiResult<AssetModel[]>> => apiRequest('/gear/asset-models'),

  // An asset's service history (G6.1), newest first.
  getMaintenanceOrdersForAsset: (assetId: number): Promise<ApiResult<MaintenanceOrder[]>> =>
    apiRequest(`/gear/assets/${assetId}/maintenance-orders`),

  // Opens a work order. Rejected (400) if the asset's type is not L3/supports_maintenance.
  createMaintenanceOrder: (data: MaintenanceOrderInput): Promise<ApiResult<MaintenanceOrder>> =>
    apiRequest('/gear/maintenance-orders', { method: 'POST', body: JSON.stringify(data) }),

  updateMaintenanceOrder: (
    id: number,
    data: { status?: MaintenanceOrder['status']; description?: string }
  ): Promise<ApiResult<MaintenanceOrder>> =>
    apiRequest(`/gear/maintenance-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Components a given asset has hosted (G6.3), current and past.
  getComponentInstallationsForAsset: (assetId: number): Promise<ApiResult<ComponentInstallation[]>> =>
    apiRequest(`/gear/assets/${assetId}/component-installations`),

  // Every installation of one model, across every asset it has ever been on — the
  // "which design lasts longest" comparison.
  getComponentInstallationsForModel: (modelId: number): Promise<ApiResult<ComponentInstallation[]>> =>
    apiRequest(`/gear/asset-models/${modelId}/component-installations`),

  createComponentInstallation: (data: ComponentInstallationInput): Promise<ApiResult<ComponentInstallation>> =>
    apiRequest('/gear/component-installations', { method: 'POST', body: JSON.stringify(data) }),

  removeComponentInstallation: (
    id: number,
    data: { removed_at_hours: number; condition_on_removal?: string }
  ): Promise<ApiResult<ComponentInstallation>> =>
    apiRequest(`/gear/component-installations/${id}/remove`, { method: 'PATCH', body: JSON.stringify(data) }),

  // One asset's label (Phase 7, G2.4). symbology, if given, overrides the asset
  // type's configured default — a battery label may go either way depending on
  // available flat area.
  getAssetLabel: (assetId: number, symbology?: LabelSymbology): Promise<ApiResult<AssetLabel>> =>
    apiRequest(`/gear/labels/${assetId}${symbology ? `?symbology=${symbology}` : ''}`),

  // A batch of labels for a print sheet. Per-asset failures (no serial, unknown id)
  // come back in `errors` rather than failing the whole sheet.
  getAssetLabels: (assetIds: number[], symbology?: LabelSymbology): Promise<ApiResult<LabelBatchResult>> =>
    apiRequest(`/gear/labels?ids=${assetIds.join(',')}${symbology ? `&symbology=${symbology}` : ''}`),

  getLabelSetting: (assetTypeId: number): Promise<ApiResult<AssetTypeLabelSetting>> =>
    apiRequest(`/gear/asset-types/${assetTypeId}/label-setting`),

  setLabelSetting: (assetTypeId: number, default_symbology: LabelSymbology): Promise<ApiResult<AssetTypeLabelSetting>> =>
    apiRequest(`/gear/asset-types/${assetTypeId}/label-setting`, {
      method: 'PUT',
      body: JSON.stringify({ default_symbology }),
    }),

  // Photograph-and-resolve-later (Phase 11, G4.3). 200 with duplicate:true if
  // client_key had already been submitted — a no-op, not a failure.
  resolvePhotoScan: (data: PhotoScanInput): Promise<ApiResult<PhotoScanResult>> =>
    apiRequest('/gear/photo-scans', { method: 'POST', body: JSON.stringify(data) }),
};
