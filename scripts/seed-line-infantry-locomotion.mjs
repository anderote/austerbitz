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

const RUN_FRAMES = 6;
function runFrame(rgba, frameIdx) {
  switch (frameIdx) {
    case 0: return new Uint8ClampedArray(rgba);
    case 1: return shiftHalfLegs(rgba, 'left', 1);
    case 2: return shiftLegs(rgba, 1);
    case 3: return shiftHalfLegs(rgba, 'right', 1);
    case 4: return new Uint8ClampedArray(rgba);
    case 5: return shiftHalfLegs(rgba, 'left', 2);
  }
  throw new Error(`runFrame: bad index ${frameIdx}`);
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
      const frame = runFrame(baseRgba, i);
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

  function buildPoseFrames(prefix, frameCount) {
    const out = {};
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
      out[f.abbr] = frames;
    }
    return out;
  }

  kit.poses.walking = buildPoseFrames('walk', WALK_FRAMES);
  kit.poses.running = buildPoseFrames('run', RUN_FRAMES);

  await writeFile(KIT_JSON, JSON.stringify(kit, null, 2) + '\n');
  console.log(`Patched ${KIT_JSON} (walking + running).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
