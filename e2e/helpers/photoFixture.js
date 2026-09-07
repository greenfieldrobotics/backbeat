import bwipjs from 'bwip-js';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Generates a real, decodable QR/DataMatrix PNG for Phase 11's photo-resolve e2e
// coverage — this is the only e2e path that exercises Phase 8's actual self-hosted
// decoder (client/src/core/scanning/zxingDecoder.ts) in a real browser; camera
// scanning itself can't be driven headlessly (see 18-gear-scan-anywhere.spec.js).
// bwip-js is the same encoding library server-side labelService.js uses for real
// printed labels, so this fixture is representative of a real label, not a fake.
// Written to a fresh temp file per call: page.setInputFiles() needs a path, not a
// buffer.
export async function writeBarcodePhotoFixture(text, { bcid = 'qrcode' } = {}) {
  const png = await new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      // bwip-js defaults to a FULLY TRANSPARENT background — every "white" pixel is
      // (0,0,0,0), i.e. black RGB with zero alpha. A canvas 2D context's getImageData()
      // (what the browser decoder and every other real barcode reader actually looks
      // at) ignores alpha for binarization, so an uncomposited transparent background
      // reads as black — indistinguishable from the code's own ink. Forcing an opaque
      // white background is what makes this fixture decodable at all, not a cosmetic
      // choice; a real printed label has the same physical opaque background for the
      // same reason.
      { bcid, text, scale: 3, paddingwidth: 4, paddingheight: 4, includetext: false, backgroundcolor: 'FFFFFF' },
      (err, buffer) => (err ? reject(err) : resolve(buffer))
    );
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-photo-fixture-'));
  const filePath = path.join(dir, 'label.png');
  fs.writeFileSync(filePath, png);
  return filePath;
}
