import { useNavigate } from 'react-router-dom';
import { useGlobalScanListener } from './useGlobalScanListener';
import { extractSerialFromScan } from './scanValue';
import { dispatchClaimedScan } from './scanClaim';

// Mounted once near the app root (inside the router). Renders nothing — it only wires
// the sentinel listener to navigation, so a scan from a dedicated scanner lands on
// `/a/:serial` from any screen (G4.2), the same route the camera path and printed
// labels use.
//
// A multi-step scan flow (scan-to-locate, two-scan link — Phase 9) can claim the scan
// stream via scanClaim.ts; when a claim is active, this hands the scan to it instead of
// navigating, so a technician on one of those pages doesn't get bounced to the asset
// lookup route mid-flow.
export default function GlobalScanListener() {
  const navigate = useNavigate();
  useGlobalScanListener(serial => {
    if (dispatchClaimedScan(serial)) return;
    navigate(`/a/${encodeURIComponent(extractSerialFromScan(serial))}`);
  });
  return null;
}
