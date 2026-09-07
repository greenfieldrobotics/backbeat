import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import ErrorBoundary from '../components/ErrorBoundary';
import type { AssetLabel } from '../types';

// A printable sheet of multiple labels (Phase 7, G2.4). "Print" is the browser's
// own print dialog (print-to-PDF is just choosing that as the destination) — no PDF
// library needed, and nothing here talks to a third party (§6.3). Reached only from
// LabelsPage's "Print Sheet" button, so it isn't in the nav.
function LabelSheetPageContent() {
  const [searchParams] = useSearchParams();
  const [labels, setLabels] = useState<AssetLabel[]>([]);
  const [errors, setErrors] = useState<{ asset_id: number; error: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const ids = (searchParams.get('ids') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number);
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    gearApi.getAssetLabels(ids).then(result => {
      if (isApiFailure(result)) {
        setLoadError(result.error);
      } else {
        setLabels(result.data.labels);
        setErrors(result.data.errors);
      }
      setLoading(false);
    });
  }, [searchParams]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header no-print">
        <h1>Print Labels</h1>
        <button className="btn-primary" onClick={() => window.print()}>Print</button>
      </div>

      {loadError && <div className="alert alert-error no-print">{loadError}</div>}

      {errors.length > 0 && (
        <div className="alert alert-error no-print">
          {errors.length} asset(s) could not be labelled: {errors.map(e => e.error).join('; ')}
        </div>
      )}

      <div className="label-sheet">
        {labels.map(label => (
          <div className="label-card" key={label.asset_id}>
            <div dangerouslySetInnerHTML={{ __html: label.svg }} />
            <div className="label-serial">{label.serial_number}</div>
          </div>
        ))}
      </div>

      {labels.length === 0 && !loadError && (
        <p className="no-print">Nothing to print — select some assets on the Labels page first.</p>
      )}
    </div>
  );
}

export default function LabelSheetPage() {
  return (
    <ErrorBoundary>
      <LabelSheetPageContent />
    </ErrorBoundary>
  );
}
