// Shared musket pixel-art geometry. Every musket sprite in every redraw
// script paints through one of the four canonical painters below, optionally
// flipped horizontally and/or vertically. To change the look of a musket
// (e.g. lengthen the bayonet), edit the canonical here -- nowhere else.
//
// All canonicals paint into a 32x36 PNG buffer (alpha=0 background) at a
// fixed internal layout. The "butt heel" of the gun (the heel-most pixel of
// the buttstock) sits at a documented internal anchor (BUTT_X, BUTT_Y).
// Callers pass `(anchorX, anchorY)` plus optional flip flags; the painter
// blits the (possibly flipped) canonical into `target` so that the butt heel
// lands at `(anchorX, anchorY)` in `target`.
//
// Style: 2-pixel thick barrel + offset (parallel) bayonet line, brass band
// mid-shaft, brass lock plate, hammer pixel just outboard of the lock,
// stocked butt with a one-pixel "heel". This is the unified Brown-Bess look
// used across every facing/pose.

import { PNG } from 'pngjs';

const W = 32;
const H = 36;

export const PAL = {
  musketBarrel:     '#5C3A20',
  musketMuzzle:     '#2E1A0A',
  musketStock:      '#3F2A1B',
  musketStockHi:    '#6A4530',
  musketStockShade: '#241608',
  brass:            '#F5B044',
  hammer:           '#1A1820',
  bayonet:          '#B0B8C4',
  bayonetTip:       '#E8ECF2',
};

// ---- low-level pixel helpers (private) ----

function makeBuffer() {
  const p = new PNG({ width: W, height: H, colorType: 6 });
  p.data.fill(0);
  return p;
}

function setPixel(buf, x, y, hex) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const i = (y * W + x) * 4;
  buf.data[i + 0] = r;
  buf.data[i + 1] = g;
  buf.data[i + 2] = b;
  buf.data[i + 3] = 255;
}

function mirrorH(src) {
  const dst = makeBuffer();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const di = (y * W + (W - 1 - x)) * 4;
      dst.data[di + 0] = src.data[si + 0];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

function mirrorV(src) {
  const dst = makeBuffer();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const di = ((H - 1 - y) * W + x) * 4;
      dst.data[di + 0] = src.data[si + 0];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

// Blit non-transparent pixels from `src` into `target` at offset (dx, dy).
function blitInto(target, src, dx, dy) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      if (src.data[si + 3] === 0) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      const ti = (ty * W + tx) * 4;
      target.data[ti + 0] = src.data[si + 0];
      target.data[ti + 1] = src.data[si + 1];
      target.data[ti + 2] = src.data[si + 2];
      target.data[ti + 3] = src.data[si + 3];
    }
  }
}

// Shared helper for all 4 canonicals: paint `paintFn(temp)` into a temp
// buffer (with butt heel at canonical (buttX, buttY)), apply flips, then blit
// into `target` such that the butt heel lands at (anchorX, anchorY).
function renderWithAnchor(target, paintFn, buttX, buttY, anchorX, anchorY, opts) {
  const flipX = !!(opts && opts.flipX);
  const flipY = !!(opts && opts.flipY);
  let temp = makeBuffer();
  paintFn(temp);
  let nbx = buttX;
  let nby = buttY;
  if (flipX) {
    temp = mirrorH(temp);
    nbx = W - 1 - nbx;
  }
  if (flipY) {
    temp = mirrorV(temp);
    nby = H - 1 - nby;
  }
  const dx = anchorX - nbx;
  const dy = anchorY - nby;
  blitInto(target, temp, dx, dy);
}

