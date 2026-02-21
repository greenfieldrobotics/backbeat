import { useState, useEffect } from 'react';
import { api } from '../api';

const EMPTY_PART = { part_number: '', description: '', unit_of_measure: 'EA', classification: '', cost: '', mfg_part_number: '', manufacturer: '', reseller: '', reseller_part_number: '', notes: '' };

export default function PartsPage() {
  const [parts, setParts] = useState([]);
  const [classifications, setClassifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_PART);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');

  const load = () => {
    const params = {};
    if (search) params.search = search;
    if (filterClass) params.classification = filterClass;
    const qs = new URLSearchParams(params).toString();
    return fetch(`/api/parts${qs ? '?' + qs : ''}`).then(r => r.json()).then(setParts).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetch('/api/parts/classifications').then(r => r.json()).then(setClassifications);
  }, []);

  useEffect(() => { load(); }, [search, filterClass]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_PART);
    setError('');
    setShowModal(true);
  };

  const openEdit = (part) => {
    setEditing(part);
    setForm({
      part_number: part.part_number,
      description: part.description || '',
      unit_of_measure: part.unit_of_measure,
      classification: part.classification || '',
      cost: part.cost ?? '',
      mfg_part_number: part.mfg_part_number || '',
      manufacturer: part.manufacturer || '',
      reseller: part.reseller || '',
      reseller_part_number: part.reseller_part_number || '',
      notes: part.notes || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setError('');
    try {
      const data = { ...form, cost: form.cost ? parseFloat(form.cost) : null };
      if (editing) {
        await api.updatePart(editing.id, data);
      } else {
        await api.createPart(data);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (part) => {
    if (!confirm(`Delete ${part.part_number}?`)) return;
    try { await api.deletePart(part.id); load(); }
    catch (err) { alert(err.message); }
  };

  const fmt = (val) => val != null ? `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-';

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Parts Catalog ({parts.length})</h1>
        <button className="btn-primary" onClick={openCreate}>Add Part</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          placeholder="Search parts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: '0.9rem', width: 300 }}
        />
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: '0.9rem' }}>
          <option value="">All Classifications</option>
          {classifications.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <table>
        <thead>
          <tr>
            <th>Part Number</th>
            <th>Description</th>
            <th>Classification</th>
            <th>Cost</th>
            <th>Manufacturer</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {parts.length === 0 ? (
            <tr><td colSpan="6" className="empty-state">No parts found</td></tr>
          ) : parts.map(p => (
            <tr key={p.id}>
              <td><strong>{p.part_number}</strong></td>
              <td>{p.description}</td>
              <td>{p.classification}</td>
              <td>{fmt(p.cost)}</td>
              <td>{p.manufacturer || '-'}</td>
              <td>
                <button className="btn-secondary btn-sm" onClick={() => openEdit(p)}>Edit</button>{' '}
                <button className="btn-danger btn-sm" onClick={() => handleDelete(p)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 600 }}>
            <h2>{editing ? 'Edit Part' : 'New Part'}</h2>
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label>Part Number</label>
                <input value={form.part_number} onChange={e => setForm({...form, part_number: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Classification</label>
                <input value={form.classification} onChange={e => setForm({...form, classification: e.target.value})} list="class-list" />
                <datalist id="class-list">
                  {classifications.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Description</label>
                <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Unit of Measure</label>
                <input value={form.unit_of_measure} onChange={e => setForm({...form, unit_of_measure: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Cost</label>
                <input type="number" step="0.01" value={form.cost} onChange={e => setForm({...form, cost: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Manufacturer</label>
                <input value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Mfg Part Number</label>
                <input value={form.mfg_part_number} onChange={e => setForm({...form, mfg_part_number: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Reseller</label>
                <input value={form.reseller} onChange={e => setForm({...form, reseller: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Reseller Part Number</label>
                <input value={form.reseller_part_number} onChange={e => setForm({...form, reseller_part_number: e.target.value})} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Notes</label>
                <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
              </div>
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
