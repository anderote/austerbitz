// Migrate kit JSONs from the kit-level `weaponPalette` indirection to inline
// `weapons[]` orientations on each `(pose, facing)` entry (see
// docs/superpowers/specs/2026-04-28-weapon-pose-palette-design.md).
//
// What this does, per kit:
//   1. If `kit.weaponPalette` is absent → return the kit unchanged (idempotent).
//   2. Build `byId: Map<string, WeaponOrientation>` from `kit.weaponPalette`,
//      stripping the `id` field.
//   3. For every `(pose, facing)` entry, build
//      `weapons[] = [primaryIfAny, ...variantsIfAny].map(id => byId.get(id))`.
//      Skip unknown ids with a console.warn. Set `entry.weapons = weapons` if
//      non-empty; otherwise omit the field. Delete `entry.weapon` and
//      `entry.weaponVariants`.
//   4. Delete `kit.weaponPalette`.
//   5. Return the mutated kit.
//
// Idempotent: a kit that already lacks `weaponPalette` is returned untouched.
//
// CLI: `node scripts/migrate-weapon-palette-to-inline.mjs` walks every kit
// listed in `public/components/kits/index.json` and writes each kit JSON back
// prettified with 2-space indentation and a trailing newline.
//
// Pure Node 20 ESM, no third-party deps.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const KITS_DIR = resolve(repoRoot, 'public/components/kits');
const KIT_INDEX = resolve(KITS_DIR, 'index.json');

const ALL_FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Strip `id` from a palette entry to produce a `WeaponOrientation`. All other
 * fields (`src`, `transform?`, `x`, `y`, `rot`, `flipX?`) carry over verbatim.
 * Field order is fixed: src, transform?, x, y, rot, flipX?.
 */
export function inlineOne(paletteEntry) {
  if (!paletteEntry || typeof paletteEntry !== 'object') {
    throw new Error(`inlineOne: expected object, got ${typeof paletteEntry}`);
  }
  const out = { src: paletteEntry.src };
  if (paletteEntry.transform !== undefined && paletteEntry.transform !== 'none') {
    out.transform = paletteEntry.transform;
  }
  out.x = paletteEntry.x;
  out.y = paletteEntry.y;
  out.rot = paletteEntry.rot;
  if (paletteEntry.flipX === true) out.flipX = true;
  return out;
}

/**
 * Idempotent migrate: returns `kit` unchanged if `weaponPalette` is absent.
 * Otherwise inlines orientations onto each `(pose, facing)` entry, deletes
 * the kit-level palette, and returns the mutated kit.
 */
export function migrate(kit) {
  if (!kit || typeof kit !== 'object') return kit;
  if (!Array.isArray(kit.weaponPalette)) return kit;

  // Build id → orientation map.
  const byId = new Map();
  for (const entry of kit.weaponPalette) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.id !== 'string') continue;
    byId.set(entry.id, inlineOne(entry));
  }

  if (kit.poses && typeof kit.poses === 'object' && !Array.isArray(kit.poses)) {
    for (const [poseName, poseEntry] of Object.entries(kit.poses)) {
      if (!poseEntry || typeof poseEntry !== 'object' || Array.isArray(poseEntry)) continue;
      for (const dir of ALL_FACINGS) {
        const facingEntry = poseEntry[dir];
        if (!facingEntry || typeof facingEntry !== 'object' || Array.isArray(facingEntry)) {
          continue;
        }
        const ids = [];
        if (typeof facingEntry.weapon === 'string') {
          ids.push(facingEntry.weapon);
        }
        if (Array.isArray(facingEntry.weaponVariants)) {
          for (const v of facingEntry.weaponVariants) {
            if (typeof v === 'string') ids.push(v);
          }
        }
        const weapons = [];
        for (const id of ids) {
          const orientation = byId.get(id);
          if (orientation) {
            weapons.push({ ...orientation });
          } else {
            console.warn(
              `[migrate-weapon-palette-to-inline] kit '${kit.id ?? '<unknown>'}' ` +
                `pose '${poseName}' facing '${dir}': unknown palette id '${id}', skipping`,
            );
          }
        }
        if (weapons.length > 0) {
          facingEntry.weapons = weapons;
        }
        delete facingEntry.weapon;
        delete facingEntry.weaponVariants;
      }
    }
  }

  delete kit.weaponPalette;
  return kit;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function processKit(kitId) {
  const path = resolve(KITS_DIR, `${kitId}.json`);
  let kit;
  try {
    kit = await readJson(path);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.log(`${kitId}: skipped (no JSON file)`);
      return;
    }
    throw err;
  }
  const before = JSON.stringify(kit);
  migrate(kit);
  const after = JSON.stringify(kit);
  if (before === after) {
    console.log(`${kitId}: already migrated`);
    return;
  }
  await writeJson(path, kit);
  console.log(`${kitId}: migrated → inline weapons[]`);
}

async function main() {
  const idx = await readJson(KIT_INDEX);
  if (!Array.isArray(idx)) throw new Error(`${KIT_INDEX}: expected an array of kit ids`);
  for (const kitId of idx) {
    if (typeof kitId === 'string') {
      await processKit(kitId);
    }
  }
}

// Execute when invoked as a script (not when imported by tests).
const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((err) => {
    console.error('[migrate-weapon-palette-to-inline] fatal:', err);
    process.exit(1);
  });
}
