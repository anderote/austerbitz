// Slice composited component atlases into the pose-system layout the runtime
// reads. Companion to scripts/build-soldier-components.mjs.
//
// Reads public/components/kits/line-infantry.json, walks every pose entry,
// and slices its (possibly per-frame) atlas into the pose tree at:
//   public/sprites/poses/<kind>/<runtimePose>/<DIR>/0/<frameIdx>.png

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SPRITES = resolve(REPO_ROOT, 'public', 'sprites');
const POSES_OUT = resolve(SPRITES, 'poses');
const KIT_PATH = resolve(REPO_ROOT, 'public', 'components', 'kits', 'line-infantry.json');

const CELL_W = 32;
const CELL_H = 36;

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
const CELLS_BY_DIR = new Map(COMPASS_CELLS.map((c) => [c.dir, c]));

const KIT_TO_RUNTIME_POSE = {
  'idle':       'idle',
  'make-ready': 'reloading',
  'present':    'aiming',
  'fire':       'firing',
  'walking':    'walking',
  'running':    'running',
  'dying':      'dying',
};
const SKIP_KIT_POSES = new Set(['musket', 'hit']);

export function isMultiFrameOverride(override) {
  if (!override || typeof override !== 'object') return false;
  for (const value of Object.values(override)) {
    if (Array.isArray(value) && value.length > 0) {
      return Array.isArray(value[0]);
    }
  }
  return false;
}

export function frameCountOf(override) {
  let n = 0;
  for (const frames of Object.values(override)) {
    if (Array.isArray(frames)) n = Math.max(n, frames.length);
  }
  return n;
}

export function buildWorkList(kit, kitId) {
  const kindAtlasBase = kit.outputAtlas
    ? kit.outputAtlas.replace(/^public\/sprites\//, '').replace(/\.png$/, '')
    : `${kitId}-components`;
  const work = [];

  // Idle uses the un-suffixed atlas and all 8 facings.
  work.push({
    kind: kitId,
    kitPose: 'idle',
    runtimePose: 'idle',
    atlasFile: `${kindAtlasBase}.png`,
    frameIdx: 0,
    cells: COMPASS_CELLS,
  });

  if (kit.poses && typeof kit.poses === 'object') {
    for (const [kitPose, override] of Object.entries(kit.poses)) {
      if (SKIP_KIT_POSES.has(kitPose)) continue;
      const runtimePose = KIT_TO_RUNTIME_POSE[kitPose];
      if (!runtimePose) {
        console.warn(`[slice-component-atlas] no runtime mapping for kit pose '${kitPose}', skipping`);
        continue;
      }
      const dirsAuthored = Object.keys(override);
      const cells = dirsAuthored
        .map((d) => CELLS_BY_DIR.get(d))
        .filter(Boolean);
      if (isMultiFrameOverride(override)) {
        const n = frameCountOf(override);
        for (let i = 0; i < n; i++) {
          work.push({
            kind: kitId,
            kitPose,
            runtimePose,
            atlasFile: `${kindAtlasBase}-${kitPose}-${i}.png`,
            frameIdx: i,
            cells,
          });
        }
      } else {
        work.push({
          kind: kitId,
          kitPose,
          runtimePose,
          atlasFile: `${kindAtlasBase}-${kitPose}.png`,
          frameIdx: 0,
          cells,
        });
      }
    }
  }

  return work;
}

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
  const kit = JSON.parse(await readFile(KIT_PATH, 'utf8'));
  const work = buildWorkList(kit, kit.id ?? 'line-infantry');

  let written = 0;
  for (const w of work) {
    const srcPath = resolve(SPRITES, w.atlasFile);
    const src = await loadPng(srcPath);
    const expectW = 3 * CELL_W;
    const expectH = 3 * CELL_H;
    if (src.width !== expectW || src.height !== expectH) {
      throw new Error(
        `${w.atlasFile}: expected ${expectW}x${expectH}, got ${src.width}x${src.height}`,
      );
    }
    for (const cell of w.cells) {
      const png = sliceCell(src, cell.col, cell.row);
      const outPath = resolve(POSES_OUT, w.kind, w.runtimePose, cell.dir, '0', `${w.frameIdx}.png`);
      await writePng(outPath, png);
      console.log(`[slice-component-atlas] ${w.runtimePose}/${cell.dir}/${w.frameIdx} ← ${w.atlasFile}`);
      written++;
    }
  }
  console.log(`[slice-component-atlas] done — wrote ${written} sprite${written === 1 ? '' : 's'}`);
}

// Only run main() if this file is executed directly (not imported).
import { fileURLToPath as _fu } from 'node:url';
if (import.meta.url === `file://${process.argv[1]}` || _fu(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('[slice-component-atlas] fatal:', err);
    process.exit(1);
  });
}
