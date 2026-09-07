// Photograph-and-resolve-later (Phase 11, G4.3) — the browser-only analysis a picked
// photo goes through before anything is sent to the server: decode (Phase 8's
// self-hosted decoder, reused as-is), a content-derived idempotency key, and the
// EXIF capture timestamp if the photo carries one. Kept out of PhotoResolvePage.tsx
// so the component can mock this one module in tests rather than needing jsdom to
// support createImageBitmap/crypto.subtle/wasm, none of which it does.
import { parse as parseExif } from 'exifr';
import { decodeStillImage } from '../../core/scanning/zxingDecoder';
import { extractSerialFromScan } from '../../core/scanning/scanValue';

export interface PhotoAnalysis {
  /** The serial decoded from the photo, or null if no QR/DataMatrix code was found. */
  serial: string | null;
  /**
   * SHA-256 of the file's own bytes, used as the idempotency key (§7.1). Content-derived
   * rather than randomly generated per attempt: the same photo re-uploaded — a retry, a
   * resend, the same camera-roll image picked again later, even in a different session —
   * must produce the SAME key so the server can recognize it as the same submission.
   */
  clientKey: string;
  /** ISO timestamp from the photo's EXIF DateTimeOriginal, or null if absent/unreadable. */
  takenAt: string | null;
}

async function hashFile(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readExifTakenAt(file: Blob): Promise<string | null> {
  try {
    const tags = await parseExif(file, ['DateTimeOriginal']);
    const value = tags?.DateTimeOriginal;
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    // A photo with no EXIF block (e.g. a screenshot, or one stripped by messaging apps)
    // is a normal outcome, not a decode failure — the user states the date instead.
    return null;
  }
}

export async function analyzePhoto(file: Blob): Promise<PhotoAnalysis> {
  const [rawValue, clientKey, takenAt] = await Promise.all([
    decodeStillImage(file),
    hashFile(file),
    readExifTakenAt(file),
  ]);
  return {
    serial: rawValue ? extractSerialFromScan(rawValue) : null,
    clientKey,
    takenAt,
  };
}
