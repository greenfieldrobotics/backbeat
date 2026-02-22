import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import PartSearch from '../components/PartSearch';

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ supplier_id: '', expected_delivery_date: '', line_items: [{ part_id: '', quantity_ordered: '', unit_cost: '' }] });

  const load = () => Promise.all([api.getPurchaseOrders(), api.getSuppliers(), api.getParts()])
    .then(([p, s, parts]) => { setPos(p); setSuppliers(s); setParts(parts); })
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const statusBadge = (status) => {
    const map = { Draft: 'badge-draft', Ordered: 'badge-ordered', 'Partially Received': 'badge-partial', Closed: 'badge-closed' };
    return <span className={`badge ${map[status] || ''}`}>{status}</span>;
  };

  const addLine = () => setForm({ ...form, line_items: [...form.line_items, { part_id: '', quantity_ordered: '', unit_cost: '' }] });
  const removeLine = (i) => setForm({ ...form, line_items: form.line_items.filter((_, idx) => idx !== i) });
  const updateLine = (i, field, value) => {
    const items = [...form.line_items];
    items[i] = { ...items[i], [field]: value };
    setForm({ ...form, line_items: items });
  };

  const handleCreate = async () => {
    setError('');
    try {
      const data = {
        supplier_id: parseInt(form.supplier_id),
        expected_delivery_date: form.expected_delivery_date || undefined,
        line_items: form.line_items.map(li => ({
          part_id: parseInt(li.part_id),
          quantity_ordered: parseInt(li.quantity_ordered),
          unit_cost: parseFloat(li.unit_cost),
        })),
      };
      await api.createPurchaseOrder(data);
      setShowModal(false);
      setForm({ supplier_id: '', expected_delivery_date: '', line_items: [{ part_id: '', quantity_ordered: '', unit_cost: '' }] });
      load();
    } catch (err) { setError(err.message); }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Purchase Orders</h1>
        <button className="btn-primary" onClick={() => { setError(''); setShowModal(true); }}>New PO</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>PO Number</th>
            <th>Supplier</th>
            <th>Status</th>
            <th>Expected Delivery</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {pos.length === 0 ? (
            <tr><td colSpan="5" className="empty-state">No purchase orders yet</td></tr>
          ) : pos.map(po => (
            <tr key={po.id}>
              <td><Link to={`/purchase-orders/${po.id}`} className="table-link">{po.po_number}</Link></td>
              <td>{po.supplier_name}</td>
              <td>{statusBadge(po.status)}</td>
              <td>{po.expected_delivery_date || '-'}</td>
              <td>{new Date(po.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 650 }}>
            <h2>New Purchase Order</h2>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label>Supplier</label>
              <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Expected Delivery Date</label>
              <input type="date" value={form.expected_delivery_date} onChange={e => setForm({ ...form, expected_delivery_date: e.target.value })} />
            </div>

            <h3 style={{ marginTop: 16, marginBottom: 8 }}>Line Items</h3>
            {form.line_items.map((li, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
                  {i === 0 && <label>Part</label>}
                  <PartSearch
                    parts={parts}
                    value={li.part_id}
                    onSelect={p => updateLine(i, 'part_id', String(p.id || ''))}
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  {i === 0 && <label>Qty</label>}
                  <input type="number" min="1" value={li.quantity_ordered} onChange={e => updateLine(i, 'quantity_ordered', e.target.value)} />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  {i === 0 && <label>Unit Cost</label>}
                  <input type="number" min="0" step="0.01" value={li.unit_cost} onChange={e => updateLine(i, 'unit_cost', e.target.value)} />
                </div>
                {form.line_items.length > 1 && (
                  <button className="btn-danger btn-sm" onClick={() => removeLine(i)} style={{ marginBottom: 2 }}>X</button>
                )}
              </div>
            ))}
            <button className="btn-secondary btn-sm" onClick={addLine} style={{ marginTop: 4 }}>+ Add Line</button>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreate}>Create PO</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
