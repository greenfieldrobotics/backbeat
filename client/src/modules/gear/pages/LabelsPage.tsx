import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Asset, AssetLabel, LabelSymbology } from '../types';

// Label generation (Phase 7, G2.4) — local prototype scope only. Nothing generated
// here should go on real equipment yet: the encoded URL's host is read from
// LABEL_HOST (server-side config, see labelService.js), and it currently points at
// the local dev app, not a durable host (G2.3 is still pending a domain/DNS
// decision — requirements §10, §6.4). Preview and print-to-PDF are fine; applying a
// label to equipment before G2.3 exists is exactly what requirements §10 forbids.
function LabelsPageContent() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [previewSymbology, setPreviewSymbology] = useState<LabelSymbology>('qr');
  const [previewLabel, setPreviewLabel] = useState<AssetLabel | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    gearApi.getAssets().then(result => {
      if (!isApiFailure(result)) setAssets(result.data);
      setLoading(false);
    });
  }, []);

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const loadPreview = async (assetId: number, symbology?: LabelSymbology) => {
    setPreviewLoading(true);
    setPreviewError('');
    const result = await gearApi.getAssetLabel(assetId, symbology);
    setPreviewLoading(false);
    if (isApiFailure(result)) {
      setPreviewError(result.error);
      setPreviewLabel(null);
      return;
    }
    setPreviewLabel(result.data);
    setPreviewSymbology(result.data.symbology);
  };

  const openPreview = async (a: Asset) => {
    setPreviewAsset(a);
    setPreviewLabel(null);
    await loadPreview(a.id);
  };

  const closePreview = () => {
    setPreviewAsset(null);
    setPreviewLabel(null);
    setPreviewError('');
  };

  const changePreviewSymbology = async (symbology: LabelSymbology) => {
    if (!previewAsset) return;
    setPreviewSymbology(symbology);
    await loadPreview(previewAsset.id, symbology);
  };

  const printSelected = () => {
    if (selected.size === 0) return;
    navigate(`/gear/labels/print?ids=${Array.from(selected).join(',')}`);
  };

  if (loading) return <div>Loading...</div>;

  const labelable = assets.filter(a => !!a.serial_number);

  return (
    <div>
      <div className="page-header">
        <h1>Labels</h1>
        <button className="btn-primary" disabled={selected.size === 0} onClick={printSelected}>
          Print Sheet ({selected.size})
        </button>
      </div>

      <table>
        <thead>
          <tr><th></th><th>Serial</th><th>Type</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {labelable.map(a => (
            <tr key={a.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggle(a.id)}
                  aria-label={`Select ${a.serial_number}`}
                />
              </td>
              <td><strong>{a.serial_number}</strong></td>
              <td>{a.asset_type_name}</td>
              <td>
                <button className="btn-secondary btn-sm" onClick={() => openPreview(a)}>Preview</button>
              </td>
            </tr>
          ))}
          {labelable.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: '#888' }}>No assets with a serial number yet — a label needs one to encode.</td></tr>
          )}
        </tbody>
      </table>

      {previewAsset && (
        <div className="modal-overlay" onClick={closePreview}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Label — {previewAsset.serial_number}</h2>
            <div className="form-group">
              <label>Symbology</label>
              <select value={previewSymbology} onChange={e => changePreviewSymbology(e.target.value as LabelSymbology)}>
                <option value="qr">QR</option>
                <option value="datamatrix">DataMatrix</option>
              </select>
            </div>
            {previewLoading && <div>Loading...</div>}
            {previewError && <div className="alert alert-error">{previewError}</div>}
            {previewLabel && (
              <div className="label-card">
                <div dangerouslySetInnerHTML={{ __html: previewLabel.svg }} />
                <div className="label-serial">{previewLabel.serial_number}</div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={closePreview}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LabelsPage() {
  return (
    <ErrorBoundary>
      <LabelsPageContent />
    </ErrorBoundary>
  );
}
