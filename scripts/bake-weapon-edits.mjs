// Bake pixel-edits[kit]["weapon"][facing][weapon-id] into source weapon PNGs.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { applyEdits } from './lib/pose-frame-edits.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REGISTRY_PATH = resolve(REPO_ROOT, 'public/components/index.json');
const PIXEL_EDITS_PATH = resolve(REPO_ROOT, 'public/components/pixel-edits.json');
const COMPONENTS_ROOT = resolve(REPO_ROOT, 'public/sprites/components');

function parseArgs(argv) {
  const result = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.includes('=') ? arg.slice(2).split('=', 2) : [arg.slice(2), argv[++i]];
      result.set(key, value ?? '');
    }
  }
  return result;
}

function buildRegistryMap(registry) {
  const map = new Map();
  if (!registry || !Array.isArray(registry.components)) return map;
  for (const c of registry.components) {
    if (c && typeof c.id === 'string' && typeof c.path === 'string') {
      map.set(c.id, c.path);
    }
  }
  return map;
}

/**
 * Plan the bake jobs from a pixel-edits tree and a component registry.
 * Returns an array of { kit, facing, componentId, srcPath, edits } — one per
 * (kit, facing, weapon-component-id) tuple where the edit list is non-empty
 * AND the component id resolves in the registry. Unknown component ids emit a
 * warning via `opts.warn` (default: console.warn) and are skipped.
 */
export function resolveWeaponEdits(pixelEdits, registry, opts = {}) {
  const warn = opts.warn || ((msg) => console.warn(msg));
  const kitFilter = opts.kit;
  const map = buildRegistryMap(registry);
  const jobs = [];
  if (!pixelEdits || typeof pixelEdits !== 'object') return jobs;
  for (const [kit, kitEdits] of Object.entries(pixelEdits)) {
    if (kitFilter && kit !== kitFilter) continue;
    if (!kitEdits || typeof kitEdits !== 'object') continue;
    const weaponEdits = kitEdits.weapon;
    if (!weaponEdits || typeof weaponEdits !== 'object') continue;
    for (const [facing, facingEdits] of Object.entries(weaponEdits)) {
      if (!facingEdits || typeof facingEdits !== 'object') continue;
      for (const [componentId, edits] of Object.entries(facingEdits)) {
        if (!Array.isArray(edits) || edits.length === 0) continue;
        const path = map.get(componentId);
        if (!path) {
          warn(`[bake-weapon-edits] WARN unknown component id '${componentId}' (kit ${kit}, facing ${facing}) — skipping`);
          continue;
        }
        jobs.push({ kit, facing, componentId, srcPath: path, edits });
      }
    }
  }
  return jobs;
}

async function loadJson(path) {
  const buf = await readFile(path, 'utf8');
  return JSON.parse(buf);
}

async function loadPixelEdits(path) {
  try {
    return await loadJson(path);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function bakeJob(job) {
  const fullPath = resolve(COMPONENTS_ROOT, job.srcPath);
  const buf = await readFile(fullPath);
  const png = PNG.sync.read(buf);
  const applied = applyEdits(png.data, png.width, png.height, job.edits);
  await writeFile(fullPath, PNG.sync.write(png));
  return applied;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kit = args.get('kit') || undefined;
  const pixelEdits = await loadPixelEdits(PIXEL_EDITS_PATH);
  if (!pixelEdits) {
    console.log('[bake-weapon-edits] nothing to do');
    return;
  }
  const registry = await loadJson(REGISTRY_PATH);
  const jobs = resolveWeaponEdits(pixelEdits, registry, { kit });
  if (jobs.length === 0) {
    console.log('[bake-weapon-edits] nothing to do');
    return;
  }
  let written = 0;
  for (const job of jobs) {
    const n = await bakeJob(job);
    console.log(`[bake-weapon-edits] ${job.kit}/${job.facing}/${job.componentId} ← ${n} edits applied`);
    written++;
  }
  console.log(`[bake-weapon-edits] done — wrote ${written} file${written === 1 ? '' : '(s)'}`);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('[bake-weapon-edits] fatal:', err);
    process.exit(1);
  });
}
