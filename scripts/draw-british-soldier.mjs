// Generates a British line-infantry sprite sheet in the chunky retro style of
// classic RTS unit art (red coatee with blue facings, white crossbelts, white
// trousers, tall black shako with red plume and gold plate).
//
// Outputs:
//   public/sprites/british-line-infantry.png          (native, 33x54)
//   public/sprites/british-line-infantry-preview.png  (6x scale, 198x324)

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = `${__dirname}/../public/sprites`;

// --- Palette (RGBA 0..255) ----------------------------------------------------
// `P` (primary) / `S` (secondary) bake British defaults here so the static PNG
// shows recognizable colors. The runtime atlas in TypeScript emits magenta /
// cyan markers and lets the shader substitute per-team colors.
const PALETTE = {
  '.': [0, 0, 0, 0],         // transparent
  'k': [22, 18, 28, 255],    // shako / boots / outline
  'w': [236, 232, 222, 255], // white (crossbelts, breeches)
  'f': [228, 188, 156, 255], // skin
  'F': [186, 142, 108, 255], // skin shadow
  'y': [232, 188, 72, 255],  // brass (shako plate)
  'm': [86, 56, 36, 255],    // wood (musket stock)
  'M': [56, 36, 22, 255],    // dark wood (musket butt)
  'g': [180, 188, 200, 255], // steel (bayonet, barrel)
  's': [60, 56, 52, 110],    // ground shadow (semi-transparent)
  'W': [255, 255, 255, 255], // tint sample cell
  'P': [180, 40, 50, 255],   // PRIMARY — British red coat (markers in runtime)
  'S': [50, 60, 140, 255],   // SECONDARY — British blue facings (markers in runtime)
};

// --- Pose grids (11 wide x 18 tall) -------------------------------------------
// Soldier silhouette is centered roughly cols 4-8. Musket is held vertically
// alongside the soldier's left arm with the bayonet rising above the shako;
// for back-facing poses the musket mirrors to viewer-right.
const POSE_FRONT = [
  '.g.........', // 0  bayonet tip
  '.g.........', // 1  bayonet
  '.g....S....', // 2  plume tip
  '.g...SSS...', // 3  plume base
  '.g...kkk...', // 4  shako top
  '.g...kyk...', // 5  shako with brass plate
  '.g...kkk...', // 6  shako body
  '.g..kkkkk..', // 7  shako brim
  '.g...fFf...', // 8  face
  '.m...SSS...', // 9  collar (secondary)
  '.m..wPPPw..', // 10 shoulders + cross-belt anchors
  '.m..PwPwP..', // 11 chest, belts crossing in
  '.m..PPwPP..', // 12 chest, belt intersection
  '.m..PwPwP..', // 13 chest, belts crossing out
  '.m..SPPPS..', // 14 turnbacks (secondary corners)
  '.M...www...', // 15 breeches
  '.M...k.k...', // 16 gaiters
  '.....sss...', // 17 shadow
];

const POSE_FRONT_DIAG = [
  '.g.........',
  '.g.........',
  '.g.....S...',
  '.g....SSS..',
  '.g....kkk..',
  '.g....kky..',
  '.g....kkk..',
  '.g...kkkkk.',
  '.g....fF...',
  '.m...SPPS..',
  '.m..wPPPSw.',
  '.m..PwPwSP.',
  '.m..PPwPSP.',
  '.m..PSPwSP.',
  '.m..SPPPSP.',
  '.M...www...',
  '.M...k.k...',
  '.....sss...',
];

const POSE_SIDE = [
  '.g.........',
  '.g.........',
  '.g.....S...',
  '.g....SSS..',
  '.g....kkk..',
  '.g....kyk..',
  '.g....kkk..',
  '.g...kkkkk.',
  '.g.....fF..',
  '.m....SPS..',
  '.m....wPP..',
  '.m....PwS..',
  '.m....PPP..',
  '.m....PwS..',
  '.m....SPS..',
  '.M....www..',
  '.M....k.k..',
  '......sss..',
];

const POSE_BACK = [
  '.........g.',
  '.........g.',
  '....S....g.',
  '...SSS...g.',
  '...kkk...g.',
  '...kyk...g.',
  '...kkk...g.',
  '..kkkkk..g.',
  '...kkk...g.',
  '...SSS...m.',
  '..wPPPw..m.',
  '..PwPwP..m.',
  '..PPwPP..m.',
  '..PwPwP..m.',
  '..SPPPS..M.',
  '...www.....',
  '...k.k.....',
  '...sss.....',
];

const POSE_BACK_DIAG = [
  '.........g.',
  '.........g.',
  '...S.....g.',
  '..SSS....g.',
  '..kkk....g.',
  '..kyk....g.',
  '..kkk....g.',
  '.kkkkk...g.',
  '..kkk....g.',
  '..SSS....m.',
  '.wPPPw...m.',
  '.PwPwP...m.',
  '.PPwPP...m.',
  '.PwPwP...m.',
  '.SPPPS...M.',
  '..www......',
  '..k.k......',
  '..sss......',
];

const CELL_W = 11;
const CELL_H = 18;
const COLS = 3;
const ROWS = 3;
const SHEET_W = CELL_W * COLS;
const SHEET_H = CELL_H * ROWS;

for (const [name, p] of [
  ['POSE_FRONT', POSE_FRONT],
  ['POSE_FRONT_DIAG', POSE_FRONT_DIAG],
  ['POSE_BACK_DIAG', POSE_BACK_DIAG],
  ['POSE_BACK', POSE_BACK],
  ['POSE_SIDE', POSE_SIDE],
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
// Layout:
//   [NW back-3/4] [Tint] [NE back-3/4]
//   [W side]      [S front] [E side]
//   [SW front-3/4] [N back] [SE front-3/4]
blitCell(sheet, SHEET_W, 0,           0,           POSE_BACK_DIAG,  true);
blitCell(sheet, SHEET_W, CELL_W,      0,           TINT_CELL,       false);
blitCell(sheet, SHEET_W, 2 * CELL_W,  0,           POSE_BACK_DIAG,  false);
blitCell(sheet, SHEET_W, 0,           CELL_H,      POSE_SIDE,       true);
blitCell(sheet, SHEET_W, CELL_W,      CELL_H,      POSE_FRONT,      false);
blitCell(sheet, SHEET_W, 2 * CELL_W,  CELL_H,      POSE_SIDE,       false);
blitCell(sheet, SHEET_W, 0,           2 * CELL_H,  POSE_FRONT_DIAG, true);
blitCell(sheet, SHEET_W, CELL_W,      2 * CELL_H,  POSE_BACK,       false);
blitCell(sheet, SHEET_W, 2 * CELL_W,  2 * CELL_H,  POSE_FRONT_DIAG, false);

// Nearest-neighbor scale for the preview.
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

// --- Minimal PNG encoder (RGBA8, no interlace) --------------------------------
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
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
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
writeFileSync(`${OUT_DIR}/british-line-infantry.png`, encodePng(SHEET_W, SHEET_H, sheet));
const SCALE = 6;
const big = scale(sheet, SHEET_W, SHEET_H, SCALE);
writeFileSync(`${OUT_DIR}/british-line-infantry-preview.png`, encodePng(big.width, big.height, big.data));

console.log(`wrote ${OUT_DIR}/british-line-infantry.png (${SHEET_W}x${SHEET_H})`);
console.log(`wrote ${OUT_DIR}/british-line-infantry-preview.png (${big.width}x${big.height})`);
