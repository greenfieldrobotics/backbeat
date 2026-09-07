import { useNavigate } from 'react-router-dom';
import { useGlobalScanListener } from './useGlobalScanListener';
import { extractSerialFromScan } from './scanValue';

// Mounted once near the app root (inside the router). Renders nothing — it only wires
// the sentinel listener to navigation, so a scan from a dedicated scanner lands on
// `/a/:serial` from any screen (G4.2), the same route the camera path and printed
// labels use.
export default function GlobalScanListener() {
  const navigate = useNavigate();
  useGlobalScanListener(serial => {
    navigate(`/a/${encodeURIComponent(extractSerialFromScan(serial))}`);
  });
  return null;
}
