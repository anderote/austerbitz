// One-shot fix: every (pose, dir).weapon (and weaponVariants entries) should
// use the SAME (src, transform) as idle.dir — i.e. the same authored musket
// source. Per-pose placement (x, y, rot, flipX) is preserved.
//
// Background: the migrate-to-weapon-palette.mjs run faithfully captured
// inline (src, transform) per (pose, dir), but those varied across poses
// (e.g. idle.S used NW-flipY while fire.S used N-flipY → visibly different
// musket sprite). The user wants the same source orientation across poses.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KIT_INDEX = resolve(REPO, 'public/components/kits/index.json');

function entryKey(src, transform, x, y, rot, flipX) {
  const t = transform || 'none';
  const f = flipX === true ? '1' : '0';
  return `${src}|${t}|${x}|${y}|${rot}|${f}`;
}

function findOrCreateEntry(palette, byKey, target) {
  const k = entryKey(target.src, target.transform, target.x, target.y, target.rot, target.flipX);
  const existing = byKey.get(k);
  if (existing) return existing.id;
  // Generate a new id in the <src-lower>-<n> family.
  const prefix = target.src.toLowerCase();
  let n = 0;
  const used = new Set(palette.map((e) => e.id));
  while (used.has(`${prefix}-${n}`)) n++;
  const newEntry = { id: `${prefix}-${n}`, src: target.src };
  if (target.transform && target.transform !== 'none') newEntry.transform = target.transform;
  newEntry.x = target.x | 0;
  newEntry.y = target.y | 0;
  newEntry.rot = +target.rot || 0;
  if (target.flipX === true) newEntry.flipX = true;
  palette.push(newEntry);
  byKey.set(k, newEntry);
  return newEntry.id;
}

function processKit(kit) {
  if (!Array.isArray(kit.weaponPalette)) {
    return { changed: 0, addedEntries: 0, removedEntries: 0 };
  }
  const palette = kit.weaponPalette;
  const byId = new Map(palette.map((e) => [e.id, e]));
  const byKey = new Map();
  for (const e of palette) {
    byKey.set(entryKey(e.src, e.transform, e.x, e.y, e.rot, e.flipX), e);
  }

  // Build idle src/transform map per direction.
  const idle = (kit.poses && kit.poses.idle) || {};
  const idleSrcByDir = {};
  for (const [d, e] of Object.entries(idle)) {
    if (e && typeof e === 'object' && typeof e.weapon === 'string') {
      const ent = byId.get(e.weapon);
      if (ent) idleSrcByDir[d] = { src: ent.src, transform: ent.transform || 'none' };
    }
  }

  let changed = 0;
  const beforeCount = palette.length;

  function retarget(currentId, dir) {
    if (!currentId || typeof currentId !== 'string') return currentId;
    const cur = byId.get(currentId);
    if (!cur) return currentId;
    const target = idleSrcByDir[dir];
    if (!target) return currentId;
    if (cur.src === target.src && (cur.transform || 'none') === target.transform) return currentId;
    // Rebuild palette key with idle's src/transform but the entry's placement.
    const newId = findOrCreateEntry(palette, byKey, {
      src: target.src,
      transform: target.transform,
      x: cur.x,
      y: cur.y,
      rot: cur.rot,
      flipX: cur.flipX,
    });
    byId.set(newId, palette[palette.length - 1] || byId.get(newId));
    if (newId !== currentId) changed++;
    return newId;
  }

  for (const [poseId, pose] of Object.entries(kit.poses || {})) {
    if (poseId === 'idle' || !pose || typeof pose !== 'object') continue;
    for (const [dir, entry] of Object.entries(pose)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (typeof entry.weapon === 'string') {
        entry.weapon = retarget(entry.weapon, dir);
      }
      if (Array.isArray(entry.weaponVariants)) {
        entry.weaponVariants = entry.weaponVariants.map((id) => retarget(id, dir));
      }
    }
  }

  // Garbage-collect orphans.
  const referenced = new Set();
  for (const pose of Object.values(kit.poses || {})) {
    if (!pose || typeof pose !== 'object') continue;
    for (const entry of Object.values(pose)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (typeof entry.weapon === 'string') referenced.add(entry.weapon);
      if (Array.isArray(entry.weaponVariants)) for (const v of entry.weaponVariants) referenced.add(v);
    }
  }
  const kept = palette.filter((e) => referenced.has(e.id));
  const removedEntries = palette.length - kept.length;
  // Sort by id for stable output (matches migrate-to-weapon-palette.mjs).
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  kit.weaponPalette = kept;

  return {
    changed,
    addedEntries: kept.length - beforeCount + removedEntries,
    removedEntries,
    finalCount: kept.length,
  };
}

async function main() {
  const idx = JSON.parse(await readFile(KIT_INDEX, 'utf8'));
  if (!Array.isArray(idx)) throw new Error(`${KIT_INDEX}: expected an array of kit ids`);
  for (const kitId of idx) {
    if (typeof kitId !== 'string') continue;
    const path = resolve(REPO, `public/components/kits/${kitId}.json`);
    const raw = await readFile(path, 'utf8').catch(() => null);
    if (raw === null) {
      console.log(`${kitId}: skipped (no JSON file)`);
      continue;
    }
    const kit = JSON.parse(raw);
    const r = processKit(kit);
    if (r.changed === 0 && r.removedEntries === 0) {
      console.log(`${kitId}: no changes (already aligned, ${r.finalCount ?? '?'} entries)`);
      continue;
    }
    await writeFile(path, JSON.stringify(kit, null, 2) + '\n');
    console.log(
      `${kitId}: retargeted ${r.changed} ref(s); palette ${r.finalCount} entries ` +
      `(removed ${r.removedEntries} orphans)`,
    );
  }
}

main().catch((err) => {
  console.error('[align-weapon-sources-to-idle] fatal:', err);
  process.exit(1);
});
