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
const PALETTE = {
  '.': [0, 0, 0, 0],         // transparent
  'k': [22, 18, 28, 255],    // shako / boots / outline
  'r': [178, 48, 56, 255],   // line-infantry red coat
  'd': [120, 28, 36, 255],   // red shadow / coat tail
  'B': [54, 76, 162, 255],   // blue facings (lapels, back panel)
  'D': [30, 44, 108, 255],   // blue shadow (reserved)
  'w': [236, 232, 222, 255], // white (crossbelts, trousers)
  'f': [228, 188, 156, 255], // skin
  'F': [186, 142, 108, 255], // skin shadow
  'y': [232, 188, 72, 255],  // gold (shako plate, belt buckle)
  'p': [220, 60, 64, 255],   // shako plume (slightly brighter than coat)
  'm': [86, 56, 36, 255],    // dark wood (musket stock)
  's': [60, 56, 52, 110],    // ground shadow (semi-transparent)
  'W': [255, 255, 255, 255], // tint sample cell
};

// --- Pose grids (11 wide x 18 tall) -------------------------------------------
// Front: facing viewer. Musket held in soldier's right hand (viewer's left),
// barrel running up alongside the shoulder, butt resting at the right foot.
// Where the shako brim is wider than the musket column, the brim covers the
// musket — matching the reference's "order arms" silhouette.
const POSE_FRONT = [
  '....p......',
  '..mkkkkk...',
  '..mkkykk...',
  '..mkkkkk...',
  '..mkkkkk...',
  '..kkkkkkk..',
  '..m.fFf....',
  '..mrrrrr...',
  '..mrBBBr...',
  '..mrwBwr...',
  '..mrBwBr...',
  '..mrwBwr...',
  '..mrryrr...',
  '..mdrrrd...',
  '..mww.ww...',
  '..mww.ww...',
  '..mkk.kk...',
  '..sssssss..',
];

// Front 3/4 right: head/plate offset right, asymmetric crossbelt.
// Musket still on the soldier's right (viewer's left), passing behind the brim.
const POSE_FRONT_DIAG = [
  '....p......',
  '..mkkkkk...',
  '..mkkyky...',
  '..mkkkkk...',
  '..mkkkkk...',
  '..kkkkkkk..',
  '..m.fFFf...',
  '..mrrrrrr..',
  '..mrBBBBr..',
  '..mrwBBwr..',
  '..mrBwBBr..',
  '..mrwBBwr..',
  '..mrryrr...',
  '..mdrrrrd..',
  '..mww.ww...',
  '..mww.ww...',
  '..mkk.kk...',
  '..sssssss..',
];

// Back 3/4 right: no face plate; blue back panel with white X crossbelts.
// Musket on the soldier's right side, which from the back-3/4 sits on viewer's right.
const POSE_BACK_DIAG = [
  '......p....',
  '...kkkkkm..',
  '...kkkkkm..',
  '...kkkkkm..',
  '...kkkkkm..',
  '..kkkkkkm..',
  '....FFF.m..',
  '...rrrrrm..',
  '...rBBBrm..',
  '...rwBwrm..',
  '...rBwBrm..',
  '...rwBwrm..',
  '...rrrrrm..',
  '...drrrdm..',
  '...ww.wwm..',
  '...ww.wwm..',
  '...kk.kkm..',
  '..sssssss..',
];

const POSE_BACK = [
  '....p......',
  '..kkkkkkm..',
  '..kkkkkkm..',
  '..kkkkkkm..',
  '..kkkkkkm..',
  '.kkkkkkkkm.',
  '...w.w..m..',
  '..rrrrrrm..',
  '..rBBBBrm..',
  '..rwBBwrm..',
  '..rwwBwrm..',
  '..rwBBwrm..',
  '..rrrrrrm..',
  '..drrrrdm..',
  '..ww..wwm..',
  '..ww..wwm..',
  '..kk..kkm..',
  '..sssssss..',
];

const POSE_SIDE = [
  '....p......',
  '..mkkkkk...',
  '..mkkykk...',
  '..mkkkkk...',
  '..mkkkkk...',
  '..kkkkkkk..',
  '...fFFfm...',
  '..rrrrrrm..',
  '..rwBBBrm..',
  '..rBwBBmm..',
  '..rwBBBrm..',
  '..rBBBBmm..',
  '..rryrrm...',
  '..drrrrm...',
  '..ww.wwm...',
  '..ww.wwm...',
  '..kk.kkm...',
  '..sssssss..',
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
