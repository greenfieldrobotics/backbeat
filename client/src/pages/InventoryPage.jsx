import { useState, useEffect } from 'react';
import { api } from '../api';

export default function InventoryPage() {
  const [inventory, setInventory] = useState([]);
  const [valuation, setValuation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getInventory(), api.getValuation()])
      .then(([inv, val]) => {
        setInventory(inv);
        setValuation(val);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;

  const totalQty = inventory.reduce((sum, r) => sum + r.quantity_on_hand, 0);
  const totalValue = valuation?.grand_total || 0;
  const uniqueParts = new Set(inventory.map(r => r.part_id)).size;
  const uniqueLocations = new Set(inventory.map(r => r.location_id)).size;

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
