import { useState, useEffect } from 'react';
import { api } from '../api';
import PartSearch from '../components/PartSearch';

export default function ReturnPage() {
  const [parts, setParts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ part_id: '', location_id: '', quantity: '', unit_cost: '', reason: '', reference: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getParts(), api.getLocations()])
      .then(([p, l]) => { setParts(p); setLocations(l); })
      .finally(() => setLoading(false));
  }, []);

  const handleReturn = async () => {
    setError('');
    setResult(null);
    try {
      const res = await api.returnParts({
        part_id: parseInt(form.part_id),
        location_id: parseInt(form.location_id),
        quantity: parseInt(form.quantity),
        unit_cost: parseFloat(form.unit_cost),
        reason: form.reason || undefined,
        reference: form.reference || undefined,
      });
      setResult(res);
      setForm({ part_id: '', location_id: '', quantity: '', unit_cost: '', reason: '', reference: '' });
    } catch (err) { setError(err.message); }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Return Parts</h1>
      </div>

      {result && (
        <div className="alert alert-success">
          Returned {result.quantity_returned} x {result.part_number} to {result.location} @ ${result.unit_cost.toFixed(2)}/ea.
          Total cost: ${result.total_cost.toFixed(2)}.
          {result.reason ? ` Reason: ${result.reason}.` : ''}
          New FIFO layer #{result.fifo_layer_created.id} created (source: {result.fifo_layer_created.source_type}).
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="form-group">
          <label>Part</label>
          <PartSearch
            parts={parts}
            value={form.part_id}
            onSelect={p => setForm({ ...form, part_id: String(p.id || '') })}
          />
        </div>

        <div className="form-group">
          <label>Location</label>
          <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}>
            <option value="">Select location...</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        {form.part_id && form.location_id && (
          <>
            <div className="form-group">
              <label>Quantity</label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })}
                placeholder="Quantity to return"
              />
            </div>
            <div className="form-group">
              <label>Unit Cost ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.unit_cost}
                onChange={e => setForm({ ...form, unit_cost: e.target.value })}
                placeholder="Cost per unit"
              />
            </div>
            <div className="form-group">
              <label>Reason (optional)</label>
              <input
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                placeholder="e.g., unused, wrong part issued"
              />
            </div>
            <div className="form-group">
              <label>Reference (optional)</label>
              <input
                value={form.reference}
                onChange={e => setForm({ ...form, reference: e.target.value })}
                placeholder="e.g., original issue to Bot #42"
              />
            </div>
            <button
              className="btn-primary"
              onClick={handleReturn}
              disabled={!form.quantity || parseInt(form.quantity) <= 0 || !form.unit_cost}
            >
              Return Parts
            </button>
          </>
        )}
      </div>
    </div>
  );
}
