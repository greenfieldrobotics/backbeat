import { useCallback, useEffect, useRef, useState } from 'react';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import { claimScans } from '../../../core/scanning/scanClaim';
import { extractSerialFromScan } from '../../../core/scanning/scanValue';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Asset, AssetModel, MaintenanceOrder, ComponentInstallation } from '../types';

// Maintenance (Phase 10, G6.1 + G6.3). Scan/enter an asset, then work against its
// service history and installed components. The L3 gate (§2.3, supports_maintenance)
// is enforced server-side (assertSupportsMaintenance in maintenanceOrderService.js);
// this page does not pre-filter which assets it will accept — it surfaces the
// service's rejection the same way LinkPage surfaces a supports_linking rejection,
// rather than duplicating the capability check on the client.
function MaintenancePageContent() {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const serialFieldRef = useRef<HTMLInputElement>(null);

  const [orders, setOrders] = useState<MaintenanceOrder[]>([]);
  const [installations, setInstallations] = useState<ComponentInstallation[]>([]);
  const [models, setModels] = useState<AssetModel[]>([]);

  const [orderDescription, setOrderDescription] = useState('');
  const [installModelId, setInstallModelId] = useState('');
  const [installHours, setInstallHours] = useState('');
  const [installNotes, setInstallNotes] = useState('');
  const [removeHours, setRemoveHours] = useState<Record<number, string>>({});
  const [removeCondition, setRemoveCondition] = useState<Record<number, string>>({});

  useEffect(() => {
    gearApi.getAssetModels().then(r => { if (!isApiFailure(r)) setModels(r.data); });
  }, []);

  useEffect(() => {
    if (!asset) serialFieldRef.current?.focus();
  }, [asset]);

  const loadHistory = useCallback(async (assetId: number) => {
    const [ordersResult, installsResult] = await Promise.all([
      gearApi.getMaintenanceOrdersForAsset(assetId),
      gearApi.getComponentInstallationsForAsset(assetId),
    ]);
    if (!isApiFailure(ordersResult)) setOrders(ordersResult.data);
    if (!isApiFailure(installsResult)) setInstallations(installsResult.data);
  }, []);

  const resolveAsset = useCallback(async (raw: string) => {
    const serial = extractSerialFromScan(raw);
    if (!serial) return;
    setBusy(true);
    setError('');
    const result = await gearApi.getAssetBySerial(serial);
    setBusy(false);
    if (isApiFailure(result)) {
      setError(`No asset found for "${serial}".`);
      return;
    }
    setAsset(result.data);
    setSerialInput('');
    await loadHistory(result.data.id);
  }, [loadHistory]);

  // Claim the scan stream while waiting for an asset, same as LocatePage/LinkPage —
  // otherwise GlobalScanListener would navigate to /a/:serial instead (G4.2's default).
  useEffect(() => {
    if (!asset) return claimScans(resolveAsset);
    return undefined;
  }, [asset, resolveAsset]);

  const startOver = () => {
    setAsset(null);
    setOrders([]);
    setInstallations([]);
    setSerialInput('');
    setError('');
    setOrderDescription('');
    setInstallModelId('');
    setInstallHours('');
    setInstallNotes('');
  };

  const openOrder = async () => {
    if (!asset) return;
    setBusy(true);
    setError('');
    const result = await gearApi.createMaintenanceOrder({
      asset_id: asset.id,
      description: orderDescription || undefined,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(result.error);
      return;
    }
    setOrderDescription('');
    await loadHistory(asset.id);
  };

  const advanceOrder = async (order: MaintenanceOrder, status: 'in_progress' | 'closed') => {
    if (!asset) return;
    setBusy(true);
    setError('');
    const result = await gearApi.updateMaintenanceOrder(order.id, { status });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(result.error);
      return;
    }
    await loadHistory(asset.id);
  };

  const installComponent = async () => {
    if (!asset || !installModelId || !installHours) return;
    setBusy(true);
    setError('');
    const result = await gearApi.createComponentInstallation({
      asset_model_id: Number(installModelId),
      installed_on_asset_id: asset.id,
      installed_at_hours: Number(installHours),
      notes: installNotes || undefined,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(result.error);
      return;
    }
    setInstallModelId('');
    setInstallHours('');
    setInstallNotes('');
    await loadHistory(asset.id);
  };

  const removeInstallation = async (installation: ComponentInstallation) => {
    if (!asset) return;
    const hours = removeHours[installation.id];
    if (!hours) {
      setError('Enter the hour reading at removal first.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await gearApi.removeComponentInstallation(installation.id, {
      removed_at_hours: Number(hours),
      condition_on_removal: removeCondition[installation.id] || undefined,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(result.error);
      return;
    }
    await loadHistory(asset.id);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Maintenance</h1>
      </div>
      <p>Scan or enter an asset's serial to see its service history and installed components.</p>
      {error && <div className="alert alert-error">{error}</div>}

      {!asset && (
        <form className="form-group" onSubmit={e => { e.preventDefault(); resolveAsset(serialInput); }}>
          <label>Asset serial</label>
          <input
            ref={serialFieldRef}
            value={serialInput}
            onChange={e => setSerialInput(e.target.value)}
            disabled={busy}
            placeholder="Asset serial"
          />
        </form>
      )}

      {asset && (
        <>
          <p>
            Asset: <strong>{asset.serial_number || `#${asset.id}`}</strong> ({asset.asset_type_name}){' '}
            <button className="btn-secondary btn-sm" onClick={startOver}>Change asset</button>
          </p>

          <h2>Service history</h2>
          <table>
            <thead>
              <tr><th>Opened</th><th>Status</th><th>Description</th><th>Closed</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td>{new Date(o.opened_at).toLocaleString()}</td>
                  <td>{o.status}</td>
                  <td>{o.description || '—'}</td>
                  <td>{o.closed_at ? new Date(o.closed_at).toLocaleString() : '—'}</td>
                  <td>
                    {o.status === 'open' && (
                      <button className="btn-secondary btn-sm" onClick={() => advanceOrder(o, 'in_progress')} disabled={busy}>
                        Start
                      </button>
                    )}
                    {o.status !== 'closed' && (
                      <>
                        {' '}
                        <button className="btn-secondary btn-sm" onClick={() => advanceOrder(o, 'closed')} disabled={busy}>
                          Close
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>No maintenance orders yet.</td></tr>
              )}
            </tbody>
          </table>
          <form className="form-group" onSubmit={e => { e.preventDefault(); openOrder(); }}>
            <label>Open a new work order</label>
            <input
              value={orderDescription}
              onChange={e => setOrderDescription(e.target.value)}
              disabled={busy}
              placeholder="What needs doing"
            />
            <button className="btn-primary btn-sm" type="submit" disabled={busy}>Open</button>
          </form>

          <h2>Installed components</h2>
          <table>
            <thead>
              <tr><th>Model</th><th>Installed at</th><th>Removed at</th><th>Condition</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {installations.map(i => (
                <tr key={i.id}>
                  <td>{i.model_manufacturer} {i.model_model_name}</td>
                  <td>{i.installed_at_hours}h</td>
                  <td>{i.removed_at_hours ?? '—'}</td>
                  <td>{i.condition_on_removal || '—'}</td>
                  <td>
                    {i.removed_at_hours === null && (
                      <>
                        <input
                          style={{ width: '5rem' }}
                          placeholder="hours"
                          value={removeHours[i.id] || ''}
                          onChange={e => setRemoveHours({ ...removeHours, [i.id]: e.target.value })}
                          disabled={busy}
                        />{' '}
                        <input
                          style={{ width: '8rem' }}
                          placeholder="condition"
                          value={removeCondition[i.id] || ''}
                          onChange={e => setRemoveCondition({ ...removeCondition, [i.id]: e.target.value })}
                          disabled={busy}
                        />{' '}
                        <button className="btn-secondary btn-sm" onClick={() => removeInstallation(i)} disabled={busy}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {installations.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>No components installed.</td></tr>
              )}
            </tbody>
          </table>
          <form className="form-group" onSubmit={e => { e.preventDefault(); installComponent(); }}>
            <label>Install a component</label>
            <select value={installModelId} onChange={e => setInstallModelId(e.target.value)} disabled={busy}>
              <option value="">— Select model —</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.manufacturer} {m.model_name}</option>)}
            </select>{' '}
            <input
              style={{ width: '6rem' }}
              placeholder="hour reading"
              value={installHours}
              onChange={e => setInstallHours(e.target.value)}
              disabled={busy}
            />{' '}
            <input
              placeholder="notes"
              value={installNotes}
              onChange={e => setInstallNotes(e.target.value)}
              disabled={busy}
            />{' '}
            <button className="btn-primary btn-sm" type="submit" disabled={busy}>Install</button>
          </form>
        </>
      )}
    </div>
  );
}

export default function MaintenancePage() {
  return (
    <ErrorBoundary>
      <MaintenancePageContent />
    </ErrorBoundary>
  );
}
