// Migrate `line-infantry.json` (and the `line-infantry` block of
// `pixel-edits.json`) onto the per-pose weapon attachment schema described in
// docs/superpowers/specs/2026-04-27-per-pose-weapon-attachment-design.md.
//
// What this does:
//   1. Adds the top-level `weapon` block to line-infantry.json (3 source
//      facings N/NW/W + 5 derived facings).
//   2. Strips every `musket-brown-bess-*` layer string from
//      `facings.<F>.layers` and `poses.<P>.<F>.layers`.
//   3. Converts each `poses.<P>.<F>` from the legacy `string[]` shape to the
//      new `{ layers, weapon: { x, y, rot } }` shape, seeded from a per-pose
//      lookup table (idle is implicit via top-level `facings`, no entry).
//   4. Deletes `poses.musket` (replaced by the editor's `weapon` authoring
//      view in a later subagent task).
//   5. Migrates pixel-edits: for `["line-infantry"][pose][facing][component]`
//      whose component matches `^musket-brown-bess-`, rewrite the component
//      key to `"weapon"` for SOURCE facings (N, NW, W). For DERIVED facings
//      (NE, SE, E, SW, S) leave the entry as-is and emit a console warning.
//   6. Writes both JSONs back, prettified (2-space).
//
// Idempotent: re-running on already-migrated JSON skips work that's done and
// preserves the existing structure.
//
// Pure Node 20 ESM, no third-party deps.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const KIT_PATH = resolve(repoRoot, 'public/components/kits/line-infantry.json');
const PIXEL_EDITS_PATH = resolve(repoRoot, 'public/components/pixel-edits.json');

const SOURCE_FACINGS = new Set(['N', 'NW', 'W']);
const DERIVED_FACINGS = new Set(['NE', 'SE', 'E', 'SW', 'S']);
const ALL_FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const WEAPON_BLOCK = {
  layerPrefix: 'musket-brown-bess',
  facings: {
    N: { src: 'self' },
    NW: { src: 'self' },
    W: { src: 'self' },
    S: { src: 'N', transform: 'flipY' },
    NE: { src: 'NW', transform: 'flipX' },
    SE: { src: 'NW', transform: 'rot180' },
    SW: { src: 'NW', transform: 'flipY' },
    E: { src: 'W', transform: 'flipX' },
  },
};

// Per-pose seed offsets. `idle` doesn't have a poses entry — top-level
// `facings` is the implicit idle state, and the resolver returns
// {x:0,y:0,rot:0} by default.
const POSE_SEEDS = {
  'make-ready': { x: 0, y: -1, rot: 0 },
  present: { x: 1, y: -1, rot: 20 },
  fire: { x: 1, y: -2, rot: 20 },
  hit: { x: 0, y: 1, rot: -10 },
  dying: { x: 0, y: 2, rot: 0 },
};

const MUSKET_LAYER_RE = /^musket-brown-bess-/;

function isWeaponPoseTransform(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.rot === 'number'
  );
}

function isPoseFacingEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(value.layers)
  );
}