// ---- canonical: vertical musket pointing UP ----
//
// 2-thick barrel along columns x=15-16. Butt at the bottom, muzzle near top
// of cell, bayonet on offset parallel column x=17 above the muzzle.
// Internal butt-heel anchor: (15, 19). Total length 16 rows so the gun fits
// in the cell whether anchored at chest (y~17) and pointed up OR pointed
// down via flipY.
//
//   y=4    bayonet tip (x=17)
//   y=5,6  bayonet (x=17)
//   y=7    bayonet base (x=17), T-socket pixel at x=15
//   y=8    muzzle (x=15,16) -- musketMuzzle dark
//   y=9..16  barrel (x=15,16) -- 8 rows of 2-thick barrel
//   y=13   brass band (x=15,16) overrides barrel
//   y=17   lock: (15) musketStock + (16) brass
//   x=14, y=17  hammer pixel outboard of lock
//   y=18   butt: (15) musketStockHi + (16) musketStock
//   y=19   butt heel: (15) musketStockHi  -- ANCHOR
const VERT_BUTT_X = 15;
const VERT_BUTT_Y = 19;
function paintVerticalCanonical(p) {
  // Bayonet on offset column x=17.
  setPixel(p, 17, 4, PAL.bayonetTip);
  setPixel(p, 17, 5, PAL.bayonet);
  setPixel(p, 17, 6, PAL.bayonet);
  setPixel(p, 17, 7, PAL.bayonet);
  // T-socket: in-line steel pixel in barrel column at the bayonet base row.
  setPixel(p, 15, 7, PAL.bayonet);
  // Muzzle (2-thick).
  setPixel(p, 15, 8, PAL.musketMuzzle);
  setPixel(p, 16, 8, PAL.musketMuzzle);
  // Barrel rows 9..16 (2-thick, 8 rows).
  for (let y = 9; y <= 16; y++) {
    setPixel(p, 15, y, PAL.musketBarrel);
    setPixel(p, 16, y, PAL.musketBarrel);
  }
  // Brass band mid-shaft (overrides barrel).
  setPixel(p, 15, 13, PAL.brass);
  setPixel(p, 16, 13, PAL.brass);
  // Lock at row 17 (left = wood, right = brass plate).
  setPixel(p, 15, 17, PAL.musketStock);
  setPixel(p, 16, 17, PAL.brass);
  // Hammer outboard of lock.
  setPixel(p, 14, 17, PAL.hammer);
  // Butt and butt heel.
  setPixel(p, 15, 18, PAL.musketStockHi);
  setPixel(p, 16, 18, PAL.musketStock);
  setPixel(p, 15, 19, PAL.musketStockHi);
}

export function paintMusketVertical(target, anchorX, anchorY, opts = {}) {
  renderWithAnchor(target, paintVerticalCanonical, VERT_BUTT_X, VERT_BUTT_Y, anchorX, anchorY, opts);
}

// ---- canonical: horizontal musket pointing RIGHT ----
//
// 2-thick barrel along rows 17-18. Butt at viewer's left, muzzle to the
// right, bayonet on offset row 16 above the muzzle.
// Internal butt-heel anchor: (13, 18).
//
//   (13,18)         butt heel (musketStockHi)  -- ANCHOR
//   (14,17)+(14,18) butt (musketStockHi + musketStock)
//   (15,17)+(15,18) lock (musketStock + brass)
//   (16-20, 17-18)  barrel (2-thick, 5 cols)
//   (18, 17-18)     brass band (overrides barrel cols at 18)
//   (21, 17-18)     muzzle
//   (22-25, 16)     bayonet (3 mid + tip on offset row above)
const HORIZ_BUTT_X = 13;
const HORIZ_BUTT_Y = 18;
function paintHorizontalCanonical(p) {
  // Butt heel.
  setPixel(p, 13, 18, PAL.musketStockHi);
  // Butt.
  setPixel(p, 14, 17, PAL.musketStockHi);
  setPixel(p, 14, 18, PAL.musketStock);
  // Lock.
  setPixel(p, 15, 17, PAL.musketStock);
  setPixel(p, 15, 18, PAL.brass);
  // Barrel (2-thick).
  for (let x = 16; x <= 20; x++) {
    setPixel(p, x, 17, PAL.musketBarrel);
    setPixel(p, x, 18, PAL.musketBarrel);
  }
  // Brass band.
  setPixel(p, 18, 17, PAL.brass);
  setPixel(p, 18, 18, PAL.brass);
  // Muzzle.
  setPixel(p, 21, 17, PAL.musketMuzzle);
  setPixel(p, 21, 18, PAL.musketMuzzle);
  // Bayonet on offset row above the barrel.
  setPixel(p, 22, 16, PAL.bayonet);
  setPixel(p, 23, 16, PAL.bayonet);
  setPixel(p, 24, 16, PAL.bayonet);
  setPixel(p, 25, 16, PAL.bayonetTip);
}

export function paintMusketHorizontal(target, anchorX, anchorY, opts = {}) {
  renderWithAnchor(target, paintHorizontalCanonical, HORIZ_BUTT_X, HORIZ_BUTT_Y, anchorX, anchorY, opts);
}

