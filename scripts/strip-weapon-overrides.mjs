// One-shot migration: collapse per-pose weapon authoring to {x, y, rot} only.
//
// Per-pose weapon entries (`kit.poses[poseId][facing].weapon` and items in
// `kit.poses[poseId][facing].weaponVariants`) used to allow `src`, `transform`,
// and `flipX` overrides that picked a *different* weapon facing than the one
// declared in the kit's canonical `kit.weapon.facings[F]` block. That made it
// possible to author poses (e.g. line-infantry's `present.E`) that rendered
// the weapon with the wrong sprite. The new rule: per-pose authoring tunes
// position only — the canonical 8 weapon facings define the sprite.
//
// Idempotent: re-running on already-stripped data produces no diff.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const KITS_DIR = resolve(ROOT, 'public', 'components', 'kits');
const KIT_INDEX = resolve(KITS_DIR, 'index.json');

function stripWeapon(weapon) {
  if (!weapon || typeof weapon !== 'object') return weapon;
  const out = {};
  if (Number.isFinite(weapon.x)) out.x = weapon.x;
  if (Number.isFinite(weapon.y)) out.y = weapon.y;
  if (Number.isFinite(weapon.rot)) out.rot = weapon.rot;
  return out;
}

function changed(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function processKit(kitId) {
  const path = resolve(KITS_DIR, `${kitId}.json`);
  const raw = await readFile(path, 'utf8').catch(() => null);
  if (raw === null) {
    console.log(`${kitId}: skipped (no JSON file)`);
    return;
  }
  const kit = JSON.parse(raw);
  let stripped = 0;
  if (kit.poses && typeof kit.poses === 'object') {
    for (const [poseId, poseEntry] of Object.entries(kit.poses)) {
      if (!poseEntry || typeof poseEntry !== 'object' || Array.isArray(poseEntry)) continue;
      for (const [facing, facingEntry] of Object.entries(poseEntry)) {
        if (facing === 'bob') continue;
        if (!facingEntry || typeof facingEntry !== 'object' || Array.isArray(facingEntry)) continue;
        if (facingEntry.weapon) {
          const before = facingEntry.weapon;
          facingEntry.weapon = stripWeapon(facingEntry.weapon);
          if (changed(before, facingEntry.weapon)) stripped++;
        }
        if (Array.isArray(facingEntry.weaponVariants)) {
          for (let i = 0; i < facingEntry.weaponVariants.length; i++) {
            const before = facingEntry.weaponVariants[i];
            facingEntry.weaponVariants[i] = stripWeapon(facingEntry.weaponVariants[i]);
            if (changed(before, facingEntry.weaponVariants[i])) stripped++;
          }
        }
        void poseId;
      }
    }
  }
  await writeFile(path, JSON.stringify(kit, null, 2) + '\n');
  console.log(`${kitId}: stripped ${stripped} weapon override(s) → ${path}`);
}

async function main() {
  const idx = JSON.parse(await readFile(KIT_INDEX, 'utf8'));
  if (!Array.isArray(idx)) throw new Error(`${KIT_INDEX}: expected an array of kit ids`);
  for (const kitId of idx) {
    if (typeof kitId === 'string') await processKit(kitId);
  }
}

main().catch((err) => {
  console.error('[strip-weapon-overrides] fatal:', err);
  process.exit(1);
});
