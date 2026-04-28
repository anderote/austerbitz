// scripts/draw-line-infantry-walking.mjs
//
// Hand-drawn walk-cycle trousers for line infantry. Replaces the row-shift
// placeholders emitted by seed-line-infantry-locomotion.mjs with proper
// per-leg lift animation that respects the soldier's actual leg columns.
//
// The trouser silhouette per facing is 4 px wide × 5 rows tall (or 2×5 for
// E/W side views). The breeches occupy rows 24–25 and stay locked to the
// coat hem; the gaiter/boot rows (26–28) are split into the soldier's two
// legs, which alternate lifting on F1 and F3.
//
// Reads:   public/sprites/components/uniform/lower/trousers/<facing>.png
// Writes:  public/sprites/components/uniform/lower/trousers/<facing>-walk-{0..3}.png

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TROUSERS_DIR = resolve(
  REPO_ROOT,
  'public', 'sprites', 'components', 'uniform', 'lower', 'trousers',
);

const CELL_W = 32;
const CELL_H = 36;
const TRANS = [0, 0, 0, 0];
const LEG_TOP = 26;     // first row of "lower leg" (gaiter)
const LEG_BOTTOM = 28;  // last row of "lower leg" (boot)

// Soldier's two legs as columns on canvas, per facing.
// L = viewer-left columns; R = viewer-right columns.
// Front/back/diagonals share a 4-wide silhouette at cols 14–17; E/W are
// 2-wide profiles offset to one half of that block.
const LEG_COLS = {
  south:     { L: [14, 15], R: [16, 17] },
  southeast: { L: [14, 15], R: [16, 17] },
  southwest: { L: [14, 15], R: [16, 17] },
  north:     { L: [14, 15], R: [16, 17] },
  northeast: { L: [14, 15], R: [16, 17] },
  northwest: { L: [14, 15], R: [16, 17] },
  east:      { L: [16],     R: [17]     },
  west:      { L: [14],     R: [15]     },
};

function getPx(buf, x, y) {
  const i = (y * CELL_W + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}
function setPx(buf, x, y, rgba) {
  const i = (y * CELL_W + x) * 4;
  buf[i] = rgba[0]; buf[i + 1] = rgba[1]; buf[i + 2] = rgba[2]; buf[i + 3] = rgba[3];
}

// Step one leg: clear the leg's original columns at gaiter rows, then redraw
// the gaiter pixels at columns shifted by `dxOut` (outward splay) with the
// foot row left transparent (foot off the ground). Breeches rows untouched.
function stepLeg(idle, cols, dxOut) {
  const out = new Uint8ClampedArray(idle);
  for (const c of cols) {
    setPx(out, c, LEG_TOP,        TRANS);
    setPx(out, c, LEG_TOP + 1,    TRANS);
    setPx(out, c, LEG_BOTTOM,     TRANS);
  }
  for (const c of cols) {
    const nc = c + dxOut;
    setPx(out, nc, LEG_TOP,     getPx(idle, c, LEG_TOP));     // 26 knee/buckle
    setPx(out, nc, LEG_TOP + 1, getPx(idle, c, LEG_TOP + 1)); // 27 gaiter
    // LEG_BOTTOM (row 28) stays cleared = foot lifted
  }
  return out;
}

function rgbaToPng(rgba) {
  const png = new PNG({ width: CELL_W, height: CELL_H });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}

async function readIdle(name) {
  const buf = await readFile(resolve(TROUSERS_DIR, `${name}.png`));
  const png = PNG.sync.read(buf);
  if (png.width !== CELL_W || png.height !== CELL_H) {
    throw new Error(`${name}.png: expected ${CELL_W}×${CELL_H}, got ${png.width}×${png.height}`);
  }
  return new Uint8ClampedArray(png.data);
}

async function emit(name, frameIdx, rgba) {
  const out = resolve(TROUSERS_DIR, `${name}-walk-${frameIdx}.png`);
  await writeFile(out, rgbaToPng(rgba));
}

async function main() {
  let count = 0;
  for (const [facing, cols] of Object.entries(LEG_COLS)) {
    const idle = await readIdle(facing);
    await emit(facing, 0, idle);                          // contact pose
    await emit(facing, 1, stepLeg(idle, cols.L, -1));     // viewer-left leg splays out (foot up)
    await emit(facing, 2, idle);                          // contact pose (recovery beat)
    await emit(facing, 3, stepLeg(idle, cols.R, +1));     // viewer-right leg splays out (foot up)
    count += 4;
  }
  console.log(`Wrote ${count} walk-frame PNGs to ${TROUSERS_DIR}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
