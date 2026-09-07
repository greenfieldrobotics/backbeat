import { useState, useEffect } from 'react';
import { api } from '../../../core/api';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Asset, AssetType, LifecycleState, AssetEvent, AssetInput } from '../types';

interface Location {
  id: number;
  name: string;
}

const EMPTY: AssetInput = { serial_number: '', asset_type_id: '', lifecycle_state_id: '', location_id: '', notes: '' };

function AssetsPageContent() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [lifecycleStates, setLifecycleStates] = useState<LifecycleState[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<AssetInput>(EMPTY);
  const [error, setError] = useState('');
  const [historyAsset, setHistoryAsset] = useState<Asset | null>(null);
  const [historyEvents, setHistoryEvents] = useState<AssetEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    const result = await gearApi.getAssets();
    if (!isApiFailure(result)) setAssets(result.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    gearApi.getAssetTypes().then(r => { if (!isApiFailure(r)) setAssetTypes(r.data); });
    gearApi.getLifecycleStates().then(r => { if (!isApiFailure(r)) setLifecycleStates(r.data); });
    // Locations come from the shared/core module — Gear reuses them, doesn't redefine them.
    api.getLocations().then(setLocations);
  }, []);

  // Registration only strictly requires asset_type_id and lifecycle_state_id (§2.3), but a
  // freshly opened create form defaults lifecycle state to 'Available' so the common case —
  // register and leave the state alone — behaves the way it did before states were data.
  const openCreate = () => {
    setEditing(null);
    const available = lifecycleStates.find(s => s.name === 'Available');
    setForm({ ...EMPTY, lifecycle_state_id: available ? String(available.id) : '' });
    setError('');
    setShowModal(true);
  };
  const openEdit = (a: Asset) => {
    setEditing(a);
    setForm({
      serial_number: a.serial_number || '',
      asset_type_id: a.asset_type_id || '',
      lifecycle_state_id: a.lifecycle_state_id || '',
      location_id: a.location_id || '',
      notes: a.notes || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setError('');
    const payload: AssetInput = {
      ...form,
      location_id: form.location_id || null,
      asset_type_id: form.asset_type_id || null,
      lifecycle_state_id: form.lifecycle_state_id || null,
    };
    const result = editing ? await gearApi.updateAsset(editing.id, payload) : await gearApi.createAsset(payload);
    if (isApiFailure(result)) {
      setError(result.error);
      return;
    }
    setShowModal(false);
    load();
  };

  const handleDelete = async (a: Asset) => {
    if (!confirm(`Delete asset ${a.serial_number || `#${a.id}`}?`)) return;
    const result = await gearApi.deleteAsset(a.id);
    if (isApiFailure(result)) {
      alert(result.error);
      return;
    }
    load();
  };

  const openHistory = async (a: Asset) => {
    setHistoryAsset(a);
    setHistoryLoading(true);
    const result = await gearApi.getAssetEvents(a.id);
    if (!isApiFailure(result)) setHistoryEvents(result.data);
    setHistoryLoading(false);
  };

  // A one-line human description of what an event recorded — the raw row is mostly
  // ids, and from_value/to_value only apply to some event types (§6.5 item 2).
  const describeEvent = (e: AssetEvent) => {
    switch (e.event_type) {
      case 'registered': return `Registered${e.location_name ? ` at ${e.location_name}` : ''}`;
      case 'state_changed': return `${e.from_value ?? '—'} → ${e.to_value ?? '—'}`;
      case 'moved': return `Moved to ${e.location_name ?? '—'}`;
      case 'custody_changed': return `${e.from_value ?? 'Nobody'} → ${e.to_value ?? 'Nobody'}`;
      case 'note': return e.notes ?? '';
      default: return e.event_type;
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Assets</h1>
        <button className="btn-primary" onClick={openCreate}>Add Asset</button>
      </div>

      <table>
        <thead>
          <tr><th>Serial</th><th>Type</th><th>Status</th><th>Location</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {assets.map(a => (
            <tr key={a.id}>
              <td><strong>{a.serial_number || '—'}</strong></td>
              <td>{a.asset_type_name}</td>
              <td>{a.lifecycle_state_name}</td>
              <td>{a.location_name || '—'}</td>
              <td>
                <button className="btn-secondary btn-sm" onClick={() => openEdit(a)}>Edit</button>{' '}
                <button className="btn-secondary btn-sm" onClick={() => openHistory(a)}>History</button>{' '}
                <button className="btn-danger btn-sm" onClick={() => handleDelete(a)}>Delete</button>
              </td>
            </tr>
          ))}
          {assets.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>No assets yet.</td></tr>
          )}
        </tbody>
      </table>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Edit Asset' : 'New Asset'}</h2>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Serial Number</label>
              <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Asset Type</label>
              <select value={form.asset_type_id ?? ''} onChange={e => setForm({ ...form, asset_type_id: e.target.value })}>
                <option value="">— Select —</option>
                {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={form.lifecycle_state_id ?? ''} onChange={e => setForm({ ...form, lifecycle_state_id: e.target.value })}>
                <option value="">— Select —</option>
                {lifecycleStates.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Location</label>
              <select value={form.location_id ?? ''} onChange={e => setForm({ ...form, location_id: e.target.value })}>
                <option value="">— Unassigned —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      {historyAsset && (
        <div className="modal-overlay" onClick={() => setHistoryAsset(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>History — {historyAsset.serial_number || `Asset #${historyAsset.id}`}</h2>
            {historyLoading ? <div>Loading...</div> : (
              <table>
                <thead>
                  <tr><th>When</th><th>Event</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {historyEvents.map(e => (
                    <tr key={e.id}>
                      <td>{new Date(e.occurred_at).toLocaleString()}</td>
                      <td>{e.event_type}</td>
                      <td>{describeEvent(e)}</td>
                    </tr>
                  ))}
                  {historyEvents.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: '#888' }}>No history yet.</td></tr>
                  )}
                </tbody>
              </table>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setHistoryAsset(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssetsPage() {
  return (
    <ErrorBoundary>
      <AssetsPageContent />
    </ErrorBoundary>
  );
}
