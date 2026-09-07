import { useState, useEffect } from 'react';
import { api } from '../api';

const EMPTY = { name: '', type: 'Warehouse' };

export default function LocationsPage() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const load = () => api.getLocations().then(setLocations).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setError(''); setShowModal(true); };
  const openEdit = (loc) => { setEditing(loc); setForm({ name: loc.name, type: loc.type }); setError(''); setShowModal(true); };

  const handleSave = async () => {
    setError('');
    try {
      if (editing) await api.updateLocation(editing.id, form);
      else await api.createLocation(form);
      setShowModal(false);
      load();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (loc) => {
    if (!confirm(`Delete ${loc.name}?`)) return;
    try { await api.deleteLocation(loc.id); load(); }
    catch (err) { alert(err.message); }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Locations</h1>
        <button className="btn-primary" onClick={openCreate}>Add Location</button>
      </div>

      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {locations.map(l => (
            <tr key={l.id}>
              <td><strong>{l.name}</strong></td>
              <td>{l.type}</td>
              <td>
                <button className="btn-secondary btn-sm" onClick={() => openEdit(l)}>Edit</button>{' '}
                <button className="btn-danger btn-sm" onClick={() => handleDelete(l)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Edit Location' : 'New Location'}</h2>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                <option>Warehouse</option>
                <option>Regional Site</option>
                <option>Contract Manufacturer</option>
              </select>
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
