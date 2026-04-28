// Migrate kit JSONs onto the kit-level weapon palette schema (see
// docs/superpowers/specs/2026-04-27-weapon-palette-design.md).
//
// What this does, per kit:
//   1. Walk every `kit.poses[pose][dir].weapon` and `weaponVariants[]` entry.
//   2. Resolve each inline placement to its effective `(src, transform, x, y,
//      rot, flipX)` tuple. For inline entries that omit `src`, the canonical
//      `kit.weapon.facings[dir]` mapping supplies the source. `effectiveSpriteSource`
//      resolves recursively so the palette only ever references AUTHORED
//      source facings (e.g. `hit.W` with explicit `src: "E"` rewrites via
//      `kit.weapon.facings.E = { src: "W", transform: "flipX" }` to the
//      underlying authored W source with a flipX transform).
//   3. Dedupe by stringified tuple. Each unique tuple gets an id of the form
//      `<src-lower>-<n>` where n increments per src group. Sorted for stable
//      output.
//   4. Replace inline `weapon` and `weaponVariants[]` entries with palette ids.
//   5. Drop `kit.weapon.facings`. Keep `kit.weapon.layerPrefix`.
//   6. Set `kit.weaponPalette` to the deduped, sorted list.
//
// Idempotent: a kit that already has `weaponPalette` is returned untouched.
//
// CLI: `node scripts/migrate-to-weapon-palette.mjs` walks every kit listed in
// `public/components/kits/index.json` and writes each kit JSON back prettified.
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
 * Resolve an inline weapon entry to its effective `(src, transform)` pair on
 * the authored source PNGs. Recursive: if the inline `src` itself points to a
 * derived facing (one whose `kit.weapon.facings[src]` borrows from another
 * facing), we follow that chain until we land on a canonical (`src: 'self'`)
 * source. Each hop composes its `transform` onto the running transform.
 *
 *   inline { src: 'E' } + facings.E = { src: 'W', transform: 'flipX' }
 *     → { src: 'W', transform: 'flipX' }
 *
 * If the inline omits `src`, we look up `kitFacings[dir]` instead.
 */
export function effectiveSpriteSource(inlineEntry, kitFacings, dir) {
  let src;
  let transform = 'none';
  if (typeof inlineEntry?.src === 'string' && inlineEntry.src !== 'self') {
    src = inlineEntry.src;
    if (typeof inlineEntry.transform === 'string') {
      transform = inlineEntry.transform;
    }
  } else if (typeof inlineEntry?.src === 'string' && inlineEntry.src === 'self') {
    src = dir;
    transform = 'none';
  } else {
    // No explicit src on the inline entry → consult kit.weapon.facings[dir].
    const canonical = kitFacings ? kitFacings[dir] : null;
    if (!canonical || canonical.src === 'self') {
      src = dir;
      transform = 'none';
    } else {
      src = canonical.src;
      transform = canonical.transform ?? 'none';
    }
  }

  // Walk the chain: while kitFacings[src] redirects to another facing, follow
  // and compose. We need to apply the redirect's transform on top of our
  // current transform — `composeTransforms(currentT, redirectT)`. We also
  // must terminate (no infinite loops on cyclic data).
  const visited = new Set();
  while (
    kitFacings &&
    kitFacings[src] &&
    kitFacings[src].src !== 'self' &&
    !visited.has(src)
  ) {
    visited.add(src);
    const next = kitFacings[src];
    transform = composeTransforms(next.transform ?? 'none', transform);
    src = next.src;
  }

  return { src, transform };
}

/**
 * Compose two texture-space transforms applied in order: `outer(inner(x))`.
 * Each transform is one of 'none' | 'flipX' | 'flipY' | 'rot180'. The set
 * forms a Klein-4 group under composition:
 *   flipX ∘ flipX = none
 *   flipY ∘ flipY = none
 *   rot180 ∘ rot180 = none
 *   flipX ∘ flipY = rot180
 *   flipY ∘ flipX = rot180
 *   flipX ∘ rot180 = flipY
 *   flipY ∘ rot180 = flipX
 *   rot180 ∘ flipX = flipY
 *   rot180 ∘ flipY = flipX
 */
function composeTransforms(outer, inner) {
  if (outer === 'none') return inner;
  if (inner === 'none') return outer;
  if (outer === inner) return 'none';
  // Both non-none, both different — exactly one of each pair maps to the
  // third element via Klein-4.
  const set = new Set([outer, inner]);
  if (set.has('flipX') && set.has('flipY')) return 'rot180';
  if (set.has('flipX') && set.has('rot180')) return 'flipY';
  if (set.has('flipY') && set.has('rot180')) return 'flipX';
  return 'none';
}

/** Stable string key for tuple dedup. */
export function tupleKey(src, transform, x, y, rot, flipX) {
  return JSON.stringify([
    src,
    transform || 'none',
    x,
    y,
    rot,
    flipX === true ? 1 : 0,
  ]);
}

/**
 * Numeric inline weapon entry, validated. Returns null if `inline` is not a
 * usable object with `(x, y, rot)` numbers.
 */
