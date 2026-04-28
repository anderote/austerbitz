#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REGISTRY_PATH = resolve(ROOT, 'public/components/index.json');
const COMPONENT_ROOT = resolve(ROOT, 'public/sprites/components');
const OFFSETS_PATH = resolve(ROOT, 'public/components/offsets.json');
const PIXEL_EDITS_PATH = resolve(ROOT, 'public/components/pixel-edits.json');
const REGIMENTS_PATH = resolve(ROOT, 'public/regiments.json');

const CELL_W = 32;
const CELL_H = 36;

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

function loadOffsets(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch (_err) {
    return {};
  }
}

function loadPixelEdits(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch (_err) {
    return {};
  }
}

function parseHexColor(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function applyPixelEdits(target, col, row, edits, bobDy = 0) {
  if (!Array.isArray(edits) || edits.length === 0) return 0;
  const { x: baseX, y: baseY, sheetWidth } = getCellOffset(col, row, target.width);
  let applied = 0;
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') continue;
    const px = Number(edit.x);
    const py = Number(edit.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const ix = Math.trunc(px);
    // Pixel edits are authored against the un-bobbed component; lift them by
    // the same dy the component shifts so they land on the same logical pixel.
    const iy = Math.trunc(py) - bobDy;
    if (ix < 0 || ix >= CELL_W) continue;
    if (iy < 0 || iy >= CELL_H) continue;
    const dstIdx = ((baseY + iy) * sheetWidth + (baseX + ix)) * 4;
    if (edit.color === 'clear') {
      target.data[dstIdx + 0] = 0;
      target.data[dstIdx + 1] = 0;
      target.data[dstIdx + 2] = 0;
      target.data[dstIdx + 3] = 0;
      applied++;
      continue;
    }
    const rgb = parseHexColor(edit.color);
    if (!rgb) continue;
    target.data[dstIdx + 0] = rgb.r;
    target.data[dstIdx + 1] = rgb.g;
    target.data[dstIdx + 2] = rgb.b;
    target.data[dstIdx + 3] = 255;
    applied++;
  }
  return applied;
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

function blitComponent(target, col, row, componentPng, offset = [0, 0]) {
  if (componentPng.width !== CELL_W || componentPng.height !== CELL_H) {
    throw new Error(
      `Component PNG size mismatch (expected ${CELL_W}x${CELL_H}, got ${componentPng.width}x${componentPng.height})`
    );
  }
  const dx = Number.isFinite(offset?.[0]) ? Math.trunc(offset[0]) : 0;
  const dy = Number.isFinite(offset?.[1]) ? Math.trunc(offset[1]) : 0;
  const { x: baseX, y: baseY, sheetWidth } = getCellOffset(col, row, target.width);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const srcIdx = (y * CELL_W + x) * 4;
      const alpha = componentPng.data[srcIdx + 3];
      if (alpha === 0) continue;
      const shiftedX = x + dx;
      const shiftedY = y + dy;
      // Clip the shifted pixel to its own cell so it cannot bleed into a neighbor.
      if (shiftedX < 0 || shiftedX >= CELL_W) continue;
      if (shiftedY < 0 || shiftedY >= CELL_H) continue;
      const dstIdx = ((baseY + shiftedY) * sheetWidth + (baseX + shiftedX)) * 4;
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

// Recolor marker pixels in-place. Marker pixels always have two equal channels
// (the dominant pair) and one strictly lower off-channel — this distinguishes
// them from literal art colors. Brightness factor = dominant value (1.0 mid,
// 0.31 deep); off-channel value lifts toward white for highlight rows. Mirrors
// the sprite.glsl.ts shader so on-disk previews match runtime rendering.
function recolorMarkers(png, regiment) {
  const data = png.data;
  const eps = 0.01;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const isMag = Math.abs(r - b) < eps && g < r - eps && r > 0.1;
    const isCyn = Math.abs(g - b) < eps && r < g - eps && g > 0.1;
    const isYel = Math.abs(r - g) < eps && b < r - eps && r > 0.1;
    let slot = null, factor = 0, off = 0;
    if (isMag) { slot = regiment.primary; factor = r; off = g; }
    else if (isCyn) { slot = regiment.secondary; factor = g; off = r; }
    else if (isYel) { slot = regiment.tertiary; factor = r; off = b; }
    if (!slot) continue;
    let outR = Math.min(255, slot[0] * factor);
    let outG = Math.min(255, slot[1] * factor);
    let outB = Math.min(255, slot[2] * factor);
    const lift = off * 0.5;
    outR = outR * (1 - lift) + 255 * lift;
    outG = outG * (1 - lift) + 255 * lift;
    outB = outB * (1 - lift) + 255 * lift;
    data[i] = Math.round(outR);
    data[i + 1] = Math.round(outG);
    data[i + 2] = Math.round(outB);
  }
}

// A facing's pose entry can be either a bare array of frames
// (`[[layer-a, layer-b], ...]`) or the wrapped form
// `{ layers: [[...]], weapon: {...} }` introduced when per-pose weapon
// attachment was added. Returns the underlying frames array (or null).
function framesOfFacingEntry(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.layers)) return value.layers;
  return null;
}

