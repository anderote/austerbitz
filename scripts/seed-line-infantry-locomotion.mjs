// scripts/seed-line-infantry-locomotion.mjs
//
// Generates placeholder walk/run trousers PNGs and patches the components
// index + line-infantry kit so the multi-frame pipeline has assets to chew on.
//
// Outputs:
//   public/sprites/components/uniform/lower/trousers/<facing>-walk-{0..3}.png
//   public/sprites/components/uniform/lower/trousers/<facing>-run-{0..5}.png
// Patches:
//   public/components/index.json    (adds 80 component entries)
//   public/components/kits/line-infantry.json (adds walking + running poses)
//
// Idempotent: re-running overwrites PNGs and resets walking/running entries.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CELL_W,
  CELL_H,
  shiftLegs,
  shiftHalfLegs,
  readRgba,
  rgbaToPng,
} from './lib/leg-shift.mjs';

void CELL_W; void CELL_H; // imported for parity; not directly used

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const COMPONENT_ROOT = resolve(REPO_ROOT, 'public', 'sprites', 'components');
const TROUSERS_DIR = resolve(COMPONENT_ROOT, 'uniform', 'lower', 'trousers');
const INDEX_JSON = resolve(REPO_ROOT, 'public', 'components', 'index.json');
const KIT_JSON   = resolve(REPO_ROOT, 'public', 'components', 'kits', 'line-infantry.json');

const FACINGS = [
  { abbr: 'N',  full: 'north'     },
  { abbr: 'NE', full: 'northeast' },
  { abbr: 'E',  full: 'east'      },
  { abbr: 'SE', full: 'southeast' },
  { abbr: 'S',  full: 'south'     },
  { abbr: 'SW', full: 'southwest' },
  { abbr: 'W',  full: 'west'      },
  { abbr: 'NW', full: 'northwest' },
];

const WALK_FRAMES = 4;
function walkFrame(rgba, frameIdx) {
  switch (frameIdx) {
    case 0: return new Uint8ClampedArray(rgba);
    case 1: return shiftHalfLegs(rgba, 'left', 1);
    case 2: return new Uint8ClampedArray(rgba);
    case 3: return shiftHalfLegs(rgba, 'right', 1);
  }
  throw new Error(`walkFrame: bad index ${frameIdx}`);
}

// Smooth alternating run cycle: each leg traces a 0→1→2→1→0 lift arc, with
// the right leg offset two frames behind the left. Cyclically every leg rises,
// peaks, and falls once per cycle — no jumps, no asymmetric in-air frames.
const RUN_LEFT_LIFT  = [1, 2, 1, 0, 0];
const RUN_RIGHT_LIFT = [0, 0, 1, 2, 1];
const RUN_FRAMES = RUN_LEFT_LIFT.length;

// Side-on facings (E/W) draw both legs at nearly the same x, so splitting the
// trouser sprite at col 16 doesn't separate "left leg" from "right leg" — the
// alternating half-shift collapses to a degenerate cycle. For those, fall back
// to a smooth whole-leg vertical bob over the same cycle length.
const RUN_SIDE_BOB = [0, 1, 2, 1, 0];
const SIDE_FACINGS = new Set(['E', 'W']);

function runFrame(rgba, frameIdx, facingAbbr) {
  if (frameIdx < 0 || frameIdx >= RUN_FRAMES) {
    throw new Error(`runFrame: bad index ${frameIdx}`);
  }
  if (SIDE_FACINGS.has(facingAbbr)) {
    return shiftLegs(rgba, RUN_SIDE_BOB[frameIdx]);
  }
  let out = shiftHalfLegs(rgba, 'left', RUN_LEFT_LIFT[frameIdx]);
  out = shiftHalfLegs(out, 'right', RUN_RIGHT_LIFT[frameIdx]);
  return out;
}

async function emitFrame(facingFull, prefix, frameIdx, rgba) {
  const outPath = resolve(TROUSERS_DIR, `${facingFull}-${prefix}-${frameIdx}.png`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, rgbaToPng(rgba));
  return `uniform/lower/trousers/${facingFull}-${prefix}-${frameIdx}.png`;
}

function indexEntry(componentId, facingAbbr, relPath) {
  return {
    id: componentId,
    type: 'uniform',
    category: 'lower',
    facings: [facingAbbr],
    path: relPath,
  };
}

function trousersIdleId(facingFull) {
  return `trousers-${facingFull}`;
}

