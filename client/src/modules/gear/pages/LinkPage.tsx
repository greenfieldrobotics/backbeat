import { useCallback, useEffect, useRef, useState } from 'react';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import { claimScans } from '../../../core/scanning/scanClaim';
import { extractSerialFromScan } from '../../../core/scanning/scanValue';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Asset } from '../types';

type Step = 'child' | 'parent' | 'done';

// Link types are free text on the server (a new use case is a new value, never a
// schema change — G5.1) but a two-scan, glove-on flow has no room for typing one in.
// This is a tap-selectable starter set covering the cases the plan names explicitly;
// nothing stops a future admin screen from adding more without a migration.
const LINK_TYPES = [
  { value: 'installed_in', label: 'Installed in (e.g. battery/VCU → robot)' },
  { value: 'mounted_on', label: 'Mounted on (e.g. robot → trailer)' },
  { value: 'serves', label: 'Serves (e.g. RTK base → field)' },
];

// Two-scan linking (G5.2): scan the child, then the parent, to open a link. Builds on
// Phase 8's scanner the same way scan-to-locate does — see LocatePage.tsx and
// core/scanning/scanClaim.ts.
function LinkPageContent() {
  const [linkType, setLinkType] = useState(LINK_TYPES[0].value);
  const [step, setStep] = useState<Step>('child');
  const [child, setChild] = useState<Asset | null>(null);
  const [parent, setParent] = useState<Asset | null>(null);
  const [childInput, setChildInput] = useState('');
  const [parentInput, setParentInput] = useState('');
  const [error, setError] = useState('');
  const [conflictChildId, setConflictChildId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const childFieldRef = useRef<HTMLInputElement>(null);
  const parentFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'child') childFieldRef.current?.focus();
    if (step === 'parent') parentFieldRef.current?.focus();
  }, [step]);

  const resolveChild = useCallback(async (raw: string) => {
    const serial = extractSerialFromScan(raw);
    if (!serial) return;
    setBusy(true);
    setError('');
    setConflictChildId(null);
    const result = await gearApi.getAssetBySerial(serial);
    setBusy(false);
    if (isApiFailure(result)) {
      setError(`No asset found for "${serial}".`);
      return;
    }
    setChild(result.data);
    setChildInput('');
    setStep('parent');
  }, []);

  const openLink = useCallback(async (childId: number, parentId: number) => {
    setBusy(true);
    const result = await gearApi.createLink({ parent_asset_id: parentId, child_asset_id: childId, link_type: linkType });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(result.error);
      if (result.status === 409) setConflictChildId(childId);
      return;
    }
    setConflictChildId(null);
    setStep('done');
  }, [linkType]);

  const resolveParent = useCallback(async (raw: string) => {
    const serial = extractSerialFromScan(raw);
    if (!serial || !child) return;
    setBusy(true);
    setError('');
    const result = await gearApi.getAssetBySerial(serial);
    setBusy(false);
    if (isApiFailure(result)) {
      setError(`No asset found for "${serial}".`);
      return;
    }
    setParent(result.data);
    setParentInput('');
    await openLink(child.id, result.data.id);
  }, [child, openLink]);

  // See LocatePage.tsx for why this claims the scan stream rather than letting
  // GlobalScanListener navigate away mid-flow.
  useEffect(() => {
    if (step === 'child') return claimScans(resolveChild);
    if (step === 'parent') return claimScans(resolveParent);
    return undefined;
  }, [step, resolveChild, resolveParent]);

  const startOver = () => {
    setStep('child');
    setChild(null);
    setParent(null);
    setChildInput('');
    setParentInput('');
    setError('');
    setConflictChildId(null);
  };

  const closeExistingAndRetry = async () => {
    if (!child || !parent || conflictChildId === null) return;
    setBusy(true);
    const links = await gearApi.getAssetLinks(conflictChildId);
    setBusy(false);
    if (isApiFailure(links)) {
      setError(links.error);
      return;
    }
    const open = links.data.find(l => l.child_asset_id === conflictChildId && l.valid_to === null);
    if (!open) {
      setError('Could not find the open link to close.');
      return;
    }
    setBusy(true);
    const closed = await gearApi.closeLink(open.id);
    setBusy(false);
    if (isApiFailure(closed)) {
      setError(closed.error);
      return;
    }
    await openLink(child.id, parent.id);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Link</h1>
      </div>
      <p>Scan a child asset, then scan the parent it's attached to.</p>
      {error && (
        <div className="alert alert-error">
          {error}
          {conflictChildId !== null && (
            <>
              {' '}
              <button className="btn-secondary btn-sm" onClick={closeExistingAndRetry} disabled={busy}>
                Close existing link and relink
              </button>
            </>
          )}
        </div>
      )}

      <div className="form-group">
        <label>Link type</label>
        <select value={linkType} onChange={e => setLinkType(e.target.value)} disabled={step !== 'child'}>
          {LINK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {step === 'child' && (
        <form className="form-group" onSubmit={e => { e.preventDefault(); resolveChild(childInput); }}>
          <label>1. Scan or enter the child asset's serial</label>
          <input
            ref={childFieldRef}
            value={childInput}
            onChange={e => setChildInput(e.target.value)}
            disabled={busy}
            placeholder="Child serial (e.g. the battery)"
          />
        </form>
      )}

      {step === 'parent' && child && (
        <>
          <p>
            Child: <strong>{child.serial_number || `#${child.id}`}</strong> ({child.asset_type_name})
          </p>
          <form className="form-group" onSubmit={e => { e.preventDefault(); resolveParent(parentInput); }}>
            <label>2. Scan or enter the parent asset's serial</label>
            <input
              ref={parentFieldRef}
              value={parentInput}
              onChange={e => setParentInput(e.target.value)}
              disabled={busy}
              placeholder="Parent serial (e.g. the robot)"
            />
          </form>
          <button className="btn-secondary btn-sm" onClick={startOver}>Cancel</button>
        </>
      )}

      {step === 'done' && child && parent && (
        <div>
          <p className="alert alert-success">
            Linked <strong>{child.serial_number || `#${child.id}`}</strong> to{' '}
            <strong>{parent.serial_number || `#${parent.id}`}</strong> ({linkType}).
          </p>
          <button className="btn-primary" onClick={startOver}>Link another asset</button>
        </div>
      )}
    </div>
  );
}

export default function LinkPage() {
  return (
    <ErrorBoundary>
      <LinkPageContent />
    </ErrorBoundary>
  );
}
