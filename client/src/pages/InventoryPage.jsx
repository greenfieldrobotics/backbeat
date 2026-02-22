import { useState, useEffect } from 'react';
import { api } from '../api';

export default function InventoryPage() {
  const [inventory, setInventory] = useState([]);
  const [valuation, setValuation] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getInventory(), api.getValuation(), api.getDashboard()])
      .then(([inv, val, dash]) => {
        setInventory(inv);
        setValuation(val);
        setDashboard(dash);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;

  const totalQty = inventory.reduce((sum, r) => sum + r.quantity_on_hand, 0);
  const totalValue = valuation?.grand_total || 0;
  const uniqueParts = new Set(inventory.map(r => r.part_id)).size;
  const uniqueLocations = new Set(inventory.map(r => r.location_id)).size;

  const lowStockAlerts = dashboard?.low_stock_alerts || [];
  const openPOs = dashboard?.open_purchase_orders || [];
  const inventoryByType = dashboard?.inventory_by_type || [];

  return (
    <div>
      <div className="page-header">
        <h1>Inventory Overview</h1>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="label">Total Items</div>
          <div className="value">{totalQty.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Value</div>
          <div className="value">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="stat-card">
          <div className="label">Parts in Stock</div>
          <div className="value">{uniqueParts}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active Locations</div>
          <div className="value">{uniqueLocations}</div>
        </div>
      </div>

      {/* Inventory by Location Type */}
      {inventoryByType.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem' }}>Inventory by Location Type</h2>
          <div className="stat-row">
            {inventoryByType.map(row => (
              <div className="stat-card" key={row.type}>
                <div className="label">{row.type}</div>
                <div className="value">{Number(row.total_qty).toLocaleString()} items</div>
                <div className="label" style={{ marginTop: '0.25rem' }}>
                  ${Number(row.total_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Low-Stock Alerts */}
      {lowStockAlerts.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem', color: '#d97706' }}>Low-Stock Alerts</h2>
          <table>
            <thead>
              <tr>
                <th>Part Number</th>
                <th>Description</th>
                <th>Location</th>
                <th>Qty On Hand</th>
              </tr>
            </thead>
            <tbody>
              {lowStockAlerts.map((row, i) => (
                <tr key={i}>
                  <td><strong>{row.part_number}</strong></td>
                  <td>{row.description}</td>
                  <td>{row.location_name}</td>
                  <td style={{ color: '#dc2626', fontWeight: 'bold' }}>{row.quantity_on_hand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Open Purchase Orders */}
      {openPOs.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem' }}>Open Purchase Orders</h2>
          <table>
            <thead>
              <tr>
                <th>PO #</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Expected Delivery</th>
                <th>Total Value</th>
                <th>Ordered</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {openPOs.map(po => (
                <tr key={po.id}>
                  <td><strong>{po.po_number}</strong></td>
                  <td>{po.supplier_name}</td>
                  <td>{po.status}</td>
                  <td>{po.expected_delivery_date || '—'}</td>
                  <td>${Number(po.total_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>{Number(po.total_qty_ordered).toLocaleString()}</td>
                  <td>{Number(po.total_qty_received).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Inventory Table */}
      <h2 style={{ marginTop: '2rem' }}>Inventory Detail</h2>
      <table>
        <thead>
          <tr>
            <th>Part Number</th>
            <th>Description</th>
            <th>Classification</th>
            <th>Location</th>
            <th>Qty On Hand</th>
          </tr>
        </thead>
        <tbody>
          {inventory.length === 0 ? (
            <tr><td colSpan="5" className="empty-state">No inventory records yet</td></tr>
          ) : (
            inventory.map(row => (
              <tr key={row.id}>
                <td><strong>{row.part_number}</strong></td>
                <td>{row.part_description}</td>
                <td>{row.classification}</td>
                <td>{row.location_name}</td>
                <td>{row.quantity_on_hand}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
