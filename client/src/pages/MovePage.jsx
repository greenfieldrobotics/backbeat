import { useState, useEffect } from 'react';
import { api } from '../api';

export default function MovePage() {
  const [inventory, setInventory] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ part_id: '', from_location_id: '', to_location_id: '', quantity: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getInventory(), api.getLocations()])
      .then(([inv, locs]) => { setInventory(inv); setLocations(locs); })
      .finally(() => setLoading(false));
  }, []);

  // Available qty for selected part + source location
  const available = inventory.find(
    i => i.part_id === parseInt(form.part_id) && i.location_id === parseInt(form.from_location_id)
  )?.quantity_on_hand || 0;

  // Unique parts that have inventory
  const partsWithStock = [...new Map(
    inventory.map(i => [i.part_id, { id: i.part_id, part_number: i.part_number, description: i.part_description }])
  ).values()];

  // Source locations with stock for selected part
  const sourceLocations = form.part_id
    ? inventory.filter(i => i.part_id === parseInt(form.part_id)).map(i => ({ id: i.location_id, name: i.location_name, qty: i.quantity_on_hand }))
    : [];

  // Destination locations (all locations except source)
  const destLocations = locations.filter(l => l.id !== parseInt(form.from_location_id));

  const handleMove = async () => {
    setError('');
    setResult(null);
    try {
      const res = await api.moveInventory({
        part_id: parseInt(form.part_id),
        from_location_id: parseInt(form.from_location_id),
        to_location_id: parseInt(form.to_location_id),
        quantity: parseInt(form.quantity),
      });
      setResult(res);
      setForm({ part_id: '', from_location_id: '', to_location_id: '', quantity: '' });
      const inv = await api.getInventory();
      setInventory(inv);
    } catch (err) { setError(err.message); }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Move Inventory</h1>
      </div>

      {result && (
        <div className="alert alert-success">
          Moved {result.quantity_moved} x {result.part_number} from {result.from_location} to {result.to_location}.
          Total value: ${result.total_cost.toFixed(2)}. FIFO layers transferred: {result.fifo_layers_moved.length}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="form-group">
          <label>Part</label>
          <select value={form.part_id} onChange={e => setForm({ ...form, part_id: e.target.value, from_location_id: '', to_location_id: '', quantity: '' })}>
            <option value="">Select part...</option>
            {partsWithStock.map(p => (
              <option key={p.id} value={p.id}>{p.part_number} - {p.description}</option>
            ))}
          </select>
        </div>

        {form.part_id && (
          <div className="form-group">
            <label>From Location</label>
            <select value={form.from_location_id} onChange={e => setForm({ ...form, from_location_id: e.target.value, to_location_id: '', quantity: '' })}>
              <option value="">Select source...</option>
              {sourceLocations.map(l => (
                <option key={l.id} value={l.id}>{l.name} (Qty: {l.qty})</option>
              ))}
            </select>
          </div>
        )}

        {form.from_location_id && (
          <div className="form-group">
            <label>To Location</label>
            <select value={form.to_location_id} onChange={e => setForm({ ...form, to_location_id: e.target.value })}>
              <option value="">Select destination...</option>
              {destLocations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}

        {form.to_location_id && (
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
            <button className="btn-primary" onClick={handleMove} disabled={!form.quantity || parseInt(form.quantity) <= 0}>
              Move Inventory
            </button>
          </>
        )}
      </div>

      {result && result.fifo_layers_moved.length > 0 && (
        <div className="card">
          <h3>FIFO Layers Transferred</h3>
          <table>
            <thead>
              <tr><th>Source Layer</th><th>Qty Moved</th><th>Unit Cost</th><th>Value</th></tr>
            </thead>
            <tbody>
              {result.fifo_layers_moved.map((l, i) => (
                <tr key={i}>
                  <td>{l.source_layer_id}</td>
                  <td>{l.quantity_moved}</td>
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
