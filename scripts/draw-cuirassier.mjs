// Generates a cuirassier (heavy cavalry) sprite sheet matching the runtime
// atlas in src/render/cuirassier-sprite.ts. Bakes British defaults so the
// preview PNG looks like a real unit; runtime atlas keeps marker pixels.
//
// Outputs:
//   public/sprites/cuirassier.png         (native, 45x60)
//   public/sprites/cuirassier-preview.png (6x scale, 270x360)

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = `${__dirname}/../public/sprites`;

const PALETTE = {
  '.': [0, 0, 0, 0],
  'k': [22, 18, 28, 255],
  'h': [110, 75, 45, 255],
  'H': [74, 50, 30, 255],
  'f': [228, 188, 156, 255],
  'F': [186, 142, 108, 255],
  'g': [180, 188, 200, 255],
  'm': [60, 40, 26, 255],
  'w': [236, 232, 222, 255],
  'W': [255, 255, 255, 255],
  'P': [180, 40, 50, 255],   // British red coat
  'S': [50, 60, 140, 255],   // British blue facings
};

const POSE_FRONT = [
  '...............',
  '.......S.......',
  '......SSS......',
  '......kkk......',
  '.....kkgkk.....',
  '......fFf......',
  '.....SPPPS.....',
  '....SPPPPPS....',
  '....SPPSPPS....',
  '....mwwwwwm....',
  '...hhhhhhhhh...',
  '..hhhhhhhhhhh..',
  '..hhhhhhhhhhh..',
  '..hhhhhhhhhhh..',
  '..HHHHHHHHHHH..',
  '..h..h.h..h....',
  '..h..h.h..h....',
  '..k..k.k..k....',
  '..k..k.k..k....',
  '...............',
];

const POSE_FRONT_DIAG = [
  '...............',
  '......S........',
  '.....SSS.......',
  '.....kkk.......',
  '....kkgkk......',
  '.....fF........',
  '.....SPPSP.....',
  '....SPPPPPS....',
  '....SPPSPPS....',
  '....mwwwwwm....',
  '...hhhhhhhhh...',
  '..hhhhhhhhhhh..',
  '..hhhhhhhhhhhh.',
  '..hhhhhhhhhhhh.',
  '..HHHHHHHHHHHH.',
  '..h..h.h..hh...',
  '..h..h.h..hh...',
  '..k..k.k..kk...',
  '..k..k.k..kk...',
  '...............',
];

const POSE_SIDE = [
  '..............g',
  '.............g.',
  '............g..',
  '......SS...g...',
  '.....SSSS.g....',
  '.....kkkk.g....',
  '....kkggk.g....',
  '....kfFkk.g....',
  '....SPPS..g....',
  '...SPPPPSPS....',
  '...SPPPPSP.....',
  '...mwwwwwm.....',
  '..hhhhhhhhh....',
  '.hhhhhhhhhhh...',
  'hhhhhhhhhhhhh..',
  'Hhhhhhhhhhhfh..',
  '.HHHHHHHHHH....',
  '.h....hh.h.h...',
  '.h....hh.h.h...',
  '.k....kk.k.k...',
];

const POSE_BACK = [
  '...............',
  '.......S.......',
  '......SSS......',
  '......kkk......',
  '.....kkgkk.....',
  '......kkk......',
  '.....SPPPS.....',
  '....SPPPPPS....',
  '....SPPSPPS....',
  '....mwwwwwm....',
  '...hhhhhhhhh...',
  '..hhhhhhhhhhh..',
  '..hhhhhhhhhhh..',
  '..HHHHHHHHHHH..',
  '..H..H.H..H....',
  '..H..H.H..H....',
  '..H..H.H..H....',
  '..k..k.k..k....',
  '..k..k.k..k....',
  '...............',
];

