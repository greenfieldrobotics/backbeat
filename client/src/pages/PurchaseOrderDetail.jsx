import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const [po, setPo] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [receiving, setReceiving] = useState(false);
  const [receiveForm, setReceiveForm] = useState({ location_id: '', items: [] });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  const load = () => Promise.all([api.getPurchaseOrder(id), api.getLocations()])
    .then(([p, locs]) => { setPo(p); setLocations(locs); })
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, [id]);

  const statusBadge = (status) => {
    const map = { Draft: 'badge-draft', Ordered: 'badge-ordered', 'Partially Received': 'badge-partial', Closed: 'badge-closed' };
    return <span className={`badge ${map[status] || ''}`}>{status}</span>;
  };

  const startReceive = () => {
    setReceiving(true);
    setError('');
    setMessage(null);
    setReceiveForm({
      location_id: locations[0]?.id || '',
      items: po.line_items
        .filter(li => li.quantity_received < li.quantity_ordered)
        .map(li => ({ line_item_id: li.id, quantity_received: 0, part_number: li.part_number, remaining: li.quantity_ordered - li.quantity_received })),
    });
  };

  const updateReceiveQty = (i, qty) => {
    const items = [...receiveForm.items];
    items[i] = { ...items[i], quantity_received: parseInt(qty) || 0 };
    setReceiveForm({ ...receiveForm, items });
  };

  const handleReceive = async () => {
    setError('');
    try {
      const items = receiveForm.items.filter(i => i.quantity_received > 0).map(i => ({
        line_item_id: i.line_item_id,
        quantity_received: i.quantity_received,
      }));
      if (items.length === 0) { setError('Enter quantities to receive'); return; }

      const result = await api.receivePO(id, { location_id: parseInt(receiveForm.location_id), items });
      setMessage(`Received successfully. PO status: ${result.po_status}`);
      setReceiving(false);
      load();
    } catch (err) { setError(err.message); }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await api.updatePOStatus(id, newStatus);
      load();
    } catch (err) { alert(err.message); }
  };

  if (loading) return <div>Loading...</div>;
  if (!po) return <div>PO not found</div>;

  return (
    <div>
      <div className="page-header">
        <h1>
          <Link to="/purchase-orders" className="table-link">&larr; POs</Link>
          {' / '}{po.po_number}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {po.status === 'Draft' && (
            <button className="btn-success" onClick={() => handleStatusChange('Ordered')}>Mark as Ordered</button>
          )}
          {(po.status === 'Ordered' || po.status === 'Partially Received') && (
            <button className="btn-primary" onClick={startReceive}>Receive Items</button>
          )}
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
          <div><strong>Supplier:</strong><br />{po.supplier_name}</div>
          <div><strong>Status:</strong><br />{statusBadge(po.status)}</div>
          <div><strong>Expected Delivery:</strong><br />{po.expected_delivery_date || '-'}</div>
          <div><strong>Created:</strong><br />{new Date(po.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      <h2 style={{ marginBottom: 12 }}>Line Items</h2>
      <table>
        <thead>
          <tr>
            <th>Part Number</th>
            <th>Description</th>
            <th>Qty Ordered</th>
            <th>Qty Received</th>
            <th>Unit Cost</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {po.line_items.map(li => (
            <tr key={li.id}>
              <td><strong>{li.part_number}</strong></td>
              <td>{li.part_description}</td>
              <td>{li.quantity_ordered}</td>
              <td>{li.quantity_received}</td>
              <td>${li.unit_cost.toFixed(2)}</td>
              <td>${(li.quantity_ordered * li.unit_cost).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {receiving && (
        <div className="modal-overlay" onClick={() => setReceiving(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Receive Items - {po.po_number}</h2>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label>Receiving Location</label>
              <select value={receiveForm.location_id} onChange={e => setReceiveForm({ ...receiveForm, location_id: e.target.value })}>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <table>
              <thead>
                <tr><th>Part</th><th>Remaining</th><th>Receive Qty</th></tr>
              </thead>
              <tbody>
                {receiveForm.items.map((item, i) => (
                  <tr key={item.line_item_id}>
                    <td>{item.part_number}</td>
                    <td>{item.remaining}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max={item.remaining}
                        value={item.quantity_received}
                        onChange={e => updateReceiveQty(i, e.target.value)}
                        style={{ width: 80 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setReceiving(false)}>Cancel</button>
              <button className="btn-success" onClick={handleReceive}>Confirm Receipt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