function readInlinePlacement(inline) {
  if (!inline || typeof inline !== 'object' || Array.isArray(inline)) return null;
  const { x, y, rot } = inline;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof rot !== 'number'
  ) {
    return null;
  }
  return {
    x,
    y,
    rot,
    flipX: inline.flipX === true,
    src: typeof inline.src === 'string' ? inline.src : undefined,
    transform: typeof inline.transform === 'string' ? inline.transform : undefined,
  };
}

/**
 * Walk every (pose, dir).weapon and weaponVariants[] in the kit, resolve
 * each to an effective tuple, dedupe, and assign palette ids. Returns the
 * sorted palette plus a tuple-key → id Map.
 */
export function buildPalette(kit) {
  const palette = [];
  const idByTuple = new Map();
  const counters = new Map(); // src → next n
  const kitFacings = kit.weapon?.facings;

  function ingest(inline, dir) {
    const placement = readInlinePlacement(inline);
    if (!placement) return null;
    const { src, transform } = effectiveSpriteSource(placement, kitFacings, dir);
    const key = tupleKey(src, transform, placement.x, placement.y, placement.rot, placement.flipX);
    let id = idByTuple.get(key);
    if (id) return id;
    const counterKey = src;
    const n = counters.get(counterKey) ?? 0;
    counters.set(counterKey, n + 1);
    id = `${src.toLowerCase()}-${n}`;
    const entry = {
      id,
      src,
      ...(transform && transform !== 'none' ? { transform } : {}),
      x: placement.x,
      y: placement.y,
      rot: placement.rot,
      ...(placement.flipX ? { flipX: true } : {}),
    };
    palette.push(entry);
    idByTuple.set(key, id);
    return id;
  }

  if (kit.poses && typeof kit.poses === 'object') {
    for (const [poseName, poseEntry] of Object.entries(kit.poses)) {
      if (!poseEntry || typeof poseEntry !== 'object' || Array.isArray(poseEntry)) continue;
      for (const dir of ALL_FACINGS) {
        const facingEntry = poseEntry[dir];
        if (!facingEntry || typeof facingEntry !== 'object' || Array.isArray(facingEntry)) {
          continue;
        }
        ingest(facingEntry.weapon, dir);
        if (Array.isArray(facingEntry.weaponVariants)) {
          for (const v of facingEntry.weaponVariants) {
            ingest(v, dir);
          }
        }
        void poseName;
      }
    }
  }

  // Stable sort by id (lex). The src-grouped numeric suffixes sort naturally
  // when n stays single-digit; pad with zero-pad? Skip — sort is purely
  // string-lex and that's deterministic, which is what we need for diff
  // stability.
  palette.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { palette, idByTuple };
}

/**
 * Mutate `kit` in place: replace inline weapon objects with palette ids,
 * drop `kit.weapon.facings`, and set `kit.weaponPalette` from the supplied
 * palette/idByTuple pair.
 */
export function rewriteKit(kit, palette, idByTuple) {
  const kitFacings = kit.weapon?.facings;

  function rewriteInline(inline, dir) {
    const placement = readInlinePlacement(inline);
    if (!placement) return undefined;
    const { src, transform } = effectiveSpriteSource(placement, kitFacings, dir);
    const key = tupleKey(src, transform, placement.x, placement.y, placement.rot, placement.flipX);
    return idByTuple.get(key);
  }

  if (kit.poses && typeof kit.poses === 'object') {
    for (const poseEntry of Object.values(kit.poses)) {
      if (!poseEntry || typeof poseEntry !== 'object' || Array.isArray(poseEntry)) continue;
      for (const dir of ALL_FACINGS) {
        const facingEntry = poseEntry[dir];
        if (!facingEntry || typeof facingEntry !== 'object' || Array.isArray(facingEntry)) {
          continue;
        }
        if (facingEntry.weapon !== undefined) {
          const id = rewriteInline(facingEntry.weapon, dir);
          if (id) facingEntry.weapon = id;
          else delete facingEntry.weapon;
        }
        if (Array.isArray(facingEntry.weaponVariants)) {
          const ids = [];
          for (const v of facingEntry.weaponVariants) {
            const id = rewriteInline(v, dir);
            if (id) ids.push(id);
          }
          if (ids.length > 0) facingEntry.weaponVariants = ids;
          else delete facingEntry.weaponVariants;
        }
      }
    }
  }

  if (kit.weapon && typeof kit.weapon === 'object') {
    delete kit.weapon.facings;
  }
  kit.weaponPalette = palette;
}

/**
 * Idempotent migrate: returns kit unchanged if `weaponPalette` exists. Otherwise
 * builds the palette and rewrites in place. Returns the (possibly mutated) kit.
 */
export function migrate(kit) {
  if (Array.isArray(kit?.weaponPalette)) return kit;
  const { palette, idByTuple } = buildPalette(kit);
  rewriteKit(kit, palette, idByTuple);
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
  const paletteSize = Array.isArray(kit.weaponPalette) ? kit.weaponPalette.length : 0;
  console.log(`${kitId}: migrated → palette=${paletteSize} entries`);
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
    console.error('[migrate-to-weapon-palette] fatal:', err);
    process.exit(1);
  });
}
