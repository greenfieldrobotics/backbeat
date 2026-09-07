import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../core/api';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import { claimScans } from '../../../core/scanning/scanClaim';
import { extractSerialFromScan } from '../../../core/scanning/scanValue';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Asset } from '../types';

interface Location {
  id: number;
  name: string;
}

type Step = 'asset' | 'location' | 'done';

// Scan-to-locate (G3.3): scan an asset, then scan a location, and the asset moves —
// two scans, no keyboard, per G5.2's bar for the whole scanning story. Reuses the
// general PUT /api/gear/assets/:id (gearApi.moveAsset) rather than a dedicated
// endpoint, so this writes exactly the one `moved` event Phase 4 already wires up.
//
// Locations have no printed labels yet — Phase 7 (labels) is blocked on the durable
// redirect host (Phase 5's follow-on), so there is no code to physically scan for the
// second step. This page is still fully usable with an entered location name (a
// technician typing what they'd otherwise scan), and the scan-claim wiring below means
// a real scanner already works for step 2 the day a location label format exists — see
// handoff/phase-9-response.md for the limitation this leaves unresolved.
function LocatePageContent() {
  const [step, setStep] = useState<Step>('asset');
  const [locations, setLocations] = useState<Location[]>([]);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [movedTo, setMovedTo] = useState<Location | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const serialFieldRef = useRef<HTMLInputElement>(null);
  const locationFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getLocations().then(setLocations);
  }, []);

  useEffect(() => {
    if (step === 'asset') serialFieldRef.current?.focus();
    if (step === 'location') locationFieldRef.current?.focus();
  }, [step]);

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
    setStep('location');
  }, []);

  const resolveLocation = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || !asset) return;
    const match = locations.find(l => l.name.toLowerCase() === code.toLowerCase());
    if (!match) {
      setError(`No location matches "${code}".`);
      return;
    }
    setBusy(true);
    setError('');
    const result = await gearApi.moveAsset(asset.id, match.id);
    setBusy(false);
    if (isApiFailure(result)) {
      setError(result.error);
      return;
    }
    setMovedTo(match);
    setLocationInput('');
    setStep('done');
  }, [asset, locations]);

  // Claim the scan stream while this page has a step waiting on input, so a scan from
  // a dedicated scanner feeds the current step instead of navigating to /a/:serial
  // (G4.2's default). See core/scanning/scanClaim.ts.
  useEffect(() => {
    if (step === 'asset') return claimScans(resolveAsset);
    if (step === 'location') return claimScans(resolveLocation);
    return undefined;
  }, [step, resolveAsset, resolveLocation]);

  const startOver = () => {
    setStep('asset');
    setAsset(null);
    setMovedTo(null);
    setSerialInput('');
    setLocationInput('');
    setError('');
  };

  return (
    <div>
      <div className="page-header">
        <h1>Locate</h1>
      </div>
      <p>Scan an asset, then scan a bin or site, to record that it moved there.</p>
      {error && <div className="alert alert-error">{error}</div>}

      {step === 'asset' && (
        <form
          className="form-group"
          onSubmit={e => { e.preventDefault(); resolveAsset(serialInput); }}
        >
          <label>1. Scan or enter the asset's serial</label>
          <input
            ref={serialFieldRef}
            value={serialInput}
            onChange={e => setSerialInput(e.target.value)}
            disabled={busy}
            placeholder="Asset serial"
          />
        </form>
      )}

      {step === 'location' && asset && (
        <>
          <p>
            Asset: <strong>{asset.serial_number || `#${asset.id}`}</strong> ({asset.asset_type_name})
          </p>
          <form
            className="form-group"
            onSubmit={e => { e.preventDefault(); resolveLocation(locationInput); }}
          >
            <label>2. Scan or enter the destination location's name</label>
            <input
              ref={locationFieldRef}
              value={locationInput}
              onChange={e => setLocationInput(e.target.value)}
              disabled={busy}
              placeholder="Location name"
              list="locate-location-options"
            />
            <datalist id="locate-location-options">
              {locations.map(l => <option key={l.id} value={l.name} />)}
            </datalist>
          </form>
          <button className="btn-secondary btn-sm" onClick={startOver}>Cancel</button>
        </>
      )}

      {step === 'done' && asset && movedTo && (
        <div>
          <p className="alert alert-success">
            Moved <strong>{asset.serial_number || `#${asset.id}`}</strong> to <strong>{movedTo.name}</strong>.
          </p>
          <button className="btn-primary" onClick={startOver}>Locate another asset</button>
        </div>
      )}
    </div>
  );
}

export default function LocatePage() {
  return (
    <ErrorBoundary>
      <LocatePageContent />
    </ErrorBoundary>
  );
}
