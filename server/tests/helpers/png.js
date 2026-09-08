import zlib from 'zlib';

/**
 * Minimal PNG decoder — just enough to check pixel opacity in tests, so the
 * label-opacity regression test (Phase 12) doesn't need an image-decoding
 * dependency the app itself has no other use for. Handles the one shape bwip-js's
 * `toBuffer` actually produces: 8-bit depth, no interlacing.
 */
export function decodePng(buf) {
  let offset = 8; // skip the 8-byte PNG signature
  let width, height, bitDepth, colorType;
  const idatChunks = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    }
    offset += 8 + len + 4; // length + type + data + crc
  }

  if (bitDepth !== 8) throw new Error(`decodePng: unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`decodePng: unsupported color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset++;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawOffset + x];
      const a = x >= channels ? pixels[rowStart + x - channels] : 0;
      const b = y > 0 ? pixels[rowStart - stride + x] : 0;
      const c = (x >= channels && y > 0) ? pixels[rowStart - stride + x - channels] : 0;
      let val;
      switch (filterType) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          val = rawByte + pr;
          break;
        }
        default:
          throw new Error(`decodePng: unsupported filter type ${filterType}`);
      }
      pixels[rowStart + x] = val & 0xff;
    }
    rawOffset += stride;
  }

  return { width, height, channels, pixels };
}

/** True only if every pixel's alpha channel is fully opaque (255). Color types
 * without an alpha channel (no RGBA) are trivially opaque.
 */
export function isFullyOpaque(buf) {
  const { width, height, channels, pixels } = decodePng(buf);
  if (channels !== 2 && channels !== 4) return true;
  const alphaOffset = channels - 1;
  for (let i = 0; i < width * height; i++) {
    if (pixels[i * channels + alphaOffset] !== 255) return false;
  }
  return true;
}
