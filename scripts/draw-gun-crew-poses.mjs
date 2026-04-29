#!/usr/bin/env node
// Procedural pixel sprites for the gun crew (Phase 2): tools, idle composites,
// and 4-frame reload animations for sponger / rammer / loader / gunner.
//
// Outputs:
//   * 32 tool sprites at public/sprites/components/tools/gun-crew-{tool}-<dir>.png
//     (4 tools x 8 long-name dirs)
//   * 32 idle body+tool composites at
//       public/sprites/poses/gun-crew-{role}/idle/<DIR>/0/0.png
//   * 128 reload body+tool composites at
//       public/sprites/poses/gun-crew-{role}/reloading/<DIR>/0/<frame>.png
//
// Registry: 32 new entries appended (idempotently) to
//   public/components/index.json under `components`.
//
// Authoring notes:
//   * Canvas is 32x36 RGBA, transparent background, bottom-anchored.
//   * Bodies are blitted from public/sprites/poses/line-infantry/idle/<DIR>/0/0.png.
//   * Reload animation runs at ~1 frame/second (slow drill cadence), so frames
//     don't need to flow smoothly — they need to read.
//   * All values are coarse pixel deltas (1-2 px shifts) for readable silhouettes.

import { PNG } from 'pngjs';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPONENTS = resolve(ROOT, 'public/sprites/components');
const POSES = resolve(ROOT, 'public/sprites/poses');
const REGISTRY_PATH = resolve(ROOT, 'public/components/index.json');

const W = 32;
const H = 36;

const DIRS_LONG = [
  'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest',
];
const SHORT = {
  north: 'N', northeast: 'NE', east: 'E', southeast: 'SE',
  south: 'S', southwest: 'SW', west: 'W', northwest: 'NW',
};

// =====================================================================
// PALETTE
// =====================================================================
const PAL = {
  woodHi: '#8a6438',
  woodMid: '#6b4a2a',
  woodShade: '#3f2a16',
  spongeDark: '#1a0e0e',
  spongeFleck: '#3a2424',
  clothBrown: '#7a5230',
  clothShade: '#4a3018',
  metalHi: '#c0c4c8',
  metalMid: '#a0a4a8',
  metalShade: '#5a5e64',
  matchTip: '#ff8030',
};

// =====================================================================
// PIXEL HELPERS
// =====================================================================

function makeSprite() {
  const p = new PNG({ width: W, height: H, colorType: 6 });
  p.data.fill(0);
  return p;
}

function setPx(p, x, y, hex, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const i = (y * W + x) * 4;
  p.data[i + 0] = r;
  p.data[i + 1] = g;
  p.data[i + 2] = b;
  p.data[i + 3] = a;
}

function vline(p, x, y0, y1, hex) {
  for (let y = y0; y <= y1; y++) setPx(p, x, y, hex);
}

function hline(p, y, x0, x1, hex) {
  for (let x = x0; x <= x1; x++) setPx(p, x, y, hex);
}

function rect(p, x0, y0, x1, y1, hex) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) setPx(p, x, y, hex);
  }
}

function writePng(p, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, PNG.sync.write(p));
}

// Mirror a sprite horizontally about x=W/2 in place.
function mirrorX(p) {
  const out = makeSprite();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const a = p.data[si + 3];
      if (a === 0) continue;
      const tx = W - 1 - x;
      const ti = (y * W + tx) * 4;
      out.data[ti + 0] = p.data[si + 0];
      out.data[ti + 1] = p.data[si + 1];
      out.data[ti + 2] = p.data[si + 2];
      out.data[ti + 3] = a;
    }
  }
  // Copy back into p so caller's reference is preserved.
  p.data.set(out.data);
}

// =====================================================================
// BODY LOADER
// =====================================================================

function loadBodyIdle(dirShort) {
  const path = resolve(POSES, `line-infantry/idle/${dirShort}/0/0.png`);
  const buf = readFileSync(path);
  return PNG.sync.read(buf);
}

function blitBody(target, body, dx = 0, dy = 0) {
  for (let y = 0; y < body.height; y++) {
    for (let x = 0; x < body.width; x++) {
      const si = (y * body.width + x) * 4;
      const a = body.data[si + 3];
      if (a === 0) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      const ti = (ty * W + tx) * 4;
      target.data[ti + 0] = body.data[si + 0];
      target.data[ti + 1] = body.data[si + 1];
      target.data[ti + 2] = body.data[si + 2];
      target.data[ti + 3] = a;
    }
  }
}

// =====================================================================
// FACING CLASSIFICATION
// East-side (right-handed grip drawn with tool to the right of the body).
// West-side reuses east-side art mirrored.
// N/S use centered drawings.
// =====================================================================

