#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REGISTRY_PATH = resolve(ROOT, 'public/components/index.json');
const COMPONENT_ROOT = resolve(ROOT, 'public/sprites/components');

const CELL_W = 11;
const CELL_H = 18;

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

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function getCellOffset(col, row, sheetWidth) {
  return { x: col * CELL_W, y: row * CELL_H, sheetWidth };
}

function clearCell(png, col, row) {
  const { x: baseX, y: baseY, sheetWidth } = getCellOffset(col, row, png.width);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const idx = ((baseY + y) * sheetWidth + (baseX + x)) * 4;
      png.data[idx + 0] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 0;
    }
  }
}

function blitComponent(target, col, row, componentPng) {
  if (componentPng.width !== CELL_W || componentPng.height !== CELL_H) {
    throw new Error(
      `Component PNG size mismatch (expected ${CELL_W}x${CELL_H}, got ${componentPng.width}x${componentPng.height})`
    );
  }
  const { x: baseX, y: baseY, sheetWidth } = getCellOffset(col, row, target.width);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const srcIdx = (y * CELL_W + x) * 4;
      const alpha = componentPng.data[srcIdx + 3];
      if (alpha === 0) continue;
      const dstIdx = ((baseY + y) * sheetWidth + (baseX + x)) * 4;
      target.data[dstIdx + 0] = componentPng.data[srcIdx + 0];
      target.data[dstIdx + 1] = componentPng.data[srcIdx + 1];
      target.data[dstIdx + 2] = componentPng.data[srcIdx + 2];
      target.data[dstIdx + 3] = alpha;
    }
  }
}

function scaleNearest(srcPng, scale) {
  const scaled = new PNG({ width: srcPng.width * scale, height: srcPng.height * scale });
  for (let y = 0; y < srcPng.height; y++) {
    for (let x = 0; x < srcPng.width; x++) {
      const srcIdx = (y * srcPng.width + x) * 4;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const dx = x * scale + sx;
          const dy = y * scale + sy;
          const dstIdx = (dy * scaled.width + dx) * 4;
          scaled.data[dstIdx + 0] = srcPng.data[srcIdx + 0];
          scaled.data[dstIdx + 1] = srcPng.data[srcIdx + 1];
          scaled.data[dstIdx + 2] = srcPng.data[srcIdx + 2];
          scaled.data[dstIdx + 3] = srcPng.data[srcIdx + 3];
        }
      }
    }
  }
  return scaled;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kitId = args.get('kit') ?? 'british-line-infantry';
  const kitPath = resolve(ROOT, `public/components/kits/${kitId}.json`);
  const kit = loadJson(kitPath);

  const registry = loadJson(REGISTRY_PATH);
  const componentsById = new Map(registry.components.map((entry) => [entry.id, entry]));

  const baseAtlasPath = resolve(ROOT, args.get('base') ?? kit.baseAtlas ?? 'public/sprites/british-line-infantry.png');
  const outputAtlasPath = resolve(
    ROOT,
    args.get('out') ?? kit.outputAtlas ?? `public/sprites/${kitId}-components.png`
  );
  const outputPreviewPath = args.get('preview')
    ? resolve(ROOT, args.get('preview'))
    : kit.outputPreview
    ? resolve(ROOT, kit.outputPreview)
    : null;
  const scale = args.has('scale') ? Number(args.get('scale')) : 6;

  const baseAtlas = PNG.sync.read(readFileSync(baseAtlasPath));
  const outputAtlas = new PNG({ width: baseAtlas.width, height: baseAtlas.height });
  outputAtlas.data.set(baseAtlas.data);

  console.log(`Using base atlas: ${baseAtlasPath}`);
  console.log(`Writing output atlas: ${outputAtlasPath}`);

  for (const [facing, config] of Object.entries(kit.facings)) {
    if (!config.cell) {
      throw new Error(`Kit ${kitId} facing ${facing} is missing a cell coordinate.`);
    }
    const [col, row] = config.cell;
    console.log(`\nCompositing facing ${facing} at cell (${col}, ${row})`);
    clearCell(outputAtlas, col, row);
    for (const id of config.layers) {
      const entry = componentsById.get(id);
      if (!entry) {
        throw new Error(`Unknown component "${id}" referenced by kit ${kitId}.`);
      }
      const componentPath = resolve(COMPONENT_ROOT, entry.path);
      const componentPng = PNG.sync.read(readFileSync(componentPath));
      blitComponent(outputAtlas, col, row, componentPng);
      console.log(`  + ${id}`);
    }
  }

  mkdirSync(dirname(outputAtlasPath), { recursive: true });
  writeFileSync(outputAtlasPath, PNG.sync.write(outputAtlas));
  console.log('✔ Atlas written.');

  if (outputPreviewPath) {
    const previewScale = clampScale(scale);
    const preview = scaleNearest(outputAtlas, previewScale);
    mkdirSync(dirname(outputPreviewPath), { recursive: true });
    writeFileSync(outputPreviewPath, PNG.sync.write(preview));
    console.log(`✔ Preview written (${previewScale}x): ${outputPreviewPath}`);
  }
}

function clampScale(value) {
  const n = Number.isFinite(value) && value > 0 ? Math.floor(value) : 6;
  return Math.max(1, Math.min(16, n));
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
