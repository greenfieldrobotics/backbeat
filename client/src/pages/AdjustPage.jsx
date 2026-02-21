import { useState, useEffect } from 'react';
import { api } from '../api';

const ADJUST_REASONS = ['Physical count', 'Cycle count correction', 'Receiving correction', 'Other'];

export default function AdjustPage() {
  const [parts, setParts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ part_id: '', location_id: '', new_quantity: '', unit_cost: '', reason: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getParts(), api.getLocations(), api.getInventory()])
      .then(([p, l, inv]) => { setParts(p); setLocations(l); setInventory(inv); })
      .finally(() => setLoading(false));
  }, []);

  // Current system quantity for selected part+location
  const currentQty = inventory.find(
    i => i.part_id === parseInt(form.part_id) && i.location_id === parseInt(form.location_id)
  )?.quantity_on_hand || 0;

  // Calculate delta
  const newQty = form.new_quantity !== '' ? parseInt(form.new_quantity) : null;
  const delta = newQty !== null ? newQty - currentQty : null;

  const handleAdjust = async () => {
    setError('');
    setResult(null);
    try {
      const data = {
        part_id: parseInt(form.part_id),
        location_id: parseInt(form.location_id),
        new_quantity: parseInt(form.new_quantity),
        reason: form.reason,
      };
      if (delta > 0 && form.unit_cost) {
        data.unit_cost = parseFloat(form.unit_cost);
      }
      const res = await api.adjustInventory(data);
      setResult(res);
      setForm({ part_id: '', location_id: '', new_quantity: '', unit_cost: '', reason: '' });
      // Refresh inventory
      const inv = await api.getInventory();
      setInventory(inv);
    } catch (err) { setError(err.message); }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Adjust Inventory</h1>
      </div>

      {result && (
        <div className="alert alert-success">
          {result.delta === 0
            ? `No adjustment needed for ${result.part_number} at ${result.location}. System quantity matches.`
            : `Adjusted ${result.part_number} at ${result.location}: ${result.before_quantity} → ${result.after_quantity} (${result.delta > 0 ? '+' : ''}${result.delta}). Cost impact: $${result.total_cost.toFixed(2)}.`
          }
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="form-group">
          <label>Part</label>
          <select value={form.part_id} onChange={e => setForm({ ...form, part_id: e.target.value, location_id: '', new_quantity: '', unit_cost: '' })}>
            <option value="">Select part...</option>
            {parts.map(p => (
              <option key={p.id} value={p.id}>{p.part_number} - {p.description}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Location</label>
          <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value, new_quantity: '', unit_cost: '' })}>
            <option value="">Select location...</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        {form.part_id && form.location_id && (
          <>
            <div className="form-group">
              <label>Current System Quantity: <strong>{currentQty}</strong></label>
            </div>
            <div className="form-group">
              <label>New Quantity (actual count)</label>
              <input
                type="number"
                min="0"
                value={form.new_quantity}
                onChange={e => setForm({ ...form, new_quantity: e.target.value })}
                placeholder="Enter physical count"
              />
            </div>

            {delta !== null && (
              <div className="form-group">
                <label>
                  Delta: <strong style={{ color: delta > 0 ? 'green' : delta < 0 ? 'red' : 'inherit' }}>
                    {delta > 0 ? '+' : ''}{delta}
                  </strong>
                  {delta > 0 && ' (overage — new FIFO layer will be created)'}
                  {delta < 0 && ' (shortage — FIFO layers will be consumed)'}
                  {delta === 0 && ' (no change)'}
                </label>
              </div>
            )}

            {delta !== null && delta > 0 && (
              <div className="form-group">
                <label>Unit Cost (optional — defaults to most recent layer cost)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unit_cost}
                  onChange={e => setForm({ ...form, unit_cost: e.target.value })}
                  placeholder="Cost per unit for new layer"
                />
              </div>
            )}

            <div className="form-group">
              <label>Reason (required)</label>
              <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                <option value="">Select reason...</option>
                {ADJUST_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <button
              className={delta !== null && delta < 0 ? 'btn-danger' : 'btn-primary'}
              onClick={handleAdjust}
              disabled={form.new_quantity === '' || !form.reason}
            >
              Adjust Inventory
            </button>
          </>
        )}
      </div>

      {result && result.fifo_layers_consumed && result.fifo_layers_consumed.length > 0 && (
        <div className="card">
          <h3>FIFO Layers Consumed</h3>
          <table>
            <thead>
              <tr><th>Layer ID</th><th>Qty Consumed</th><th>Unit Cost</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {result.fifo_layers_consumed.map((l, i) => (
                <tr key={i}>
                  <td>{l.layer_id}</td>
                  <td>{l.quantity_consumed}</td>
                  <td>${l.unit_cost.toFixed(2)}</td>
                  <td>${l.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && result.fifo_layer_created && (
        <div className="card">
          <h3>New FIFO Layer Created</h3>
          <table>
            <thead>
              <tr><th>Layer ID</th><th>Source Type</th><th>Quantity</th><th>Unit Cost</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>{result.fifo_layer_created.id}</td>
                <td>{result.fifo_layer_created.source_type}</td>
                <td>{result.fifo_layer_created.original_qty}</td>
                <td>${result.fifo_layer_created.unit_cost.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