const EAST_SIDE = new Set(['E', 'NE', 'SE']);
const WEST_SIDE = new Set(['W', 'NW', 'SW']);

// =====================================================================
// TOOL DRAWING — all authored facing east (right side).
// Each tool function: (target, dirShort, anchorX, anchorY, frameOffset) -> void
// Use anchorX/anchorY to place the gripping hand. frameOffset 0..3 drives
// reload-frame variations (tilt/extend).
// =====================================================================

// SPONGE — long pole with dark fluffy head at the top.
function drawSpongeEast(p, ax, ay, frameOffset) {
  // Frame 0: vertical, head up. Frame 1: tilt slightly forward (head leans
  // east). Frame 2: presented forward (more horizontal). Frame 3: pulled back.
  const tilt = [0, 1, 2, -1][frameOffset] ?? 0;
  // Pole runs from anchor up and forward by tilt pixels.
  const poleTopY = ay - 10;
  // Draw pole as a 1px line from (ax, ay) to (ax + tilt, poleTopY).
  // Use simple stepped interpolation.
  const steps = ay - poleTopY;
  for (let s = 0; s <= steps; s++) {
    const t = s / Math.max(1, steps);
    const x = Math.round(ax + tilt * t);
    const y = ay - s;
    setPx(p, x, y, PAL.woodMid);
    if (s % 3 === 0 && s > 0) setPx(p, x, y, PAL.woodShade);
  }
  // Sponge head at top: 3x3 block centered on pole tip.
  const hx = Math.round(ax + tilt);
  const hy = poleTopY - 1;
  rect(p, hx - 1, hy - 1, hx + 1, hy + 1, PAL.spongeDark);
  setPx(p, hx - 1, hy - 1, PAL.spongeFleck);
  setPx(p, hx + 1, hy + 1, PAL.spongeFleck);
}

// RAMMER — same pole as sponge, 2x2 wood block at top.
function drawRammerEast(p, ax, ay, frameOffset) {
  const tilt = [0, 1, 2, -1][frameOffset] ?? 0;
  const poleTopY = ay - 10;
  const steps = ay - poleTopY;
  for (let s = 0; s <= steps; s++) {
    const t = s / Math.max(1, steps);
    const x = Math.round(ax + tilt * t);
    const y = ay - s;
    setPx(p, x, y, PAL.woodMid);
    if (s % 3 === 0 && s > 0) setPx(p, x, y, PAL.woodShade);
  }
  const hx = Math.round(ax + tilt);
  const hy = poleTopY - 1;
  rect(p, hx, hy, hx + 1, hy + 1, PAL.woodHi);
  setPx(p, hx, hy + 1, PAL.woodShade);
}

// CARTRIDGE — small cloth sack at hip height. frame 1 "presented forward":
// shifted up and east. (Frame 2 is handled at composite layer — sack absent.)
function drawCartridgeEast(p, ax, ay, frameOffset) {
  // Default at-hip position.
  let x0 = ax;
  let y0 = ay;
  if (frameOffset === 1) {
    // Lifted/presented — a bit higher and forward.
    x0 = ax + 2;
    y0 = ay - 3;
  } else if (frameOffset === 3) {
    // After deposit — tucked back slightly.
    x0 = ax - 1;
    y0 = ay + 1;
  }
  // 4x4 sack
  rect(p, x0, y0, x0 + 3, y0 + 3, PAL.clothBrown);
  // Shading: bottom + right column
  hline(p, y0 + 3, x0, x0 + 3, PAL.clothShade);
  vline(p, x0 + 3, y0, y0 + 3, PAL.clothShade);
  // Tie at top
  setPx(p, x0 + 1, y0 - 1, PAL.clothShade);
}

// LINSTOCK — taller pole with metal match-holder + ember at top. Frame 1
// "at vent": tipped forward toward the cannon vent.
function drawLinstockEast(p, ax, ay, frameOffset) {
  const tilt = [0, 1, 0, 0][frameOffset] ?? 0;
  // Frame 1 tips it more aggressively (gunner reaches to vent).
  const tiltScale = frameOffset === 1 ? 3 : tilt;
  const poleTopY = ay - 14;
  const steps = ay - poleTopY;
  for (let s = 0; s <= steps; s++) {
    const t = s / Math.max(1, steps);
    const x = Math.round(ax + tiltScale * t);
    const y = ay - s;
    setPx(p, x, y, PAL.woodMid);
    if (s % 4 === 0 && s > 0) setPx(p, x, y, PAL.woodShade);
  }
  const hx = Math.round(ax + tiltScale);
  const hy = poleTopY;
  // 1x2 metal match-holder
  setPx(p, hx, hy - 1, PAL.metalMid);
  setPx(p, hx, hy - 2, PAL.metalHi);
  // Glowing match tip
  setPx(p, hx + 1, hy - 2, PAL.matchTip);
}

