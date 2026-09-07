import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../../core/api';

// The landing page for a scanned label (G2.2). Reached at /a/:serial — never
// linked to from the app's own nav, only from a printed/scanned URL. A missing
// serial is a normal outcome (labels outlive assets), so it renders a plain
// not-found message rather than an error page (§ "three things that will bite").
export default function AssetLookupPage() {
  const { serial } = useParams();
  const [asset, setAsset] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setAsset(null);
    api.getAssetBySerial(serial)
      .then(setAsset)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [serial]);

  if (loading) return <div>Loading...</div>;

  if (notFound) {
    return (
      <div>
        <h1>Asset not found</h1>
        <p>No asset is registered with serial <strong>{serial}</strong>.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>{asset.serial_number || `Asset #${asset.id}`}</h1>
      </div>
      <table>
        <tbody>
          <tr><th>Type</th><td>{asset.asset_type_name}</td></tr>
          <tr><th>Status</th><td>{asset.lifecycle_state_name}</td></tr>
          <tr><th>Location</th><td>{asset.location_name || '—'}</td></tr>
          <tr><th>Owner</th><td>{asset.owner_party_name || '—'}</td></tr>
          <tr><th>Custodian</th><td>{asset.custodian_party_name || '—'}</td></tr>
          <tr><th>Notes</th><td>{asset.notes || '—'}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