const POSE_BACK_DIAG = [
  '...............',
  '......S........',
  '.....SSS.......',
  '.....kkk.......',
  '....kkgkk......',
  '.....kkk.......',
  '....SPPSP......',
  '....SPPPPPS....',
  '....SPPSPPS....',
  '....mwwwwwm....',
  '...hhhhhhhhh...',
  '..hhhhhhhhhhh..',
  '..hhhhhhhhhhhh.',
  '..HHHHHHHHHHHH.',
  '..H..H.H..HH...',
  '..H..H.H..HH...',
  '..H..H.H..HH...',
  '..k..k.k..kk...',
  '..k..k.k..kk...',
  '...............',
];

const CELL_W = 15;
const CELL_H = 20;
const COLS = 3;
const ROWS = 3;
const SHEET_W = CELL_W * COLS;
const SHEET_H = CELL_H * ROWS;

for (const [name, p] of [
  ['POSE_FRONT', POSE_FRONT],
  ['POSE_FRONT_DIAG', POSE_FRONT_DIAG],
  ['POSE_SIDE', POSE_SIDE],
  ['POSE_BACK', POSE_BACK],
  ['POSE_BACK_DIAG', POSE_BACK_DIAG],
]) {
  if (p.length !== CELL_H) throw new Error(`${name}: expected ${CELL_H} rows, got ${p.length}`);
  for (let i = 0; i < p.length; i++) {
    if (p[i].length !== CELL_W) {
      throw new Error(`${name}[${i}]: expected ${CELL_W} cols, got ${p[i].length} ("${p[i]}")`);
    }
  }
}

const TINT_CELL = Array.from({ length: CELL_H }, () => 'W'.repeat(CELL_W));

function blitCell(buf, bufW, cellX, cellY, pose, mirror) {
  for (let y = 0; y < CELL_H; y++) {
    const row = pose[y];
    for (let x = 0; x < CELL_W; x++) {
      const ch = mirror ? row[CELL_W - 1 - x] : row[x];
      const rgba = PALETTE[ch] ?? PALETTE['.'];
      const i = ((cellY + y) * bufW + (cellX + x)) * 4;
      buf[i + 0] = rgba[0];
      buf[i + 1] = rgba[1];
      buf[i + 2] = rgba[2];
      buf[i + 3] = rgba[3];
    }
  }
}

const sheet = new Uint8Array(SHEET_W * SHEET_H * 4);
blitCell(sheet, SHEET_W, 0,           0,           POSE_BACK_DIAG,  true);
blitCell(sheet, SHEET_W, CELL_W,      0,           TINT_CELL,       false);
blitCell(sheet, SHEET_W, 2 * CELL_W,  0,           POSE_BACK_DIAG,  false);
blitCell(sheet, SHEET_W, 0,           CELL_H,      POSE_SIDE,       true);
blitCell(sheet, SHEET_W, CELL_W,      CELL_H,      POSE_FRONT,      false);
blitCell(sheet, SHEET_W, 2 * CELL_W,  CELL_H,      POSE_SIDE,       false);
blitCell(sheet, SHEET_W, 0,           2 * CELL_H,  POSE_FRONT_DIAG, true);
blitCell(sheet, SHEET_W, CELL_W,      2 * CELL_H,  POSE_BACK,       false);
blitCell(sheet, SHEET_W, 2 * CELL_W,  2 * CELL_H,  POSE_FRONT_DIAG, false);

function scale(src, w, h, factor) {
  const dw = w * factor, dh = h * factor;
  const dst = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = (y / factor) | 0;
    for (let x = 0; x < dw; x++) {
      const sx = (x / factor) | 0;
      const si = (sy * w + sx) * 4;
      const di = (y * dw + x) * 4;
      dst[di + 0] = src[si + 0];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return { data: dst, width: dw, height: dh };
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/cuirassier.png`, encodePng(SHEET_W, SHEET_H, sheet));
const SCALE = 6;
const big = scale(sheet, SHEET_W, SHEET_H, SCALE);
writeFileSync(`${OUT_DIR}/cuirassier-preview.png`, encodePng(big.width, big.height, big.data));

console.log(`wrote ${OUT_DIR}/cuirassier.png (${SHEET_W}x${SHEET_H})`);
console.log(`wrote ${OUT_DIR}/cuirassier-preview.png (${big.width}x${big.height})`);