// =====================================================================
// FACING ROUTER — picks east-side base + applies mirror for west-side.
// For N/S we author a simple centered version (vertical pole hidden behind
// the body for N — drawn as a small tip above the head; tucked low for S).
// =====================================================================

function drawSpongeForFacing(p, dirShort, ax, ay, frameOffset) {
  if (dirShort === 'N') {
    // Behind the soldier, pole tip pokes above head.
    setPx(p, 16, 6, PAL.spongeDark);
    setPx(p, 16, 7, PAL.spongeDark);
    setPx(p, 17, 6, PAL.spongeFleck);
    vline(p, 16, 8, 12, PAL.woodMid);
    return;
  }
  if (dirShort === 'S') {
    // Held in front, slightly low.
    drawSpongeEast(p, 16, ay, frameOffset);
    return;
  }
  if (EAST_SIDE.has(dirShort)) {
    drawSpongeEast(p, ax, ay, frameOffset);
    return;
  }
  // West-side: draw on a scratch sprite then mirror onto target.
  const scratch = makeSprite();
  drawSpongeEast(scratch, ax, ay, frameOffset);
  mirrorX(scratch);
  blitBody(p, { width: W, height: H, data: scratch.data });
}

function drawRammerForFacing(p, dirShort, ax, ay, frameOffset) {
  if (dirShort === 'N') {
    // Wood block tip behind head.
    rect(p, 15, 6, 16, 7, PAL.woodHi);
    vline(p, 16, 8, 12, PAL.woodMid);
    return;
  }
  if (dirShort === 'S') {
    drawRammerEast(p, 16, ay, frameOffset);
    return;
  }
  if (EAST_SIDE.has(dirShort)) {
    drawRammerEast(p, ax, ay, frameOffset);
    return;
  }
  const scratch = makeSprite();
  drawRammerEast(scratch, ax, ay, frameOffset);
  mirrorX(scratch);
  blitBody(p, { width: W, height: H, data: scratch.data });
}

function drawCartridgeForFacing(p, dirShort, ax, ay, frameOffset) {
  if (dirShort === 'N') {
    // Visible behind back as a small bump.
    rect(p, 15, 22, 16, 24, PAL.clothBrown);
    setPx(p, 16, 24, PAL.clothShade);
    return;
  }
  if (dirShort === 'S') {
    // Held in front of body.
    drawCartridgeEast(p, 14, ay, frameOffset);
    return;
  }
  if (EAST_SIDE.has(dirShort)) {
    drawCartridgeEast(p, ax, ay, frameOffset);
    return;
  }
  const scratch = makeSprite();
  drawCartridgeEast(scratch, ax, ay, frameOffset);
  mirrorX(scratch);
  blitBody(p, { width: W, height: H, data: scratch.data });
}

function drawLinstockForFacing(p, dirShort, ax, ay, frameOffset) {
  if (dirShort === 'N') {
    // Match-holder peeks above head.
    setPx(p, 16, 4, PAL.metalHi);
    setPx(p, 16, 5, PAL.metalMid);
    setPx(p, 17, 4, PAL.matchTip);
    vline(p, 16, 6, 12, PAL.woodMid);
    return;
  }
  if (dirShort === 'S') {
    drawLinstockEast(p, 16, ay, frameOffset);
    return;
  }
  if (EAST_SIDE.has(dirShort)) {
    drawLinstockEast(p, ax, ay, frameOffset);
    return;
  }
  const scratch = makeSprite();
  drawLinstockEast(scratch, ax, ay, frameOffset);
  mirrorX(scratch);
  blitBody(p, { width: W, height: H, data: scratch.data });
}

// =====================================================================
// COMPOSITES
// =====================================================================

function computeBodyOffset(role, dirShort, frameIdx) {
  const fwdMap = {
    sponger: [0, +1, +2, -1],
    rammer:  [0, +1, +2, -1],
    loader:  [0, +1,  0, -1],
    gunner:  [0, +1, -1,  0],
  };
  const fwd = fwdMap[role][frameIdx];
  const dirMap = {
    N:  [ 0, -1], NE: [+1, -1], E:  [+1,  0], SE: [+1, +1],
    S:  [ 0, +1], SW: [-1, +1], W:  [-1,  0], NW: [-1, -1],
  };
  const [vx, vy] = dirMap[dirShort];
  return { dx: Math.round(fwd * vx), dy: Math.round(fwd * vy) };
}

