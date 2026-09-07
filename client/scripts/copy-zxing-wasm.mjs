// Copies the ZXing decoder's .wasm binary from node_modules into public/zxing/,
// so Vite serves it from our own origin (dev and built dist/) instead of the
// package's default jsDelivr CDN locateFile(). Runs on every `npm install` so the
// file always matches whatever zxing-wasm version `barcode-detector` pulled in —
// see the requirements' §6.3 self-hosting constraint.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(clientRoot, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
const destDir = join(clientRoot, 'public/zxing');
const dest = join(destDir, 'zxing_reader.wasm');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copied ${src} -> ${dest}`);
