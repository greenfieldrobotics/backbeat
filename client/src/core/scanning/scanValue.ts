// Both scanning paths (camera and sentinel-prefixed hardware scanner) resolve to Phase
// 5's `/a/:serial` route — reused as-is rather than building a second lookup path. A
// decoded value may already be a full label URL (once Phase 7 ships printed labels) or a
// bare serial (hand-labelled assets today); this normalizes either into just the serial.
export function extractSerialFromScan(rawValue: string): string {
  const trimmed = rawValue.trim();
  const urlMatch = trimmed.match(/\/a\/([^/?#]+)\/?$/);
  if (urlMatch) {
    return decodeURIComponent(urlMatch[1]);
  }
  return trimmed;
}