export function isMultiFrameOverride(override) {
  if (!override || typeof override !== 'object') return false;
  for (const value of Object.values(override)) {
    const frames = framesOfFacingEntry(value);
    if (frames && frames.length > 0) {
      return Array.isArray(frames[0]);
    }
  }
  return false;
}

export function frameCount(override) {
  let n = 0;
  for (const value of Object.values(override)) {
    const frames = framesOfFacingEntry(value);
    if (frames) n = Math.max(n, frames.length);
  }
  return n;
}

export function resolveEffectiveLayers(overrideLayers, configLayers) {
  return (overrideLayers && overrideLayers.length > 0) ? overrideLayers : configLayers;
}

export function frameSliceOverride(override, frameIdx) {
  const out = {};
  for (const [facing, value] of Object.entries(override)) {
    const frames = framesOfFacingEntry(value);
    if (!frames || frames.length === 0) continue;
    const useIdx = Math.min(frameIdx, frames.length - 1);
    const layers = frames[useIdx];
    if (!Array.isArray(layers)) {
      throw new Error(`Pose '${facing}' frame ${frameIdx} is not a layer array (got ${typeof layers}).`);
    }
    out[facing] = layers;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kitId = args.get('kit') ?? 'line-infantry';
  const kitPath = resolve(ROOT, `public/components/kits/${kitId}.json`);
  const kit = loadJson(kitPath);

  const regiments = loadJson(REGIMENTS_PATH);
  const bakedRegiment =
    (Array.isArray(regiments) && regiments.find((r) => r && r.id === 'british-line')) ||
    (Array.isArray(regiments) && regiments[0]) ||
    null;
  if (!bakedRegiment) {
    throw new Error(`Could not load any regiment from ${REGIMENTS_PATH}`);
  }
  console.log(`Recoloring with regiment: ${bakedRegiment.label} (${bakedRegiment.id})`);

  const registry = loadJson(REGISTRY_PATH);
  const componentsById = new Map(registry.components.map((entry) => [entry.id, entry]));

  const allOffsets = loadOffsets(OFFSETS_PATH);
  const kitOffsetsByPose = (allOffsets && typeof allOffsets[kitId] === 'object' && allOffsets[kitId]) || {};

  const allPixelEdits = loadPixelEdits(PIXEL_EDITS_PATH);
  const kitPixelEditsByPose = (allPixelEdits && typeof allPixelEdits[kitId] === 'object' && allPixelEdits[kitId]) || {};

  function poseFacingMap(rootByPose, poseId, facing) {
    const poseMap = (rootByPose && typeof rootByPose[poseId] === 'object' && rootByPose[poseId]) || null;
    if (!poseMap) return {};
    const facingMap = (poseMap[facing] && typeof poseMap[facing] === 'object') ? poseMap[facing] : {};
    return facingMap;
  }

  function lookupOffset(poseId, facing, componentId) {
    const own = poseFacingMap(kitOffsetsByPose, poseId, facing);
    if (Array.isArray(own[componentId])) return own[componentId];
    if (poseId !== 'idle') {
      const fallback = poseFacingMap(kitOffsetsByPose, 'idle', facing);
      if (Array.isArray(fallback[componentId])) return fallback[componentId];
    }
    return [0, 0];
  }

  function lookupPixelEdits(poseId, facing, componentId) {
    const own = poseFacingMap(kitPixelEditsByPose, poseId, facing);
    if (Array.isArray(own[componentId])) return own[componentId];
    if (poseId !== 'idle') {
      const fallback = poseFacingMap(kitPixelEditsByPose, 'idle', facing);
      if (Array.isArray(fallback[componentId])) return fallback[componentId];
    }
    return null;
  }

  const baseAtlasPath = resolve(ROOT, args.get('base') ?? kit.baseAtlas ?? 'public/sprites/line-infantry.png');
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

  // If the kit declares no usable base atlas (e.g. a fully-procedural kit
  // like cannon-12), fall back to a transparent 3x3-cell canvas. clearCell()
  // wipes each cell anyway before compositing, so the base is purely a
  // backdrop for cells that aren't explicitly drawn.
  let baseAtlas;
  try {
    baseAtlas = PNG.sync.read(readFileSync(baseAtlasPath));
  } catch (_err) {
    const emptyW = CELL_W * 3;
    const emptyH = CELL_H * 3;
    baseAtlas = new PNG({ width: emptyW, height: emptyH });
    baseAtlas.data.fill(0);
    mkdirSync(dirname(baseAtlasPath), { recursive: true });
    writeFileSync(baseAtlasPath, PNG.sync.write(baseAtlas));
    console.log(`Created empty base atlas: ${baseAtlasPath}`);
  }
  recolorMarkers(baseAtlas, bakedRegiment);

  console.log(`Using base atlas: ${baseAtlasPath}`);
  console.log(`Writing output atlas: ${outputAtlasPath}`);

  const previewScale = clampScale(scale);

  function compositeAndWrite(poseId, layerOverrides, atlasPath, previewPath, headerLabel, bobBody = 0, layerFilter = null) {
    // Build the markers atlas first using the raw (un-recolored) base atlas
    // and raw component PNGs. This preserves the marker pixel scheme so the
    // gallery can recolor client-side at runtime.
    let rawBase;
    try {
      rawBase = PNG.sync.read(readFileSync(baseAtlasPath));
    } catch (_err) {
      rawBase = new PNG({ width: CELL_W * 3, height: CELL_H * 3 });
      rawBase.data.fill(0);
    }
    const markersTarget = new PNG({ width: rawBase.width, height: rawBase.height });
    markersTarget.data.set(rawBase.data);

    if (headerLabel) console.log(`\n${headerLabel}`);

    for (const [facing, config] of Object.entries(kit.facings)) {
      if (!config.cell) {
        throw new Error(`Kit ${kitId} facing ${facing} is missing a cell coordinate.`);
      }
      const [col, row] = config.cell;
      // Per-pose override may be either a bare array of layer ids (legacy)
      // or `{ layers, weapon? }` (post per-pose-weapon-attachment migration).
      const rawOverride = layerOverrides && layerOverrides[facing];
      const overrideLayers = Array.isArray(rawOverride)
        ? rawOverride
        : (rawOverride && Array.isArray(rawOverride.layers) ? rawOverride.layers : null);
      const layersBase = resolveEffectiveLayers(overrideLayers, config.layers);
      // Detachable variants drop layers whose ids match a filter (e.g. all
      // shako-* layers for a `--no-head` variant). Applied per-facing so the
      // un-baked sprite is just the body without the part.
      const layers = layerFilter ? layersBase.filter((id) => layerFilter(id)) : layersBase;
      console.log(`\nCompositing facing ${facing} at cell (${col}, ${row})`);
      clearCell(markersTarget, col, row);
      for (const id of layers) {
        const entry = componentsById.get(id);
        if (!entry) {
          throw new Error(`Unknown component "${id}" referenced by kit ${kitId}.`);
        }
        const componentPath = resolve(COMPONENT_ROOT, entry.path);
        const componentPng = PNG.sync.read(readFileSync(componentPath));
        // No recolor here — markers go through raw to the markers atlas.
        const offset = lookupOffset(poseId, facing, id);
        // Per-frame body bob lifts every layer uniformly (negative dy = up),
        // so the figure rises and falls across the cycle while the leg cycle
        // already drawn into the trouser PNG remains visible inside the lift.
        const bobbedOffset = bobBody ? [offset[0], offset[1] - bobBody] : offset;
        blitComponent(markersTarget, col, row, componentPng, bobbedOffset);
        const layerEdits = lookupPixelEdits(poseId, facing, id);
        const editsApplied = layerEdits ? applyPixelEdits(markersTarget, col, row, layerEdits, bobBody) : 0;
        const tagParts = [`pose=${poseId}`];
        if (bobBody) tagParts.push(`bob=${bobBody}`);
        if (offset[0] || offset[1]) tagParts.push(`offset ${offset[0]},${offset[1]}`);
        if (editsApplied > 0) tagParts.push(`+${editsApplied} pixel edits`);
        console.log(`  + ${id} (${tagParts.join(', ')})`);
      }
    }

    // Write markers atlas (no preview for markers — gallery does live recolor).
    const markersAtlasPath = withSuffix(atlasPath, '-markers');
    mkdirSync(dirname(markersAtlasPath), { recursive: true });
    writeFileSync(markersAtlasPath, PNG.sync.write(markersTarget));
    console.log(`✔ Markers atlas written: ${markersAtlasPath}`);

    // Build the recolored (baked English) atlas as a copy of the markers atlas.
    const target = new PNG({ width: markersTarget.width, height: markersTarget.height });
    target.data.set(markersTarget.data);
    recolorMarkers(target, bakedRegiment);

    mkdirSync(dirname(atlasPath), { recursive: true });
    writeFileSync(atlasPath, PNG.sync.write(target));
    console.log(`✔ Atlas written: ${atlasPath}`);

    if (previewPath) {
      const preview = scaleNearest(target, previewScale);
      mkdirSync(dirname(previewPath), { recursive: true });
      writeFileSync(previewPath, PNG.sync.write(preview));
      console.log(`✔ Preview written (${previewScale}x): ${previewPath}`);
    }
  }

  // Detachable parts produce parallel `--no-<name>` composites. Each detachable
  // declares a `layerPrefix` (matched as a string prefix against component ids)
  // — the variant build skips every matching layer so the runtime can swap to
  // a hatless body when the part falls off. `null` means "no filter, base build".
  const detachables = Array.isArray(kit.detachables) ? kit.detachables : [];
  const variants = [
    { suffix: '', filter: null },
    ...detachables.map((d) => ({
      suffix: `--no-${d.name}`,
      filter: (layerId) => !layerId.startsWith(d.layerPrefix),
    })),
  ];

  for (const variant of variants) {
    const variantBaseAtlas = variant.suffix ? withSuffix(outputAtlasPath, variant.suffix) : outputAtlasPath;
    const variantBasePreview = variant.suffix && outputPreviewPath
      ? withSuffix(outputPreviewPath, variant.suffix)
      : outputPreviewPath;

    // Base composite (idle pose).
    compositeAndWrite(
      'idle',
      null,
      variantBaseAtlas,
      variantBasePreview,
      `Compositing base (idle)${variant.suffix ? ` ${variant.suffix}` : ''}`,
      0,
      variant.filter,
    );

    // Per-pose composites (S-only overrides for now; other facings fall back to base layers).
    if (kit.poses && typeof kit.poses === 'object') {
      for (const [poseId, override] of Object.entries(kit.poses)) {
        if (isMultiFrameOverride(override)) {
          const n = frameCount(override);
          // `bob.body` is a non-directional sibling of the per-facing entries —
          // an integer-px lift array, length = frame count. The helper functions
          // (framesOfFacingEntry) already filter it out of multi-frame iteration.
          const bob = (override && typeof override === 'object' && override.bob) || null;
          const bodyBobArr = bob && Array.isArray(bob.body) ? bob.body : null;
          if (bodyBobArr && bodyBobArr.length !== n) {
            console.warn(
              `[build-soldier-components] ${poseId}.bob.body length ${bodyBobArr.length} ` +
              `does not match frame count ${n} — extra/missing values clamp to 0.`,
            );
          }
          for (let i = 0; i < n; i++) {
            const sliced = frameSliceOverride(override, i);
            const bobBody = bodyBobArr && Number.isFinite(bodyBobArr[i]) ? (bodyBobArr[i] | 0) : 0;
            const poseAtlasPath = withSuffix(outputAtlasPath, `-${poseId}-${i}${variant.suffix}`);
            const posePreviewPath = outputPreviewPath ? withSuffix(outputPreviewPath, `-${poseId}-${i}${variant.suffix}`) : null;
            compositeAndWrite(
              poseId,
              sliced,
              poseAtlasPath,
              posePreviewPath,
              `Compositing pose: ${poseId} frame ${i}${variant.suffix ? ` ${variant.suffix}` : ''}`,
              bobBody,
              variant.filter,
            );
          }
        } else {
          const poseAtlasPath = withSuffix(outputAtlasPath, `-${poseId}${variant.suffix}`);
          const posePreviewPath = outputPreviewPath ? withSuffix(outputPreviewPath, `-${poseId}${variant.suffix}`) : null;
          compositeAndWrite(
            poseId,
            override,
            poseAtlasPath,
            posePreviewPath,
            `Compositing pose: ${poseId}${variant.suffix ? ` ${variant.suffix}` : ''}`,
            0,
            variant.filter,
          );
        }
      }
    }
  }
}

function withSuffix(filePath, suffix) {
  if (filePath.toLowerCase().endsWith('.png')) {
    return `${filePath.slice(0, -4)}${suffix}.png`;
  }
  return `${filePath}${suffix}`;
}

function clampScale(value) {
  const n = Number.isFinite(value) && value > 0 ? Math.floor(value) : 6;
  return Math.max(1, Math.min(16, n));
}

// Only run main() if this file is executed directly (not imported).
if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  await main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
