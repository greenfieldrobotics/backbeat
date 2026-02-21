import { useState, useEffect } from 'react';
import { api } from '../api';

export default function ValuationPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getValuation().then(setData).finally(() => setLoading(false));
  }, []);

  const handleExportCSV = async () => {
    const csv = await api.getValuationCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fifo_valuation_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>FIFO Inventory Valuation</h1>
        <button className="btn-primary" onClick={handleExportCSV}>Export CSV</button>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="label">Grand Total Value</div>
          <div className="value">${data.grand_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active Layers</div>
          <div className="value">{data.layers.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Parts Valued</div>
          <div className="value">{data.summary.length}</div>
        </div>
      </div>

      <div className="card">
        <h3>Summary by Part & Location</h3>
        <table>
          <thead>
            <tr>
              <th>Part Number</th>
              <th>Description</th>
              <th>Location</th>
              <th>Total Qty</th>
              <th>Total Value</th>
            </tr>
          </thead>
          <tbody>
            {data.summary.map((row, i) => (
              <tr key={i}>
                <td><strong>{row.part_number}</strong></td>
                <td>{row.part_description}</td>
                <td>{row.location_name}</td>
                <td>{row.total_qty}</td>
                <td>${row.total_value.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>FIFO Layer Detail</h3>
        <table>
          <thead>
            <tr>
              <th>Part Number</th>
              <th>Location</th>
              <th>Source</th>
              <th>Original Qty</th>
              <th>Remaining</th>
              <th>Unit Cost</th>
              <th>Total Value</th>
              <th>Receipt Date</th>
            </tr>
          </thead>
          <tbody>
            {data.layers.map((layer, i) => (
              <tr key={i}>
                <td><strong>{layer.part_number}</strong></td>
                <td>{layer.location_name}</td>
                <td>{layer.source_ref}</td>
                <td>{layer.original_qty}</td>
                <td>{layer.remaining_qty}</td>
                <td>${layer.unit_cost.toFixed(2)}</td>
                <td>${layer.total_value.toFixed(2)}</td>
                <td>{new Date(layer.receipt_date).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
