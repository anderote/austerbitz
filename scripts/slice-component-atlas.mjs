// Slice composited component atlases into the pose-system layout the runtime
// reads. Companion to scripts/build-soldier-components.mjs:
//
//   build-soldier-components.mjs writes:
//     public/sprites/line-infantry-components.png            (idle, 8 dirs)
//     public/sprites/line-infantry-components-make-ready.png (S only authored)
//     public/sprites/line-infantry-components-present.png    (S only authored)
//     public/sprites/line-infantry-components-fire.png       (S only authored)
//
// This script slices each into:
//   public/sprites/poses/line-infantry/<runtimePose>/<DIR>/0/0.png
//
// where <runtimePose> maps the spec's pose names to the runtime Pose enum:
//   idle       <- components.png            (all 8 dirs)
//   reloading  <- components-make-ready.png (S only)
//   aiming     <- components-present.png    (S only)
//   firing     <- components-fire.png       (S only)
//
// The pose-atlas resolver falls back to idle when a non-idle pose is missing
// for a given direction, so unauthored dirs (N/E/etc. for fire) resolve to
// the idle sprite at runtime.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SPRITES = resolve(REPO_ROOT, 'public', 'sprites');
const POSES_OUT = resolve(SPRITES, 'poses');

const CELL_W = 16;
const CELL_H = 36;

// 3x3 cell grid layout used by the components atlas. Mirrors POSE_CELLS in
// src/render/british-soldier-sprite.ts.
const COMPASS_CELLS = [
  { dir: 'N',  col: 1, row: 2 },
  { dir: 'NE', col: 2, row: 0 },
  { dir: 'E',  col: 2, row: 1 },
  { dir: 'SE', col: 2, row: 2 },
  { dir: 'S',  col: 1, row: 1 },
  { dir: 'SW', col: 0, row: 2 },
  { dir: 'W',  col: 0, row: 1 },
  { dir: 'NW', col: 0, row: 0 },
];

const S_CELL = COMPASS_CELLS.find((c) => c.dir === 'S');

const SOURCES = [
  {
    kind: 'line-infantry',
    pose: 'idle',
    file: 'british-line-infantry-components.png',
    cells: COMPASS_CELLS,
  },
  {
    kind: 'line-infantry',
    pose: 'reloading',
    file: 'british-line-infantry-components-make-ready.png',
    cells: [S_CELL],
  },
  {
    kind: 'line-infantry',
    pose: 'aiming',
    file: 'british-line-infantry-components-present.png',
    cells: [S_CELL],
  },
  {
    kind: 'line-infantry',
    pose: 'firing',
    file: 'british-line-infantry-components-fire.png',
    cells: [S_CELL],
  },
];

async function loadPng(path) {
  const buf = await readFile(path);
  return PNG.sync.read(buf);
}

function sliceCell(src, col, row) {
  const srcX = col * CELL_W;
  const srcY = row * CELL_H;
  const out = new PNG({ width: CELL_W, height: CELL_H });
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const sIdx = ((srcY + y) * src.width + (srcX + x)) * 4;
      const dIdx = (y * CELL_W + x) * 4;
      out.data[dIdx + 0] = src.data[sIdx + 0];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return out;
}

async function writePng(path, png) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, PNG.sync.write(png));
}

async function main() {
  let written = 0;
  for (const source of SOURCES) {
    const srcPath = resolve(SPRITES, source.file);
    const src = await loadPng(srcPath);

    const expectW = 3 * CELL_W;
    const expectH = 3 * CELL_H;
    if (src.width !== expectW || src.height !== expectH) {
      throw new Error(
        `${source.file}: expected ${expectW}x${expectH}, got ${src.width}x${src.height}`,
      );
    }

    for (const cell of source.cells) {
      const png = sliceCell(src, cell.col, cell.row);
      const outPath = resolve(POSES_OUT, source.kind, source.pose, cell.dir, '0', '0.png');
      await writePng(outPath, png);
      console.log(`[slice-component-atlas] ${source.pose}/${cell.dir} ← ${source.file}`);
      written++;
    }
  }
  console.log(`[slice-component-atlas] done — wrote ${written} sprite${written === 1 ? '' : 's'}`);
}

main().catch((err) => {
  console.error('[slice-component-atlas] fatal:', err);
  process.exit(1);
});