async function readJson(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

async function writeJson(path, data) {
  // Match Prettier-style 2-space JSON with a trailing newline.
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function migrateKit(kit) {
  const stats = {
    weaponBlockAdded: false,
    weaponBlockAlreadyPresent: false,
    musketLayersStripped: 0,
    facingsBlocksTouched: 0,
    poseFacingsConverted: 0,
    poseFacingsAlreadyConverted: 0,
    poseFacingsByPose: {},
    musketPoseDeleted: false,
    musketPoseAlreadyAbsent: false,
  };

  // (1) weapon block.
  if (kit.weapon && kit.weapon.layerPrefix) {
    stats.weaponBlockAlreadyPresent = true;
  } else {
    kit.weapon = WEAPON_BLOCK;
    stats.weaponBlockAdded = true;
  }

  // (2) strip musket layers from top-level facings.
  if (kit.facings && typeof kit.facings === 'object') {
    for (const [facing, entry] of Object.entries(kit.facings)) {
      if (!entry || !Array.isArray(entry.layers)) continue;
      const before = entry.layers.length;
      entry.layers = entry.layers.filter((layer) => !MUSKET_LAYER_RE.test(layer));
      const stripped = before - entry.layers.length;
      if (stripped > 0) {
        stats.musketLayersStripped += stripped;
        stats.facingsBlocksTouched += 1;
      }
      void facing;
    }
  }

  // (3) convert poses[pose][facing] entries.
  if (kit.poses && typeof kit.poses === 'object') {
    for (const [poseName, poseEntry] of Object.entries(kit.poses)) {
      if (poseName === 'musket') continue; // handled in step (4)
      if (!poseEntry || typeof poseEntry !== 'object') continue;
      stats.poseFacingsByPose[poseName] = stats.poseFacingsByPose[poseName] ?? {
        converted: 0,
        alreadyConverted: 0,
        layersStripped: 0,
      };
      for (const facing of ALL_FACINGS) {
        const facingEntry = poseEntry[facing];
        if (facingEntry === undefined) continue;
        if (Array.isArray(facingEntry)) {
          // Legacy bare-array shape → convert.
          const beforeLen = facingEntry.length;
          const layers = facingEntry.filter((layer) => !MUSKET_LAYER_RE.test(layer));
          const stripped = beforeLen - layers.length;
          stats.musketLayersStripped += stripped;
          stats.poseFacingsByPose[poseName].layersStripped += stripped;
          const seed = POSE_SEEDS[poseName] ?? { x: 0, y: 0, rot: 0 };
          poseEntry[facing] = {
            layers,
            weapon: { x: seed.x, y: seed.y, rot: seed.rot },
          };
          stats.poseFacingsConverted += 1;
          stats.poseFacingsByPose[poseName].converted += 1;
        } else if (isPoseFacingEntry(facingEntry)) {
          // Already in new shape → still strip stale musket layers, leave
          // the existing weapon offset alone (don't clobber author edits).
          if (Array.isArray(facingEntry.layers)) {
            const before = facingEntry.layers.length;
            facingEntry.layers = facingEntry.layers.filter(
              (layer) => !MUSKET_LAYER_RE.test(layer),
            );
            const stripped = before - facingEntry.layers.length;
            stats.musketLayersStripped += stripped;
            stats.poseFacingsByPose[poseName].layersStripped += stripped;
          }
          if (!isWeaponPoseTransform(facingEntry.weapon)) {
            const seed = POSE_SEEDS[poseName] ?? { x: 0, y: 0, rot: 0 };
            facingEntry.weapon = { x: seed.x, y: seed.y, rot: seed.rot };
            // Treat as a conversion-style touch since we filled in the weapon.
            stats.poseFacingsConverted += 1;
            stats.poseFacingsByPose[poseName].converted += 1;
          } else {
            stats.poseFacingsAlreadyConverted += 1;
            stats.poseFacingsByPose[poseName].alreadyConverted += 1;
          }
        }
      }
    }
  }

  // (4) delete poses.musket.
  if (kit.poses && Object.prototype.hasOwnProperty.call(kit.poses, 'musket')) {
    delete kit.poses.musket;
    stats.musketPoseDeleted = true;
  } else {
    stats.musketPoseAlreadyAbsent = true;
  }

  return stats;
}

function migratePixelEdits(pixelEdits) {
  const stats = {
    sourceRekeys: 0,
    derivedWarnings: 0,
    perFacing: {},
  };
  const liUnit = pixelEdits['line-infantry'];
  if (!liUnit || typeof liUnit !== 'object') return stats;

  for (const [pose, poseEntry] of Object.entries(liUnit)) {
    if (!poseEntry || typeof poseEntry !== 'object') continue;
    for (const [facing, facingEntry] of Object.entries(poseEntry)) {
      if (!facingEntry || typeof facingEntry !== 'object') continue;
      // Iterate keys defensively — we may rewrite while iterating.
      for (const componentKey of Object.keys(facingEntry)) {
        if (!MUSKET_LAYER_RE.test(componentKey)) continue;
        const value = facingEntry[componentKey];
        const tag = `${pose}/${facing}`;
        stats.perFacing[tag] = stats.perFacing[tag] ?? {
          rekeyed: 0,
          warned: 0,
        };

        if (SOURCE_FACINGS.has(facing)) {
          // Idempotency: if "weapon" already exists, prefer to merge rather
          // than overwrite. Since we can't safely merge two unrelated edit
          // arrays, fall back to keeping "weapon" if present and dropping the
          // legacy key (the migration ran already).
          if (Object.prototype.hasOwnProperty.call(facingEntry, 'weapon')) {
            // Already migrated previously: drop the now-stale legacy key.
            delete facingEntry[componentKey];
          } else {
            facingEntry.weapon = value;
            delete facingEntry[componentKey];
          }
          stats.sourceRekeys += 1;
          stats.perFacing[tag].rekeyed += 1;
        } else if (DERIVED_FACINGS.has(facing)) {
          console.warn(
            `WARN: derived-facing weapon edits at line-infantry/${pose}/${facing} kept as-is; manual triage needed`,
          );
          stats.derivedWarnings += 1;
          stats.perFacing[tag].warned += 1;
        }
      }
    }
  }
  return stats;
}

function printSummary(kitStats, pixelStats) {
  console.log('--- line-infantry.json ---');
  if (kitStats.weaponBlockAdded) {
    console.log('  + added top-level `weapon` block (3 self / 5 derived facings)');
  } else if (kitStats.weaponBlockAlreadyPresent) {
    console.log('  · weapon block already present (skipped)');
  }
  console.log(
    `  - stripped ${kitStats.musketLayersStripped} layer(s) matching ^musket-brown-bess- ` +
      `from ${kitStats.facingsBlocksTouched} facings block(s) and pose facings`,
  );
  console.log(
    `  ~ pose facings: ${kitStats.poseFacingsConverted} converted, ` +
      `${kitStats.poseFacingsAlreadyConverted} already in new shape`,
  );
  for (const [pose, byPose] of Object.entries(kitStats.poseFacingsByPose)) {
    console.log(
      `      ${pose}: converted=${byPose.converted}, ` +
        `already=${byPose.alreadyConverted}, layersStripped=${byPose.layersStripped}`,
    );
  }
  if (kitStats.musketPoseDeleted) {
    console.log('  - deleted poses.musket');
  } else {
    console.log('  · poses.musket already absent');
  }

  console.log('--- pixel-edits.json (line-infantry block) ---');
  console.log(
    `  ~ source-facing rekeys (N/NW/W): ${pixelStats.sourceRekeys}; ` +
      `derived-facing warnings (NE/SE/E/SW/S): ${pixelStats.derivedWarnings}`,
  );
  for (const [tag, byTag] of Object.entries(pixelStats.perFacing)) {
    console.log(`      ${tag}: rekeyed=${byTag.rekeyed}, warned=${byTag.warned}`);
  }
}

async function main() {
  const kit = await readJson(KIT_PATH);
  const kitStats = migrateKit(kit);
  await writeJson(KIT_PATH, kit);

  const pixelEdits = await readJson(PIXEL_EDITS_PATH);
  const pixelStats = migratePixelEdits(pixelEdits);
  await writeJson(PIXEL_EDITS_PATH, pixelEdits);

  printSummary(kitStats, pixelStats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
