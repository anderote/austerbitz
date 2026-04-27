// Pose manifest builder.
//
// Walks `public/sprites/poses/<kind>/<pose>/<dir>/<clipIdx>/<frameIdx>.png`
// and writes `public/sprites/poses/manifest.json` with shape:
//
// {
//   "kinds": {
//     "<kind>": {
//       "poses": {
//         "<pose>": {
//           "dirs": ["S", ...] | ["omni"],
//           "clips": { "<dir>": [["<dir>/<ci>/<frame>.png", ...], ...] }
//         }
//       }
//     }
//   }
// }
//
// - Pose names are validated against POSE_NAMES; unknown poses produce a
//   warning but are skipped (not fatal — authors can stash WIP folders).
// - Direction names are validated against DIRECTIONS. `omni` is mutually
//   exclusive with the compass directions per pose; both present is fatal.
// - Clip and frame indices must parse as non-negative integers; sorted
//   numerically.
// - Pure Node 20 ESM, no third-party deps.
// - If `public/sprites/poses/` is absent, writes `{ "kinds": {} }` and exits 0.
//
// Wired into `npm run dev` and `npm run build` via `npm run build:poses`.

import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', 'public', 'sprites', 'poses');
const OUT = join(ROOT, 'manifest.json');

const POSE_NAMES = new Set([
  'idle', 'walking', 'running', 'aiming', 'firing',
  'reloading', 'flinch', 'ragdoll', 'dying', 'dead',
]);

const COMPASS_DIRS = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
const VALID_DIRS = new Set([...COMPASS_DIRS, 'omni']);

function warn(msg) {
  console.warn(`[build-pose-manifest] WARN: ${msg}`);
}

function fail(msg) {
  console.error(`[build-pose-manifest] ERROR: ${msg}`);
  process.exit(1);
}

async function listSubdirs(p) {
  const entries = await readdir(p, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listFiles(p) {
  const entries = await readdir(p, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

function parseIntStrict(s) {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function main() {
  if (!existsSync(ROOT)) {
    await mkdir(ROOT, { recursive: true });
    await writeFile(OUT, JSON.stringify({ kinds: {} }, null, 2) + '\n', 'utf8');
    console.log(`[build-pose-manifest] no poses dir; wrote empty manifest -> ${OUT}`);
    return;
  }

  const out = { kinds: {} };
  const kinds = (await listSubdirs(ROOT)).sort();

  for (const kind of kinds) {
    const kindDir = join(ROOT, kind);
    const poseDirs = (await listSubdirs(kindDir)).sort();
    const poses = {};

    for (const pose of poseDirs) {
      if (!POSE_NAMES.has(pose)) {
        warn(`unknown pose folder ${kind}/${pose} — skipping`);
        continue;
      }

      const poseDir = join(kindDir, pose);
      const dirNames = (await listSubdirs(poseDir)).sort();

      // Validate direction names.
      for (const d of dirNames) {
        if (!VALID_DIRS.has(d)) {
          warn(`unknown direction folder ${kind}/${pose}/${d} — skipping`);
        }
      }
      const filteredDirs = dirNames.filter((d) => VALID_DIRS.has(d));

      const hasOmni = filteredDirs.includes('omni');
      const hasCompass = filteredDirs.some((d) => COMPASS_DIRS.has(d));
      if (hasOmni && hasCompass) {
        fail(
          `${kind}/${pose}: 'omni' is mutually exclusive with compass directions ` +
          `(found: ${filteredDirs.join(', ')})`,
        );
      }

      // Order dirs canonically: omni alone, otherwise compass order.
      const compassOrder = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const orderedDirs = hasOmni
        ? ['omni']
        : compassOrder.filter((d) => filteredDirs.includes(d));

      const clips = {};
      for (const dir of orderedDirs) {
        const dirPath = join(poseDir, dir);
        const clipDirNames = await listSubdirs(dirPath);
        const clipIndices = clipDirNames
          .map((n) => ({ name: n, idx: parseIntStrict(n) }))
          .filter((x) => x.idx !== null)
          .sort((a, b) => a.idx - b.idx);

        const dirClips = [];
        for (const { name: clipName } of clipIndices) {
          const clipPath = join(dirPath, clipName);
          const frameFiles = (await listFiles(clipPath))
            .filter((f) => f.endsWith('.png'))
            .map((f) => ({ name: f, idx: parseIntStrict(f.replace(/\.png$/, '')) }))
            .filter((x) => x.idx !== null)
            .sort((a, b) => a.idx - b.idx);

          if (frameFiles.length === 0) {
            warn(`${kind}/${pose}/${dir}/${clipName} has no numeric frame PNGs — skipping clip`);
            continue;
          }

          const framePaths = frameFiles.map((f) => `${dir}/${clipName}/${f.name}`);
          dirClips.push(framePaths);
        }

        if (dirClips.length === 0) {
          warn(`${kind}/${pose}/${dir} has no clips — skipping direction`);
          continue;
        }

        clips[dir] = dirClips;
      }

      const dirsWithClips = orderedDirs.filter((d) => clips[d]);
      if (dirsWithClips.length === 0) {
        warn(`${kind}/${pose} has no usable directions — skipping pose`);
        continue;
      }

      poses[pose] = { dirs: dirsWithClips, clips };
    }

    if (Object.keys(poses).length > 0) {
      out.kinds[kind] = { poses };
    }
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const kindCount = Object.keys(out.kinds).length;
  console.log(`[build-pose-manifest] wrote ${OUT} (${kindCount} kind${kindCount === 1 ? '' : 's'})`);
}

main().catch((err) => {
  console.error('[build-pose-manifest] fatal:', err);
  process.exit(1);
});
