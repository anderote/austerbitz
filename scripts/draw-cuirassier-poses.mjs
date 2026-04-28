// scripts/draw-cuirassier-poses.mjs
//
// Walks POSES from scripts/lib/cuirassier-poses.mjs and emits one PNG per
// (pose, dir, frame) into:
//   public/sprites/poses/cuirassier/<pose>/<dir>/0/<frame>.png
//
// Mirroring (NW=mirror(NE), W=mirror(E), SW=mirror(SE)) is performed at
// emit time so every direction has a real on-disk PNG.
//
// Idempotent: re-running overwrites existing PNGs.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  CELL_W,
  CELL_H,
  POSES,
  SOURCE_DIRS,
  MIRROR_PAIRS,
  renderFrame,
  mirrorFrame,
} from './lib/cuirassier-poses.mjs';
import { loadEdits, lookupEdits, applyEdits } from './lib/pose-frame-edits.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_BASE = resolve(REPO_ROOT, 'public', 'sprites', 'poses', 'cuirassier');

async function writePng(rgba, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  const png = new PNG({ width: CELL_W, height: CELL_H });
  png.data = Buffer.from(rgba);
  const buffer = PNG.sync.write(png);
  await writeFile(outPath, buffer);
}

async function main() {
  const editsTree = await loadEdits(REPO_ROOT);

  async function emitDir(pose, dir, frames) {
    for (let i = 0; i < frames.length; i++) {
      const rgba = renderFrame(frames[i]);
      const edits = lookupEdits(editsTree, 'cuirassier', pose, dir, 0, i);
      const n = applyEdits(rgba, CELL_W, CELL_H, edits);
      if (n > 0) {
        console.log(`[cuirassier] applied ${n} pose-frame edits to ${pose}/${dir}/0/${i}.png`);
      }
      const outPath = resolve(OUT_BASE, pose, dir, '0', `${i}.png`);
      await writePng(rgba, outPath);
    }
  }

  let total = 0;
  for (const pose of Object.keys(POSES)) {
    const data = POSES[pose];
    // Source dirs (authored).
    for (const dir of SOURCE_DIRS) {
      const frames = data[dir];
      if (!frames) throw new Error(`pose '${pose}' missing source dir '${dir}'`);
      await emitDir(pose, dir, frames);
      total += frames.length;
    }
    // Mirrored dirs.
    for (const [dst, src] of MIRROR_PAIRS) {
      const srcFrames = data[src];
      if (!srcFrames) throw new Error(`pose '${pose}' missing source dir '${src}' for mirror '${dst}'`);
      const dstFrames = srcFrames.map(mirrorFrame);
      await emitDir(pose, dst, dstFrames);
      total += dstFrames.length;
    }
  }
  console.log(`Wrote ${total} cuirassier pose frames to ${OUT_BASE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
