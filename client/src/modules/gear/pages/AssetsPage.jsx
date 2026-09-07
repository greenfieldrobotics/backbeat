import { useState, useEffect } from 'react';
import { api } from '../../../core/api';

const EMPTY = { serial_number: '', asset_type_id: '', lifecycle_state_id: '', location_id: '', notes: '' };

export default function AssetsPage() {
  const [assets, setAssets] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [lifecycleStates, setLifecycleStates] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const load = () => api.getAssets().then(setAssets).finally(() => setLoading(false));
  useEffect(() => {
    load();
    api.getAssetTypes().then(setAssetTypes);
    api.getLifecycleStates().then(setLifecycleStates);
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
  const openEdit = (a) => {
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
    const payload = {
      ...form,
      location_id: form.location_id || null,
      asset_type_id: form.asset_type_id || null,
      lifecycle_state_id: form.lifecycle_state_id || null,
    };
    try {
      if (editing) await api.updateAsset(editing.id, payload);
      else await api.createAsset(payload);
      setShowModal(false);
      load();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (a) => {
    if (!confirm(`Delete asset ${a.serial_number || `#${a.id}`}?`)) return;
    try { await api.deleteAsset(a.id); load(); }
    catch (err) { alert(err.message); }
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
                <button className="btn-danger btn-sm" onClick={() => handleDelete(a)}>Delete</button>
              </td>
            </tr>
          ))}
          {assets.length === 0 && (
            <tr><td colSpan="5" style={{ textAlign: 'center', color: '#888' }}>No assets yet.</td></tr>
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
              <input value={form.serial_number} onChange={e => setForm({...form, serial_number: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Asset Type</label>
              <select value={form.asset_type_id} onChange={e => setForm({...form, asset_type_id: e.target.value})}>
                <option value="">— Select —</option>
                {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={form.lifecycle_state_id} onChange={e => setForm({...form, lifecycle_state_id: e.target.value})}>
                <option value="">— Select —</option>
                {lifecycleStates.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Location</label>
              <select value={form.location_id} onChange={e => setForm({...form, location_id: e.target.value})}>
                <option value="">— Unassigned —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
