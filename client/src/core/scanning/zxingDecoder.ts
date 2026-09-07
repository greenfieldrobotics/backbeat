// The camera-scanning decoder (G4.1). Safari has no native BarcodeDetector — every iOS
// browser is required to use Safari's engine — so relying on the browser's native API
// works in testing on Android/Chrome and is silently dead on every iPhone/iPad in the
// field (§6.3). This always uses the `barcode-detector` package's own ZXing-wasm
// implementation rather than the native API when present, so behaviour is identical on
// both platforms instead of depending on which native implementation (if any) a given
// browser ships.
//
// The decoder's .wasm binary must be served from our own origin, not the package's
// default jsDelivr CDN default — for content-security and load reliability, not offline
// (there is no service worker and never will be, §6.1). `scripts/copy-zxing-wasm.mjs`
// copies it into `public/zxing/` on every `npm install`, and Vite serves `public/`
// verbatim in both dev and the built `dist/`.
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';

// 2D only (G4.1): 1D symbologies are reserved for dedicated scanner hardware, not a
// phone camera in sun and dust. Restricting the format list is also a real decode-speed
// win, so it's deliberate rather than accepting the library's scan-everything default.
const CAMERA_FORMATS = ['qr_code', 'data_matrix'] as const;

let configured = false;

function ensureWasmConfigured() {
  if (configured) return;
  configured = true;
  prepareZXingModule({
    overrides: {
      locateFile: (path: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : path),
    },
  });
}

export function createCameraBarcodeDetector(): BarcodeDetector {
  ensureWasmConfigured();
  return new BarcodeDetector({ formats: [...CAMERA_FORMATS] });
}

// Photograph-and-resolve-later (Phase 11, G4.3) decodes a still image instead of a
// live camera frame — deliberately the SAME decoder as createCameraBarcodeDetector()
// above, not a second one: `BarcodeDetector.detect()` accepts an ImageBitmap exactly
// as it accepts a <video> element, so nothing about the self-hosted wasm setup or the
// 2D-only format restriction changes for this path. Returns the first decoded value,
// or null if the image contains no readable QR/DataMatrix code — a normal outcome (a
// blurry or mis-framed photo), not a thrown error.
export async function decodeStillImage(file: Blob): Promise<string | null> {
  const detector = createCameraBarcodeDetector();
  const bitmap = await createImageBitmap(file);
  try {
    const barcodes = await detector.detect(bitmap);
    return barcodes.length > 0 ? barcodes[0].rawValue : null;
  } finally {
    bitmap.close();
  }
}
