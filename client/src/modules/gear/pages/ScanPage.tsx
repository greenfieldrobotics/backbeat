import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import CameraBarcodeScanner from '../../../core/scanning/CameraBarcodeScanner';
import { extractSerialFromScan } from '../../../core/scanning/scanValue';
import ErrorBoundary from '../components/ErrorBoundary';

// Camera scanning entry point (G4.1). A technician's phone has no dedicated scanner
// hardware, so this page uses the device camera instead — decoding lands on the same
// `/a/:serial` route as a hardware scan or a printed label, per Phase 5.
function ScanPageContent() {
  const navigate = useNavigate();

  const handleDetect = useCallback(
    (rawValue: string) => {
      navigate(`/a/${encodeURIComponent(extractSerialFromScan(rawValue))}`);
    },
    [navigate]
  );

  return (
    <div>
      <div className="page-header">
        <h1>Scan Asset</h1>
      </div>
      <p>Point the camera at a QR code or DataMatrix label.</p>
      <CameraBarcodeScanner onDetect={handleDetect} />
    </div>
  );
}

export default function ScanPage() {
  return (
    <ErrorBoundary>
      <ScanPageContent />
    </ErrorBoundary>
  );
}