// ---- canonical: 45-deg diagonal musket pointing UP-RIGHT (NE) ----
//
// 2-thick stair-stepped diagonal barrel, butt at lower-left, bayonet at
// upper-right on a parallel offset diagonal. Geometry copied from the new
// NE firing musket.
// Internal butt-heel anchor: (10, 19).
const DIAG_BUTT_X = 10;
const DIAG_BUTT_Y = 19;
function paintDiagonalCanonical(p) {
  // Butt heel.
  setPixel(p, 10, 19, PAL.musketStockHi);
  // Butt.
  setPixel(p, 11, 18, PAL.musketStockHi);
  setPixel(p, 12, 18, PAL.musketStock);
  // Lock.
  setPixel(p, 12, 17, PAL.musketStock);
  setPixel(p, 13, 17, PAL.brass);
  // Stair-stepped 2-thick barrel rising up-right.
  setPixel(p, 13, 16, PAL.musketBarrel); setPixel(p, 14, 16, PAL.musketBarrel);
  setPixel(p, 14, 15, PAL.musketBarrel); setPixel(p, 15, 15, PAL.musketBarrel);
  setPixel(p, 15, 14, PAL.musketBarrel); setPixel(p, 16, 14, PAL.brass);          // brass band
  setPixel(p, 16, 13, PAL.musketBarrel); setPixel(p, 17, 13, PAL.musketBarrel);
  setPixel(p, 17, 12, PAL.musketBarrel); setPixel(p, 18, 12, PAL.musketBarrel);
  // Muzzle.
  setPixel(p, 18, 11, PAL.musketMuzzle); setPixel(p, 19, 11, PAL.musketMuzzle);
  // Bayonet on parallel offset diagonal beyond muzzle.
  setPixel(p, 18, 10, PAL.bayonet);
  setPixel(p, 19, 9, PAL.bayonet);
  setPixel(p, 20, 8, PAL.bayonet);
  setPixel(p, 21, 7, PAL.bayonetTip);
}

export function paintMusketDiagonal(target, anchorX, anchorY, opts = {}) {
  renderWithAnchor(target, paintDiagonalCanonical, DIAG_BUTT_X, DIAG_BUTT_Y, anchorX, anchorY, opts);
}

// ---- canonical: nearly-vertical musket with slight rightward lean (HIT pose) ----
//
// 2-thick barrel that "stair-steps" once or twice toward the upper-right --
// reads as a vertical gun jolted skyward by a hit. Geometry copied from the
// new S hit musket.
// Internal butt-heel anchor: (14, 23).
const HIT_BUTT_X = 14;
const HIT_BUTT_Y = 23;
function paintHitTiltedCanonical(p) {
  // Butt heel + butt.
  setPixel(p, 14, 23, PAL.musketStockHi);
  setPixel(p, 15, 22, PAL.musketStockHi); setPixel(p, 16, 22, PAL.musketStock);
  // Lock.
  setPixel(p, 15, 21, PAL.musketStock);   setPixel(p, 16, 21, PAL.brass);
  // Barrel (slight stair-steps to the right).
  setPixel(p, 15, 20, PAL.musketBarrel);  setPixel(p, 16, 20, PAL.musketBarrel);
  setPixel(p, 15, 19, PAL.musketBarrel);  setPixel(p, 16, 19, PAL.musketBarrel);
  setPixel(p, 16, 18, PAL.musketBarrel);  setPixel(p, 17, 18, PAL.musketBarrel);   // shift +1
  setPixel(p, 16, 17, PAL.musketBarrel);  setPixel(p, 17, 17, PAL.musketBarrel);
  setPixel(p, 16, 16, PAL.musketBarrel);  setPixel(p, 17, 16, PAL.brass);          // brass band
  setPixel(p, 16, 15, PAL.musketBarrel);  setPixel(p, 17, 15, PAL.musketBarrel);
  setPixel(p, 17, 14, PAL.musketBarrel);  setPixel(p, 18, 14, PAL.musketBarrel);   // shift +1
  setPixel(p, 17, 13, PAL.musketBarrel);  setPixel(p, 18, 13, PAL.musketBarrel);
  // Muzzle.
  setPixel(p, 17, 12, PAL.musketMuzzle);  setPixel(p, 18, 12, PAL.musketMuzzle);
  // Bayonet on parallel offset diagonal beyond muzzle.
  setPixel(p, 18, 11, PAL.bayonet);
  setPixel(p, 18, 10, PAL.bayonet);
  setPixel(p, 19, 9, PAL.bayonet);
  setPixel(p, 19, 8, PAL.bayonetTip);
}

export function paintMusketHitTilted(target, anchorX, anchorY, opts = {}) {
  renderWithAnchor(target, paintHitTiltedCanonical, HIT_BUTT_X, HIT_BUTT_Y, anchorX, anchorY, opts);
}
