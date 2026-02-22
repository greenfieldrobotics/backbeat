import { useState, useEffect } from 'react';
import { api } from '../api';
import PartSearch from '../components/PartSearch';

const ISSUE_REASONS = ['Repair', 'New Robot', 'R&D', 'Enhance', 'Other'];

export default function IssuePage() {
  const [inventory, setInventory] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ part_id: '', location_id: '', quantity: '', reason: '', target_ref: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getInventory(), api.getLocations()])
      .then(([inv, locs]) => { setInventory(inv); setLocations(locs); })
      .finally(() => setLoading(false));
  }, []);

  // Get available qty for selected part+location
  const available = inventory.find(
    i => i.part_id === parseInt(form.part_id) && i.location_id === parseInt(form.location_id)
  )?.quantity_on_hand || 0;

  // Unique parts that have inventory
  const partsWithStock = [...new Map(inventory.map(i => [i.part_id, { id: i.part_id, part_number: i.part_number, description: i.part_description }])).values()];

  // Locations with stock for selected part
  const locationsForPart = form.part_id
    ? inventory.filter(i => i.part_id === parseInt(form.part_id)).map(i => ({ id: i.location_id, name: i.location_name, qty: i.quantity_on_hand }))
    : [];

  const handleIssue = async () => {
    setError('');
    setResult(null);
    try {
      const res = await api.issueParts({
        part_id: parseInt(form.part_id),
        location_id: parseInt(form.location_id),
        quantity: parseInt(form.quantity),
        reason: form.reason || undefined,
        target_ref: form.target_ref || undefined,
      });
      setResult(res);
      setForm({ part_id: '', location_id: '', quantity: '', reason: '', target_ref: '' });
      // Refresh inventory
      const inv = await api.getInventory();
      setInventory(inv);
    } catch (err) { setError(err.message); }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Issue Parts</h1>
      </div>

      {result && (
        <div className="alert alert-success">
          Issued {result.quantity_issued} x {result.part_number} from {result.location}
          {result.target_ref ? ` to ${result.target_ref}` : ''}.
          Total cost: ${result.total_cost.toFixed(2)} (avg ${result.average_unit_cost.toFixed(2)}/ea).
          FIFO layers consumed: {result.fifo_layers_consumed.length}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="form-group">
          <label>Part</label>
          <PartSearch
            parts={partsWithStock}
            value={form.part_id}
            onSelect={p => setForm({ ...form, part_id: String(p.id || ''), location_id: '', quantity: '' })}
          />
        </div>

        {form.part_id && (
          <div className="form-group">
            <label>Location</label>
            <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}>
              <option value="">Select location...</option>
              {locationsForPart.map(l => (
                <option key={l.id} value={l.id}>{l.name} (Qty: {l.qty})</option>
              ))}
            </select>
          </div>
        )}

        {form.location_id && (
          <>
            <div className="form-group">
              <label>Quantity (available: {available})</label>
              <input
                type="number"
                min="1"
                max={available}
                value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Issue To (bot/vehicle ID, person, or general)</label>
              <input
                value={form.target_ref}
                onChange={e => setForm({ ...form, target_ref: e.target.value })}
                placeholder="e.g., Bot #42, John Smith, Field Truck 3"
              />
            </div>
            <div className="form-group">
              <label>Reason</label>
              <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                <option value="">Select reason...</option>
                {ISSUE_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <button className="btn-primary" onClick={handleIssue} disabled={!form.quantity || parseInt(form.quantity) <= 0}>
              Issue Parts
            </button>
          </>
        )}
      </div>

      {result && result.fifo_layers_consumed.length > 0 && (
        <div className="card">
          <h3>FIFO Layers Consumed</h3>
          <table>
            <thead>
              <tr><th>Layer ID</th><th>Source</th><th>Qty Consumed</th><th>Unit Cost</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {result.fifo_layers_consumed.map((l, i) => (
                <tr key={i}>
                  <td>{l.layer_id}</td>
                  <td>{l.source_ref}</td>
                  <td>{l.quantity_consumed}</td>
                  <td>${l.unit_cost.toFixed(2)}</td>
                  <td>${l.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
