import { useCallback, useState } from 'react';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import { analyzePhoto, type PhotoAnalysis } from '../photoResolve';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Asset, PhotoScanResult } from '../types';

type Status = 'idle' | 'analyzing' | 'no-code' | 'not-found' | 'ready' | 'submitting' | 'done';

// Photograph-and-resolve-later (Phase 11, G4.3): a technician without connectivity or
// access photographs a label and uploads the photo later, from this page, so the scan
// still counts. This is NOT offline capture (§7.1 defers that) — the photo must already
// be sitting on the device (camera roll, AirDrop, etc.) and the upload itself needs a
// connection; nothing here is queued across a page reload or a browser restart.
//
// Decoding reuses Phase 8's self-hosted decoder as-is (see photoResolve.ts) — this page
// never talks to a second decoder or a third-party service.
function PhotoResolvePageContent() {
  const [status, setStatus] = useState<Status>('idle');
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [manualTakenAt, setManualTakenAt] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PhotoScanResult | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setAnalysis(null);
    setAsset(null);
    setManualTakenAt('');
    setError('');
    setResult(null);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setStatus('analyzing');
    setError('');
    setAsset(null);
    setManualTakenAt('');
    setResult(null);

    const photo = await analyzePhoto(file);
    setAnalysis(photo);

    if (!photo.serial) {
      setStatus('no-code');
      return;
    }

    const lookup = await gearApi.getAssetBySerial(photo.serial);
    if (isApiFailure(lookup)) {
      setStatus('not-found');
      return;
    }
    setAsset(lookup.data);
    setStatus('ready');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!analysis?.serial) return;
    setStatus('submitting');
    setError('');

    // EXIF wins when present; otherwise the user's entered date; otherwise omitted
    // entirely so the server falls back to upload time — the last resort (§7.1).
    let occurredAt: string | null = analysis.takenAt;
    if (!occurredAt && manualTakenAt) {
      const parsed = new Date(manualTakenAt);
      occurredAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    const res = await gearApi.resolvePhotoScan({
      serial: analysis.serial,
      occurred_at: occurredAt,
      client_key: analysis.clientKey,
    });

    if (isApiFailure(res)) {
      setError(res.error);
      setStatus('ready'); // same analysis (same client_key) — retry is safe, not a duplicate
      return;
    }
    setResult(res.data);
    setStatus('done');
  }, [analysis, manualTakenAt]);

  return (
    <div>
      <div className="page-header">
        <h1>Resolve a Photo</h1>
      </div>
      <p>
        Pick a photo of a QR or DataMatrix label that was taken earlier — while offline,
        or without access to scan it live — to resolve it now.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {(status === 'idle' || status === 'no-code' || status === 'not-found') && (
        <div className="form-group">
          <label htmlFor="photo-file-input">Photo</label>
          <input
            id="photo-file-input"
            type="file"
            accept="image/*"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      )}

      {status === 'analyzing' && <p>Reading photo…</p>}

      {status === 'no-code' && (
        <p className="alert alert-error">
          No QR or DataMatrix code was found in that photo. Try another photo.
        </p>
      )}

      {status === 'not-found' && analysis?.serial && (
        <p className="alert alert-error">
          No asset is registered with serial <strong>{analysis.serial}</strong>.
        </p>
      )}

      {(status === 'ready' || status === 'submitting') && asset && analysis && (
        <div>
          <p>
            Asset: <strong>{asset.serial_number || `#${asset.id}`}</strong> ({asset.asset_type_name})
          </p>
          {analysis.takenAt ? (
            <p>Photo taken: {new Date(analysis.takenAt).toLocaleString()} (from the photo's EXIF data)</p>
          ) : (
            <div className="form-group">
              <label htmlFor="photo-taken-at">
                When was this photo taken? (no EXIF timestamp found — leave blank to use the upload time)
              </label>
              <input
                id="photo-taken-at"
                type="datetime-local"
                value={manualTakenAt}
                onChange={e => setManualTakenAt(e.target.value)}
                disabled={status === 'submitting'}
              />
            </div>
          )}
          <button className="btn-primary" onClick={handleSubmit} disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Recording…' : 'Resolve'}
          </button>
        </div>
      )}

      {status === 'done' && result && (
        <div>
          <p className="alert alert-success">
            {result.duplicate
              ? 'Already recorded — this photo was submitted before, so no duplicate was created.'
              : 'Recorded.'}
            {' '}
            <strong>{result.asset.serial_number || `#${result.asset.id}`}</strong>
          </p>
          <button className="btn-secondary btn-sm" onClick={reset}>Resolve another photo</button>
        </div>
      )}
    </div>
  );
}

export default function PhotoResolvePage() {
  return (
    <ErrorBoundary>
      <PhotoResolvePageContent />
    </ErrorBoundary>
  );
}