function trousersFrameId(facingFull, prefix, frameIdx) {
  return `trousers-${facingFull}-${prefix}-${frameIdx}`;
}

async function main() {
  const newEntries = [];
  for (const f of FACINGS) {
    const baseRgba = await readRgba(resolve(TROUSERS_DIR, `${f.full}.png`));
    for (let i = 0; i < WALK_FRAMES; i++) {
      const frame = walkFrame(baseRgba, i);
      const path = await emitFrame(f.full, 'walk', i, frame);
      newEntries.push(indexEntry(trousersFrameId(f.full, 'walk', i), f.abbr, path));
    }
    for (let i = 0; i < RUN_FRAMES; i++) {
      const frame = runFrame(baseRgba, i, f.abbr);
      const path = await emitFrame(f.full, 'run', i, frame);
      newEntries.push(indexEntry(trousersFrameId(f.full, 'run', i), f.abbr, path));
    }
  }
  console.log(`Wrote ${newEntries.length} trousers frame PNGs.`);

  const idx = JSON.parse(await readFile(INDEX_JSON, 'utf8'));
  if (!Array.isArray(idx.components)) {
    throw new Error('index.json: expected components array');
  }
  idx.components = idx.components.filter((c) => {
    if (typeof c.id !== 'string') return true;
    return !/^trousers-(north|northeast|east|southeast|south|southwest|west|northwest)-(walk|run)-\d+$/.test(c.id);
  });
  idx.components.push(...newEntries);
  await writeFile(INDEX_JSON, JSON.stringify(idx, null, 2) + '\n');
  console.log(`Patched ${INDEX_JSON} (+${newEntries.length} entries).`);

  const kit = JSON.parse(await readFile(KIT_JSON, 'utf8'));
  if (!kit.poses || typeof kit.poses !== 'object') kit.poses = {};

  // Build the per-direction frame entries for a locomotion pose. Preserves any
  // existing `{ layers, weapon }` wrapper for a facing — only the `layers`
  // field is replaced — so per-pose weapon attachment overrides authored on
  // top of the seed (e.g. via the components editor) survive a re-seed.
  function buildPoseFrames(poseId, prefix, frameCount) {
    const out = {};
    const existing = (kit.poses && kit.poses[poseId]) || {};
    for (const f of FACINGS) {
      const facingCfg = kit.facings && kit.facings[f.abbr];
      if (!facingCfg || !Array.isArray(facingCfg.layers)) {
        throw new Error(`kit.facings.${f.abbr}.layers missing`);
      }
      const baseLayers = facingCfg.layers;
      const trousersIdx = baseLayers.findIndex((id) => id === trousersIdleId(f.full));
      if (trousersIdx < 0) {
        throw new Error(`kit.facings.${f.abbr}.layers does not contain '${trousersIdleId(f.full)}'`);
      }
      const frames = [];
      for (let i = 0; i < frameCount; i++) {
        const layers = baseLayers.slice();
        layers[trousersIdx] = trousersFrameId(f.full, prefix, i);
        frames.push(layers);
      }
      const prev = existing[f.abbr];
      if (prev && !Array.isArray(prev) && typeof prev === 'object' && prev.weapon) {
        out[f.abbr] = { layers: frames, weapon: prev.weapon };
      } else {
        out[f.abbr] = frames;
      }
    }
    return out;
  }

  // Capture any hand-authored bob blocks before we rebuild the pose entries,
  // so re-seeding doesn't clobber tweaks made via the editor or by hand.
  const prevWalkingBob = kit.poses.walking && kit.poses.walking.bob;
  const prevRunningBob = kit.poses.running && kit.poses.running.bob;

  kit.poses.walking = buildPoseFrames('walking', 'walk', WALK_FRAMES);
  kit.poses.running = buildPoseFrames('running', 'run', RUN_FRAMES);

  // Default body bobs: walking lifts 1px on each leg-pass frame (twice per
  // cycle); running traces a smooth 0→1→2→1→0 arc once per cycle, peaking
  // at the passing frame where both legs are mid-stride.
  kit.poses.walking.bob = prevWalkingBob ?? { body: [0, 1, 0, 1] };
  kit.poses.running.bob = prevRunningBob ?? { body: [0, 1, 2, 1, 0] };

  await writeFile(KIT_JSON, JSON.stringify(kit, null, 2) + '\n');
  console.log(`Patched ${KIT_JSON} (walking + running).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
