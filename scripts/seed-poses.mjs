// Seed initial pose sprites by slicing the pre-baked atlas PNGs.
//
// Usage (one-shot):
//   node scripts/seed-poses.mjs
//
// Reads:
//   public/sprites/british-line-infantry.png  (33x54, 11x18 cells)
//   public/sprites/cuirassier.png             (45x60, 15x20 cells)
//   public/sprites/cannon-12.png              (51x42, 17x14 cells)
//
// Writes one PNG per compass direction for each kind under:
//   public/sprites/poses/<kind>/idle/<DIR>/0/0.png
//
// Cell coordinates and cell sizes are mirrored from the corresponding TS
// modules (POSE_CELLS in src/render/{british-soldier,cuirassier,cannon-12}-sprite.ts).
// Compass order is N, NE, E, SE, S, SW, W, NW (clockwise from north).
//
// Idempotent: re-running overwrites the slice PNGs.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SPRITES = resolve(REPO_ROOT, 'public', 'sprites');
const POSES_OUT = resolve(SPRITES, 'poses');

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Each entry's `cells` is in COMPASS order. Source: POSE_CELLS in the
 * matching src/render/*-sprite.ts file.
 */
// Cuirassier is no longer seeded from the legacy combined-atlas — see
// scripts/draw-cuirassier-poses.mjs (32x24 multi-pose).
const KINDS = [
  {
    kind: 'line-infantry',
    sourcePng: 'british-line-infantry.png',
    cellW: 11,
    cellH: 18,
    // POSE_CELLS from src/render/british-soldier-sprite.ts
    cells: [
      { col: 1, row: 2 }, // N
      { col: 2, row: 0 }, // NE
      { col: 2, row: 1 }, // E
      { col: 2, row: 2 }, // SE
      { col: 1, row: 1 }, // S
      { col: 0, row: 2 }, // SW
      { col: 0, row: 1 }, // W
      { col: 0, row: 0 }, // NW
    ],
  },
  {
    kind: 'cannon-12',
    sourcePng: 'cannon-12.png',
    cellW: 17,
    cellH: 14,
    // CANNON_POSE_CELLS from src/render/cannon-12-sprite.ts
    cells: [
      { col: 1, row: 2 }, // N
      { col: 2, row: 0 }, // NE
      { col: 2, row: 1 }, // E
      { col: 2, row: 2 }, // SE
      { col: 1, row: 1 }, // S
      { col: 0, row: 2 }, // SW
      { col: 0, row: 1 }, // W
      { col: 0, row: 0 }, // NW
    ],
  },
];

async function loadPng(path) {
  const buf = await readFile(path);
  return PNG.sync.read(buf);
}

function sliceCell(srcPng, cellCol, cellRow, cellW, cellH) {
  const srcX = cellCol * cellW;
  const srcY = cellRow * cellH;
  const out = new PNG({ width: cellW, height: cellH });
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const sIdx = ((srcY + y) * srcPng.width + (srcX + x)) * 4;
      const dIdx = (y * cellW + x) * 4;
      out.data[dIdx + 0] = srcPng.data[sIdx + 0];
      out.data[dIdx + 1] = srcPng.data[sIdx + 1];
      out.data[dIdx + 2] = srcPng.data[sIdx + 2];
      out.data[dIdx + 3] = srcPng.data[sIdx + 3];
    }
  }
  return out;
}

async function writePng(path, png) {
  await mkdir(dirname(path), { recursive: true });
  const buf = PNG.sync.write(png);
  await writeFile(path, buf);
}

async function main() {
  for (const k of KINDS) {
    const srcPath = resolve(SPRITES, k.sourcePng);
    const src = await loadPng(srcPath);

    const expectW = 3 * k.cellW;
    const expectH = 3 * k.cellH;
    if (src.width !== expectW || src.height !== expectH) {
      throw new Error(
        `${k.sourcePng}: expected ${expectW}x${expectH}, got ${src.width}x${src.height}`,
      );
    }

    for (let i = 0; i < COMPASS.length; i++) {
      const dir = COMPASS[i];
      const cell = k.cells[i];
      const png = sliceCell(src, cell.col, cell.row, k.cellW, k.cellH);
      const outPath = resolve(POSES_OUT, k.kind, 'idle', dir, '0', '0.png');
      await writePng(outPath, png);
      console.log(`[seed-poses] wrote ${outPath}`);
    }
  }
  console.log(`[seed-poses] done — seeded ${KINDS.length} kinds x ${COMPASS.length} dirs`);
}

main().catch((err) => {
  console.error('[seed-poses] fatal:', err);
  process.exit(1);
});
