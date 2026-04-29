#!/usr/bin/env node
// Generates the kit-flavor 8x8 gib PNGs into public/sprites/gibs/.
// These complement the generic chunks in draw-gib-chunks.mjs — boot, musket
// stock, cartridge box, epaulette, severed hand, finger. Used by line-infantry
// (and future kits) via the per-kit gibChunks block in the kit JSON.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'public', 'sprites', 'gibs');
const W = 8, H = 8;

// Palette — RGBA tuples. Tuned to sit alongside the existing gib art (warm
// fleshtone, uniform cream, dark leather, blood red).
const FLESH       = [0xc8, 0x95, 0x6d, 0xff];
const FLESH_HI    = [0xe0, 0xb0, 0x88, 0xff];
const BLOOD       = [0x86, 0x1a, 0x14, 0xff];
const LEATHER     = [0x1a, 0x10, 0x08, 0xff]; // boot / cartridge box near-black brown
const LEATHER_HI  = [0x3a, 0x26, 0x18, 0xff];
const WOOD_MID    = [0x6b, 0x42, 0x26, 0xff];
const WOOD_HI     = [0x8c, 0x5a, 0x32, 0xff];
const METAL       = [0x42, 0x3c, 0x40, 0xff]; // musket lockplate
const STRAP       = [0xd4, 0xc4, 0xa0, 0xff]; // cartridge-box strap (buff/cream)
const GOLD        = [0xc9, 0xa2, 0x40, 0xff];
const GOLD_HI     = [0xee, 0xcc, 0x70, 0xff];
const FRINGE      = [0x7a, 0x18, 0x18, 0xff]; // dark red epaulette tassel

function newPng() {
  const png = new PNG({ width: W, height: H });
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
  console.log(`[build-gib-chunks] wrote ${name}.png`);
}

// boot — side-on lower leg + boot, dark leather. Sole runs along the bottom row.
write('boot', (p) => {
  // Ankle/shaft (rows 2-4) tapers from narrow at top to fuller at the foot.
  set(p, 2, 2, LEATHER);
  set(p, 3, 2, LEATHER);
  set(p, 2, 3, LEATHER);
  set(p, 3, 3, LEATHER_HI);
  set(p, 2, 4, LEATHER);
  set(p, 3, 4, LEATHER);
  set(p, 4, 4, LEATHER);
  // Foot — extends forward.
  for (let x = 1; x <= 5; x++) set(p, x, 5, LEATHER);
  set(p, 3, 5, LEATHER_HI);
  for (let x = 1; x <= 6; x++) set(p, x, 6, LEATHER);
  // Sole row — slightly lighter to read as a heel/sole edge.
  for (let x = 1; x <= 6; x++) set(p, x, 7, LEATHER_HI);
});

// musket-stock — broken wooden stock fragment with metal lockplate hint.
write('musket-stock', (p) => {
  // Splintered top end.
  set(p, 2, 1, WOOD_HI);
  // Main body of the stock (diagonal grain).
  set(p, 2, 2, WOOD_MID);
  set(p, 3, 2, WOOD_HI);
  set(p, 2, 3, WOOD_MID);
  set(p, 3, 3, WOOD_HI);
  set(p, 4, 3, WOOD_MID);
  set(p, 3, 4, WOOD_HI);
  set(p, 4, 4, WOOD_MID);
  set(p, 3, 5, WOOD_MID);
  set(p, 4, 5, METAL);
  // Lockplate / butt corner.
  set(p, 4, 6, METAL);
  set(p, 5, 6, WOOD_MID);
  set(p, 4, 7, WOOD_MID);
  set(p, 5, 7, WOOD_MID);
});

// cartridge-box — black leather pouch with a buff strap trailing up-left.
write('cartridge-box', (p) => {
  // Strap (buff) running diagonally off the box.
  set(p, 1, 0, STRAP);
  set(p, 1, 1, STRAP);
  set(p, 2, 2, STRAP);
  // Box body.
  set(p, 2, 3, LEATHER);
  set(p, 3, 3, LEATHER);
  set(p, 4, 3, LEATHER);
  set(p, 2, 4, LEATHER);
  set(p, 3, 4, LEATHER_HI);
  set(p, 4, 4, LEATHER);
  set(p, 5, 4, LEATHER);
  set(p, 2, 5, LEATHER);
  set(p, 3, 5, LEATHER);
  set(p, 4, 5, LEATHER);
  set(p, 5, 5, LEATHER);
  set(p, 3, 6, LEATHER);
  set(p, 4, 6, LEATHER);
});

// epaulette — gold shoulder-piece with red fringe tassel.
write('epaulette', (p) => {
  // Gold crescent / strap at the top.
  set(p, 1, 1, GOLD);
  set(p, 2, 1, GOLD_HI);
  set(p, 3, 1, GOLD);
  set(p, 1, 2, GOLD);
  set(p, 2, 2, GOLD_HI);
  set(p, 3, 2, GOLD);
  set(p, 4, 2, GOLD);
  set(p, 2, 3, GOLD);
  set(p, 3, 3, GOLD);
  set(p, 4, 3, GOLD);
  // Red fringe tassels hanging down.
  set(p, 2, 4, FRINGE);
  set(p, 3, 4, FRINGE);
  set(p, 4, 4, FRINGE);
  set(p, 2, 5, FRINGE);
  set(p, 3, 5, FRINGE);
  set(p, 3, 6, FRINGE);
});

// hand — small severed hand. Kept narrower than the bare-arm sliver so it
// reads as a hand and not a forearm chunk.
write('hand', (p) => {
  // Fingertips.
  set(p, 3, 2, FLESH);
  set(p, 4, 2, FLESH);
  // Palm.
  set(p, 3, 3, FLESH_HI);
  set(p, 4, 3, FLESH);
  set(p, 3, 4, FLESH);
  set(p, 4, 4, FLESH);
  // Bloody wrist cut.
  set(p, 3, 5, BLOOD);
  set(p, 4, 5, BLOOD);
});

// finger — tiny severed finger (bloody tip).
write('finger', (p) => {
  set(p, 3, 3, FLESH);
  set(p, 3, 4, FLESH_HI);
  set(p, 3, 5, FLESH);
  set(p, 3, 6, BLOOD);
});

console.log('[build-gib-chunks] done — wrote 6 chunk(s)');
