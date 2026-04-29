#!/usr/bin/env node
// Generates 8x8 placeholder gib PNGs into public/sprites/gibs/.
// Marker pixels (#FF0000) become team primary at runtime via the existing
// marker-substitution shader path used by units and weapons.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'public', 'sprites', 'gibs');
const W = 8, H = 8;

// Color palette (all 4-byte RGBA).
const SKIN  = [0xc8, 0x95, 0x6d, 0xff];
const BLOOD = [0x86, 0x1a, 0x14, 0xff];
const DARK  = [0x1a, 0x14, 0x10, 0xff];
const MARK  = [0xff, 0x00, 0x00, 0xff]; // team-tinted at runtime
const NONE  = [0, 0, 0, 0];

function newPng() {
  const png = new PNG({ width: W, height: H });
  // Fill transparent.
  for (let i = 0; i < W * H * 4; i += 4) {
    png.data[i] = 0; png.data[i+1] = 0; png.data[i+2] = 0; png.data[i+3] = 0;
  }
  return png;
}

function set(png, x, y, [r, g, b, a]) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  png.data[i] = r; png.data[i+1] = g; png.data[i+2] = b; png.data[i+3] = a;
}

function write(name, drawer) {
  const png = newPng();
  drawer(png);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${name}.png`), PNG.sync.write(png));
  console.log(`[draw-gib-chunks] wrote ${name}.png`);
}

// head: round-ish skin blob with dark dot eyes.
write('head', (p) => {
  const skin = [[2,2],[3,2],[4,2],[5,2],[2,3],[3,3],[4,3],[5,3],[2,4],[3,4],[4,4],[5,4],[3,5],[4,5]];
  for (const [x,y] of skin) set(p, x, y, SKIN);
  set(p, 3, 3, DARK); set(p, 4, 3, DARK);
});

// arm: skin tube with red marker stripe (uniform sleeve cuff).
write('arm', (p) => {
  for (let y = 1; y <= 6; y++) { set(p, 3, y, SKIN); set(p, 4, y, SKIN); }
  set(p, 3, 6, MARK); set(p, 4, 6, MARK);
  set(p, 3, 7, BLOOD); set(p, 4, 7, BLOOD);
});

// leg: dark-trousered tube with blood at the top.
write('leg', (p) => {
  for (let y = 1; y <= 6; y++) { set(p, 3, y, DARK); set(p, 4, y, DARK); }
  set(p, 3, 0, BLOOD); set(p, 4, 0, BLOOD);
  set(p, 3, 7, DARK); set(p, 4, 7, DARK);
});

// torso: marker square with crossbelts (simple).
write('torso', (p) => {
  for (let y = 1; y <= 6; y++) for (let x = 2; x <= 5; x++) set(p, x, y, MARK);
  // crossbelt: white-ish diagonal — just a couple pixels of light.
  set(p, 2, 2, [0xe8, 0xe2, 0xc8, 0xff]);
  set(p, 5, 5, [0xe8, 0xe2, 0xc8, 0xff]);
});

// hat: shako shape (dark with red top band marker).
write('hat', (p) => {
  for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) set(p, x, y, DARK);
  for (let x = 2; x <= 5; x++) set(p, x, 2, MARK);
});

// meat-blob: tiny irregular blood splat.
write('meat-blob', (p) => {
  const pts = [[3,3],[4,3],[3,4],[4,4],[2,4],[5,3]];
  for (const [x, y] of pts) set(p, x, y, BLOOD);
});

// arm-uniformed: slim sleeve sliver — uniform-marker red, dark cuff, blood at the cut.
write('arm-uniformed', (p) => {
  set(p, 3, 1, BLOOD);
  for (let y = 2; y <= 5; y++) set(p, 3, y, MARK);
  set(p, 3, 6, DARK);
});

// arm-bare: thin flesh sliver — visibly thinner than the uniformed version.
write('arm-bare', (p) => {
  set(p, 3, 2, BLOOD);
  for (let y = 3; y <= 6; y++) set(p, 3, y, SKIN);
});

// leg-trousered: slim trouser sliver — buff trouser color with dark boot at the bottom.
write('leg-trousered', (p) => {
  set(p, 3, 1, BLOOD);
  for (let y = 2; y <= 5; y++) set(p, 3, y, [0xe8, 0xe2, 0xc8, 0xff]);
  set(p, 3, 6, DARK);
  set(p, 3, 7, DARK);
});

// leg-bare: thin flesh sliver — same slimming treatment as arm-bare.
write('leg-bare', (p) => {
  set(p, 3, 2, BLOOD);
  for (let y = 3; y <= 7; y++) set(p, 3, y, SKIN);
});

console.log('[draw-gib-chunks] done — wrote 10 chunk(s)');