const ROLE_TO_TOOL = {
  sponger: { tool: 'sponge',    drawFn: drawSpongeForFacing },
  rammer:  { tool: 'rammer',    drawFn: drawRammerForFacing },
  loader:  { tool: 'cartridge', drawFn: drawCartridgeForFacing },
  gunner:  { tool: 'linstock',  drawFn: drawLinstockForFacing },
};

function makeIdleComposite(role, dirShort) {
  const { drawFn } = ROLE_TO_TOOL[role];
  const target = makeSprite();
  const body = loadBodyIdle(dirShort);
  blitBody(target, body);
  drawFn(target, dirShort, 14, 18, 0);
  return target;
}

function makeReloadComposite(role, dirShort, frameIdx) {
  const { drawFn } = ROLE_TO_TOOL[role];
  const target = makeSprite();
  const body = loadBodyIdle(dirShort);
  const { dx, dy } = computeBodyOffset(role, dirShort, frameIdx);
  blitBody(target, body, dx, dy);

  // Loader frame 2: cartridge has been deposited — draw no tool.
  const skipTool = role === 'loader' && frameIdx === 2;
  if (!skipTool) {
    drawFn(target, dirShort, 14 + dx, 18 + dy, frameIdx);
  }
  return target;
}

// =====================================================================
// EMITTERS
// =====================================================================

function emitTools() {
  const drawers = [
    { tool: 'sponge',    drawFn: drawSpongeForFacing },
    { tool: 'rammer',    drawFn: drawRammerForFacing },
    { tool: 'cartridge', drawFn: drawCartridgeForFacing },
    { tool: 'linstock',  drawFn: drawLinstockForFacing },
  ];
  let count = 0;
  for (const dirLong of DIRS_LONG) {
    const dirShort = SHORT[dirLong];
    for (const { tool, drawFn } of drawers) {
      const target = makeSprite();
      drawFn(target, dirShort, 14, 18, 0);
      const out = resolve(COMPONENTS, `tools/gun-crew-${tool}-${dirLong}.png`);
      writePng(target, out);
      count++;
    }
  }
  console.log(`  ${count} tool sprites`);
}

function emitIdle() {
  let count = 0;
  for (const dirLong of DIRS_LONG) {
    const dirShort = SHORT[dirLong];
    for (const role of Object.keys(ROLE_TO_TOOL)) {
      const target = makeIdleComposite(role, dirShort);
      const out = resolve(POSES, `gun-crew-${role}/idle/${dirShort}/0/0.png`);
      writePng(target, out);
      count++;
    }
  }
  console.log(`  ${count} idle composites`);
}

function emitReload() {
  let count = 0;
  for (const dirLong of DIRS_LONG) {
    const dirShort = SHORT[dirLong];
    for (const role of Object.keys(ROLE_TO_TOOL)) {
      for (let frame = 0; frame < 4; frame++) {
        const target = makeReloadComposite(role, dirShort, frame);
        const out = resolve(POSES, `gun-crew-${role}/reloading/${dirShort}/0/${frame}.png`);
        writePng(target, out);
        count++;
      }
    }
  }
  console.log(`  ${count} reload composites`);
}

// =====================================================================
// REGISTRY UPDATE
// =====================================================================

function registryEntries() {
  const tools = ['sponge', 'rammer', 'cartridge', 'linstock'];
  const entries = [];
  for (const dirLong of DIRS_LONG) {
    const dirShort = SHORT[dirLong];
    for (const tool of tools) {
      entries.push({
        id: `gun-crew-${tool}-${dirLong}`,
        type: 'tool',
        category: tool,
        facings: [dirShort],
        path: `tools/gun-crew-${tool}-${dirLong}.png`,
        pivot: [16, 32],
        notes: `Gun crew ${tool}, procedural.`,
      });
    }
  }
  return entries;
}

function updateRegistry() {
  const raw = readFileSync(REGISTRY_PATH, 'utf8');
  const reg = JSON.parse(raw);
  if (!reg.components || !Array.isArray(reg.components)) {
    throw new Error('public/components/index.json is malformed (missing components array)');
  }
  const existingIds = new Set(reg.components.map((c) => c.id));
  let added = 0;
  for (const entry of registryEntries()) {
    if (existingIds.has(entry.id)) continue;
    reg.components.push(entry);
    added++;
  }
  if (added > 0) {
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
    console.log(`  registered ${added} new gun-crew tool entries`);
  } else {
    console.log('  registry already up to date');
  }
}

// =====================================================================
// MAIN
// =====================================================================

console.log('Drawing gun-crew tools...');
emitTools();
console.log('Drawing gun-crew idle composites...');
emitIdle();
console.log('Drawing gun-crew reload composites...');
emitReload();
console.log('Updating component registry...');
updateRegistry();
console.log('Done.');
