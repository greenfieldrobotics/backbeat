import { useState, useEffect } from 'react';
import { api } from '../api';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTransactions().then(setTransactions).finally(() => setLoading(false));
  }, []);

  const typeBadge = (type) => {
    const colors = {
      RECEIVE: 'badge-ordered',
      ISSUE: 'badge-draft',
      MOVE: 'badge-partial',
      DISPOSE: 'badge-closed',
      ADJUSTMENT: 'badge-partial',
    };
    return <span className={`badge ${colors[type] || ''}`}>{type}</span>;
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Audit Trail</h1>
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Part Number</th>
            <th>Location</th>
            <th>Quantity</th>
            <th>Unit Cost</th>
            <th>Total Cost</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 ? (
            <tr><td colSpan="8" className="empty-state">No transactions yet</td></tr>
          ) : transactions.map(tx => (
            <tr key={tx.id}>
              <td>{new Date(tx.created_at).toLocaleString()}</td>
              <td>{typeBadge(tx.transaction_type)}</td>
              <td><strong>{tx.part_number}</strong></td>
              <td>
                {tx.location_name}
                {tx.to_location_name && <> → {tx.to_location_name}</>}
              </td>
              <td style={{ color: tx.quantity < 0 ? '#dc3545' : '#28a745' }}>
                {tx.quantity > 0 ? '+' : ''}{tx.quantity}
              </td>
              <td>{tx.unit_cost != null ? `$${tx.unit_cost.toFixed(2)}` : '-'}</td>
              <td style={{ color: tx.total_cost < 0 ? '#dc3545' : '#28a745' }}>
                {tx.total_cost != null ? `$${tx.total_cost.toFixed(2)}` : '-'}
              </td>
              <td>
                {tx.target_ref && <span>To: {tx.target_ref} </span>}
                {tx.reason && <span>{tx.reason}</span>}
                {!tx.target_ref && !tx.reason && '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
