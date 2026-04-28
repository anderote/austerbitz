// scripts/lib/cuirassier-poses.mjs
// Source of truth for cuirassier pose sprites. Imported by:
//   - scripts/draw-cuirassier-poses.mjs (PNG emit)
//   - src/sprite-gen/cuirassier-poses.test.ts (shape/palette validation)
//
// Style reference: src/render/cuirassier-sprite.ts. Anchor: bottom-center of
// the cell aligns with the unit's ground position (so the lowest non-shadow
// row should be the hooves, with `s` shadow pixels at the very bottom).

export const CELL_W = 32;
export const CELL_H = 24;

export const SOURCE_DIRS = ['N', 'NE', 'E', 'SE', 'S'];
export const MIRROR_PAIRS = [
  ['NW', 'NE'],
  ['W',  'E'],
  ['SW', 'SE'],
];
export const ALL_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const PALETTE = {
  '.': [0, 0, 0, 0],
  'k': [22, 18, 28, 255],
  'h': [110, 75, 45, 255],
  'H': [74, 50, 30, 255],
  'f': [228, 188, 156, 255],
  'F': [186, 142, 108, 255],
  'g': [180, 188, 200, 255],
  'm': [60, 40, 26, 255],
  'w': [236, 232, 222, 255],
  's': [60, 56, 52, 110],
  'P': [180, 40, 50, 255],
  'S': [50, 60, 140, 255],
};

export const FRAME_COUNTS = {
  idle: 1,
  walking: 4,
  running: 6,
};

/**
 * Validates a frame: must be CELL_H rows of CELL_W chars, every char in PALETTE.
 * Throws on mismatch with a descriptive message including the offending char.
 */
export function validateFrame(frame, label) {
  if (!Array.isArray(frame)) throw new Error(`${label}: frame is not an array`);
  if (frame.length !== CELL_H) {
    throw new Error(`${label}: expected ${CELL_H} rows, got ${frame.length}`);
  }
  for (let y = 0; y < CELL_H; y++) {
    const row = frame[y];
    if (typeof row !== 'string') throw new Error(`${label}[${y}]: row not a string`);
    if (row.length !== CELL_W) {
      throw new Error(`${label}[${y}]: expected ${CELL_W} cols, got ${row.length} ("${row}")`);
    }
    for (let x = 0; x < CELL_W; x++) {
      const ch = row[x];
      if (!(ch in PALETTE)) {
        throw new Error(`${label}[${y}][${x}]: unknown glyph '${ch}'`);
      }
    }
  }
}

/** Renders a frame to a Uint8Array of length CELL_W * CELL_H * 4 (RGBA). */
export function renderFrame(frame) {
  validateFrame(frame, 'renderFrame');
  const out = new Uint8Array(CELL_W * CELL_H * 4);
  for (let y = 0; y < CELL_H; y++) {
    const row = frame[y];
    for (let x = 0; x < CELL_W; x++) {
      const rgba = PALETTE[row[x]];
      const i = (y * CELL_W + x) * 4;
      out[i + 0] = rgba[0];
      out[i + 1] = rgba[1];
      out[i + 2] = rgba[2];
      out[i + 3] = rgba[3];
    }
  }
  return out;
}

/** Returns a horizontally-mirrored copy of a frame. */
export function mirrorFrame(frame) {
  validateFrame(frame, 'mirrorFrame');
  const out = [];
  for (let y = 0; y < CELL_H; y++) {
    out.push(frame[y].split('').reverse().join(''));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Idle frames (1 per source direction). Hand-authored 32x24 silhouettes.
// Anchor: hooves on rows 21-22, ground shadow `s` on row 23, plume tops near
// rows 1-2. Style matches src/render/cuirassier-sprite.ts but at 2x horizontal
// and ~1.2x vertical scale.
// ---------------------------------------------------------------------------

const IDLE_S = [
  '................................', //  0
  '..............SS................', //  1 plume tip
  '.............SSSS...............', //  2 plume base
  '.............kkkk...............', //  3 helmet top
  '............kkggkk..............', //  4 helmet brim + visor plate
  '.............fFFf...............', //  5 face
  '............SPPPPS..............', //  6 collar / cuirass top
  '...........SPPPPPPS.............', //  7 cuirass
  '..........SPPPPPPPPS............', //  8 cuirass
  '..........SPPPSSPPPS............', //  9 breastplate ridge
  '.........mwwwwwwwwwwm...........', // 10 saddle / belt
  '........hhhhhhhhhhhhhh..........', // 11 horse shoulders
  '.......hhhhhhhhhhhhhhhh.........', // 12 horse chest
  '.......hhhhhhhhhhhhhhhh.........', // 13 chest
  '.......hhhhhhhhhhhhhhhh.........', // 14 lower chest
  '.......HHHHHHHHHHHHHHHH.........', // 15 belly
  '........HHHHHHHHHHHHHH..........', // 16 belly taper
  '........h...hh..hh...h..........', // 17 four legs visible head-on
  '........h...hh..hh...h..........', // 18
  '........h...hh..hh...h..........', // 19
  '........h...hh..hh...h..........', // 20
  '........k...kk..kk...k..........', // 21 hooves
  '........k...kk..kk...k..........', // 22 hooves
  '.......sssssssssssssssss........', // 23 ground shadow
];

const IDLE_N = [
  '................................', //  0
  '..............SS................', //  1 plume tip
  '.............SSSS...............', //  2 plume base
  '.............kkkk...............', //  3 helmet top
  '............kkggkk..............', //  4 helmet brim
  '.............kkkk...............', //  5 back of head
  '............SPPPPS..............', //  6 collar
  '...........SPPPPPPS.............', //  7 cuirass back
  '..........SPPPPPPPPS............', //  8 cuirass back
  '..........SPPPSSPPPS............', //  9 spine ridge
  '.........mwwwwwwwwwwm...........', // 10 saddle / belt
  '........hhhhhhhhhhhhhh..........', // 11 horse haunches (rear view)
  '.......hhhhhhhhhhhhhhhh.........', // 12 rump
  '.......hhhhhhhhhhhhhhhh.........', // 13 rump
  '.......hhhhhhhhhhhhhhhh.........', // 14 lower rump
  '.......HHHHHHHHHHHHHHHH.........', // 15 thighs
  '........HHHHHHHHHHHHHH..........', // 16 thighs taper
  '........H...HH..HH...H..........', // 17 four legs visible rear-on
  '........H...HH..HH...H..........', // 18
  '........H...HH..HH...H..........', // 19
  '........H...HH..HH...H..........', // 20
  '........k...kk..kk...k..........', // 21 hooves
  '........k...kk..kk...k..........', // 22 hooves
  '.......sssssssssssssssss........', // 23 ground shadow
];

const IDLE_E = [
  '................................', //  0
  '................................', //  1
  '............................g...', //  2 sabre tip
  '...........................g....', //  3
  '..........SSS.............g.....', //  4 plume tip + sabre
  '.........SSSSS...........g......', //  5 plume base
  '.........kkkkk..........g.......', //  6 helmet top
  '........kkggkk.........g........', //  7 helmet w/ visor
  '........kfFkkk........g.........', //  8 face profile + back of helmet
  '........SPPS.........g..........', //  9 collar + sword arm hilt
  '.......SPPPPSPSP....g...........', // 10 cuirass + extended sword arm
  '......SPPPPPPSP....g............', // 11 cuirass continuing
  '......mwwwwwwwwwm...............', // 12 saddle blanket
  '.....hhhhhhhhhhhhh..............', // 13 horse withers
  '....hhhhhhhhhhhhhhh.............', // 14 back
  '...hhhhhhhhhhhhhhhhhh...........', // 15 body + neck reaching forward
  '..hhhhhhhhhhhhhhhhhhhhh.........', // 16 body extending to head
  '.Hhhhhhhhhhhhhhhhhhhhhfh........', // 17 belly + horse face
  '.HHHHHHHHHHHHHHHHHHHH...........', // 18 belly
  '..h.....hhh.....hhh.............', // 19 4 legs from side (front pair, rear pair)
  '..h.....hhh.....hhh.............', // 20
  '..h.....hhh.....hhh.............', // 21
  '..k.....kkk.....kkk.............', // 22 hooves
  '.sssssssssssssssssssss..........', // 23 ground shadow
];

const IDLE_SE = [
  '................................', //  0
  '..............SS................', //  1 plume tip nudged toward viewer-right
  '.............SSSS...............', //  2 plume base
  '.............kkkk...............', //  3 helmet
  '............kkggkk..............', //  4 helmet brim + visor
  '.............fFFF...............', //  5 face 3/4 (more shadow on the right)
  '............SPPPSPS.............', //  6 collar + sash
  '...........SPPPPPPSP............', //  7 cuirass with sword hilt nub
  '..........SPPPPPPPPS............', //  8 cuirass
  '..........SPPPSSPPPS............', //  9 breastplate ridge
  '.........mwwwwwwwwwwm...........', // 10 saddle
  '........hhhhhhhhhhhhhh..........', // 11 horse shoulders 3/4
  '.......hhhhhhhhhhhhhhhhh........', // 12 chest, head appearing right
  '.......hhhhhhhhhhhhhhhhh........', // 13 chest extends right
  '.......hhhhhhhhhhhhhhhhh........', // 14 lower chest
  '.......HHHHHHHHHHHHHHHHH........', // 15 belly extends right
  '........HHHHHHHHHHHHHHH.........', // 16 belly taper
  '........h...hh..hh...hh.........', // 17 legs offset right
  '........h...hh..hh...hh.........', // 18
  '........h...hh..hh...hh.........', // 19
  '........h...hh..hh...hh.........', // 20
  '........k...kk..kk...kk.........', // 21 hooves
  '........k...kk..kk...kk.........', // 22 hooves
  '.......ssssssssssssssssss.......', // 23 ground shadow
];

const IDLE_NE = [
  '................................', //  0
  '..............SS................', //  1 plume tip
  '.............SSSS........g......', //  2 plume base + sabre tip top-right
  '.............kkkk.........g.....', //  3 helmet
  '............kkggkk.........g....', //  4 helmet brim
  '.............kkkk...........g...', //  5 back of head
  '............SPPPSPS.............', //  6 collar with shoulder strap
  '...........SPPPPPPS.............', //  7 cuirass back
  '..........SPPPPPPPPS............', //  8 cuirass back
  '..........SPPPSSPPPS............', //  9 spine ridge
  '.........mwwwwwwwwwwm...........', // 10 saddle / belt
  '........hhhhhhhhhhhhhh..........', // 11 horse haunches 3/4
  '.......hhhhhhhhhhhhhhhhh........', // 12 haunch rotated right
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15 thighs extending right
  '........HHHHHHHHHHHHHHH.........', // 16
  '........H...HH..HH...HH.........', // 17 four legs, offset right
  '........H...HH..HH...HH.........', // 18
  '........H...HH..HH...HH.........', // 19
  '........H...HH..HH...HH.........', // 20
  '........k...kk..kk...kk.........', // 21 hooves
  '........k...kk..kk...kk.........', // 22 hooves
  '.......ssssssssssssssssss.......', // 23 ground shadow
];

// ---------------------------------------------------------------------------
// Walking frames (4 per source direction). 4-beat horse walk: exactly one
// hoof leaves the ground per frame, cycling through the visible legs.
// Frame 0 = idle/contact pose. Frames 1-3 are deltas (saddle bob + leg lift).
// ---------------------------------------------------------------------------

// --- E facing (side view) --------------------------------------------------
// Legs at rows 19-22: `h` at col 2 (rear-single), `hhh` at cols 8-10
// (rear pair), `hhh` at cols 16-18 (front pair). Frame 0 = IDLE_E.
const WALK_E_0 = IDLE_E;

// Frame 1: lift rear-most leg (col 2). Saddle bobs UP (row 12 m's move to 11).
const WALK_E_1 = [
  '................................', //  0
  '................................', //  1
  '............................g...', //  2
  '...........................g....', //  3
  '..........SSS.............g.....', //  4
  '.........SSSSS...........g......', //  5
  '.........kkkkk..........g.......', //  6
  '........kkggkk.........g........', //  7
  '........kfFkkk........g.........', //  8
  '........SPPS.........g..........', //  9
  '.......SPPPPSPSP....g...........', // 10
  '......mwwwwwwwwwm..g............', // 11 saddle bobbed UP
  '......SPPPPPPSP.................', // 12 cuirass (saddle gone from here)
  '.....hhhhhhhhhhhhh..............', // 13
  '....hhhhhhhhhhhhhhh.............', // 14
  '...hhhhhhhhhhhhhhhhhh...........', // 15
  '..hhhhhhhhhhhhhhhhhhhhh.........', // 16
  '.Hhhhhhhhhhhhhhhhhhhhhfh........', // 17
  '.HHHHHHHHHHHHHHHHHHHH...........', // 18
  '........hhh.....hhh.............', // 19 rear-single leg lifted (col 2 cleared)
  '..h.....hhh.....hhh.............', // 20
  '..h.....hhh.....hhh.............', // 21
  '........kkk.....kkk.............', // 22 rear-single hoof lifted off ground
  '.sssssssssssssssssssss..........', // 23
];

// Frame 2: lift rear pair (cols 8-10). Saddle at idle row.
const WALK_E_2 = [
  '................................', //  0
  '................................', //  1
  '............................g...', //  2
  '...........................g....', //  3
  '..........SSS.............g.....', //  4
  '.........SSSSS...........g......', //  5
  '.........kkkkk..........g.......', //  6
  '........kkggkk.........g........', //  7
  '........kfFkkk........g.........', //  8
  '........SPPS.........g..........', //  9
  '.......SPPPPSPSP....g...........', // 10
  '......SPPPPPPSP.................', // 11
  '......mwwwwwwwwwm...............', // 12 saddle at idle row
  '.....hhhhhhhhhhhhh..............', // 13
  '....hhhhhhhhhhhhhhh.............', // 14
  '...hhhhhhhhhhhhhhhhhh...........', // 15
  '..hhhhhhhhhhhhhhhhhhhhh.........', // 16
  '.Hhhhhhhhhhhhhhhhhhhhhfh........', // 17
  '.HHHHHHHHHHHHHHHHHHHH...........', // 18
  '..h.............hhh.............', // 19 rear pair lifted (cols 8-10 cleared)
  '..h.....hhh.....hhh.............', // 20
  '..h.....hhh.....hhh.............', // 21
  '..k.............kkk.............', // 22 rear-pair hooves lifted
  '.sssssssssssssssssssss..........', // 23
];

// Frame 3: lift front pair (cols 16-18). Saddle bobs UP.
const WALK_E_3 = [
  '................................', //  0
  '................................', //  1
  '............................g...', //  2
  '...........................g....', //  3
  '..........SSS.............g.....', //  4
  '.........SSSSS...........g......', //  5
  '.........kkkkk..........g.......', //  6
  '........kkggkk.........g........', //  7
  '........kfFkkk........g.........', //  8
  '........SPPS.........g..........', //  9
  '.......SPPPPSPSP....g...........', // 10
  '......mwwwwwwwwwm..g............', // 11 saddle bobbed UP
  '......SPPPPPPSP.................', // 12
  '.....hhhhhhhhhhhhh..............', // 13
  '....hhhhhhhhhhhhhhh.............', // 14
  '...hhhhhhhhhhhhhhhhhh...........', // 15
  '..hhhhhhhhhhhhhhhhhhhhh.........', // 16
  '.Hhhhhhhhhhhhhhhhhhhhhfh........', // 17
  '.HHHHHHHHHHHHHHHHHHHH...........', // 18
  '..h.....hhh.....................', // 19 front pair lifted (cols 16-18 cleared)
  '..h.....hhh.....hhh.............', // 20
  '..h.....hhh.....hhh.............', // 21
  '..k.....kkk.....................', // 22 front-pair hooves lifted
  '.sssssssssssssssssssss..........', // 23
];

// --- N facing (back view) --------------------------------------------------
// Legs at rows 17-20 (H glyphs), hooves at 21-22 (k). Bob saddle on 1+3.
const WALK_N_0 = IDLE_N;

// Frame 1: lift left-outer leg (col 8). Saddle bobs UP.
const WALK_N_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '............HH..HH...H..........', // 17 left-outer leg lifted
  '........H...HH..HH...H..........', // 18
  '........H...HH..HH...H..........', // 19
  '........H...HH..HH...H..........', // 20
  '............kk..kk...k..........', // 21 left-outer hoof lifted
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// Frame 2: lift right-inner leg (cols 16-17). Saddle at idle.
const WALK_N_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '........H...HH......H...........', // 17 right-inner pair lifted
  '........H...HH..HH...H..........', // 18
  '........H...HH..HH...H..........', // 19
  '........H...HH..HH...H..........', // 20
  '........k...kk......k...........', // 21 right-inner hooves lifted
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// Frame 3: lift right-outer leg (col 21). Saddle bobs UP.
const WALK_N_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '........H...HH..HH..............', // 17 right-outer leg lifted
  '........H...HH..HH...H..........', // 18
  '........H...HH..HH...H..........', // 19
  '........H...HH..HH...H..........', // 20
  '........k...kk..kk..............', // 21 right-outer hoof lifted
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// --- S facing (front view) -------------------------------------------------
// Four leg strips at rows 17-20 cols 8, 12-13, 16-17, 21. Hooves rows 21-22.
const WALK_S_0 = IDLE_S;

// Frame 1: lift left-outer leg-strip (col 8). Saddle bobs UP.
const WALK_S_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '............hh..hh...h..........', // 17 left-outer strip lifted
  '........h...hh..hh...h..........', // 18
  '........h...hh..hh...h..........', // 19
  '........h...hh..hh...h..........', // 20
  '............kk..kk...k..........', // 21 left-outer hoof lifted
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// Frame 2: lift right-inner strip (cols 16-17). Saddle at idle.
const WALK_S_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '........h...hh......h...........', // 17 right-inner strip lifted
  '........h...hh..hh...h..........', // 18
  '........h...hh..hh...h..........', // 19
  '........h...hh..hh...h..........', // 20
  '........k...kk......k...........', // 21 right-inner hoof lifted
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// Frame 3: lift right-outer strip (col 21). Saddle bobs UP.
const WALK_S_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '........h...hh..hh..............', // 17 right-outer strip lifted
  '........h...hh..hh...h..........', // 18
  '........h...hh..hh...h..........', // 19
  '........h...hh..hh...h..........', // 20
  '........k...kk..kk..............', // 21 right-outer hoof lifted
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// --- SE facing (3/4 front-right) -------------------------------------------
// Legs at rows 17-22, 5 strips at cols 8, 12-13, 16-17, 21-22. Bob 1+3.
const WALK_SE_0 = IDLE_SE;

const WALK_SE_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '............hh..hh...hh.........', // 17 left-outer strip lifted
  '........h...hh..hh...hh.........', // 18
  '........h...hh..hh...hh.........', // 19
  '........h...hh..hh...hh.........', // 20
  '............kk..kk...kk.........', // 21 left-outer hoof lifted
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

const WALK_SE_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '........h...hh......hh..........', // 17 right-inner strip lifted
  '........h...hh..hh...hh.........', // 18
  '........h...hh..hh...hh.........', // 19
  '........h...hh..hh...hh.........', // 20
  '........k...kk......kk..........', // 21 right-inner hoof lifted
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

const WALK_SE_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '........h...hh..hh..............', // 17 right-outer strip lifted
  '........h...hh..hh...hh.........', // 18
  '........h...hh..hh...hh.........', // 19
  '........h...hh..hh...hh.........', // 20
  '........k...kk..kk..............', // 21 right-outer hoof lifted
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

// --- NE facing (3/4 back-right) --------------------------------------------
// Legs at rows 17-22 with extra column right (cols 8, 12-13, 16-17, 21-22).
const WALK_NE_0 = IDLE_NE;

const WALK_NE_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '............HH..HH...HH.........', // 17 left-outer strip lifted
  '........H...HH..HH...HH.........', // 18
  '........H...HH..HH...HH.........', // 19
  '........H...HH..HH...HH.........', // 20
  '............kk..kk...kk.........', // 21 left-outer hoof lifted
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

const WALK_NE_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '........H...HH......HH..........', // 17 right-inner strip lifted
  '........H...HH..HH...HH.........', // 18
  '........H...HH..HH...HH.........', // 19
  '........H...HH..HH...HH.........', // 20
  '........k...kk......kk..........', // 21 right-inner hoof lifted
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

const WALK_NE_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle bobbed UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '........H...HH..HH..............', // 17 right-outer strip lifted
  '........H...HH..HH...HH.........', // 18
  '........H...HH..HH...HH.........', // 19
  '........H...HH..HH...HH.........', // 20
  '........k...kk..kk..............', // 21 right-outer hoof lifted
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

// ---------------------------------------------------------------------------
// Running frames (6 per source direction). 4-beat asymmetric gallop with a
// suspension phase. Frame 0 = gathered/contact (body LOW, legs bunched).
// Frame 1 = push-off. Frame 2 = extended-suspension (body HIGH + STRETCHED,
// all 4 hooves off ground). Frame 3 = front-landing (front planted, rears
// extended back). Frame 4 = rolling-contact (hinds catching up). Frame 5 =
// re-gather (similar to 0 with slight forward lean).
// ---------------------------------------------------------------------------

// --- E facing (side view, charging) ---------------------------------------
// Sabre extended forward (more horizontal than idle). Body lifts on
// frames 2-3, lowers on frame 0. Legs at cols 2 (rear-single), 8-10
// (rear pair), 16-18 (front pair) become extended/bunched per frame.

// Frame 0: gathered/contact. Body LOW (saddle at row 13). Legs bunched
// under body (rear-single at col 4, rear pair cols 9-11, front pair
// cols 13-15). Sabre raised mid.
const RUN_E_0 = [
  '................................', //  0
  '................................', //  1
  '..............................g.', //  2 sabre tip far right
  '.............................g..', //  3
  '..........SSS...............g...', //  4 plume tip
  '.........SSSSS.............g....', //  5
  '.........kkkkk............g.....', //  6
  '........kkggkk...........g......', //  7
  '........kfFkkk..........g.......', //  8
  '........SPPS...........g........', //  9
  '.......SPPPPSPSP......g.........', // 10
  '......SPPPPPPSP......g..........', // 11
  '................................', // 12
  '......mwwwwwwwwwm...............', // 13 saddle DOWN (compressed)
  '.....hhhhhhhhhhhhh..............', // 14
  '....hhhhhhhhhhhhhhh.............', // 15
  '...hhhhhhhhhhhhhhhhhh...........', // 16
  '..hhhhhhhhhhhhhhhhhhhhh.........', // 17
  '.Hhhhhhhhhhhhhhhhhhhhhfh........', // 18 belly + horse face
  '.HHHHHHHHHHHHHHHHHHHH...........', // 19 belly
  '....h...hhh...hhh...............', // 20 legs bunched (cols 4, 8-10, 14-16)
  '....h...hhh...hhh...............', // 21
  '....k...kkk...kkk...............', // 22 hooves bunched
  '.....sssssssssssss..............', // 23 short shadow under bunched legs
];

// Frame 1: push-off. Rear hooves still planted, fronts lifting forward.
// Saddle starting to rise (row 12).
const RUN_E_1 = [
  '................................', //  0
  '................................', //  1
  '............................g...', //  2
  '...........................g....', //  3
  '..........SSS.............g.....', //  4
  '.........SSSSS...........g......', //  5
  '.........kkkkk..........g.......', //  6
  '........kkggkk.........g........', //  7
  '........kfFkkk........g.........', //  8
  '........SPPS.........g..........', //  9
  '.......SPPPPSPSP....g...........', // 10
  '......SPPPPPPSP.................', // 11
  '......mwwwwwwwwwm...............', // 12 saddle starting to rise
  '.....hhhhhhhhhhhhh..............', // 13
  '....hhhhhhhhhhhhhhh.............', // 14
  '...hhhhhhhhhhhhhhhhhh...........', // 15
  '..hhhhhhhhhhhhhhhhhhhhh.........', // 16
  '.Hhhhhhhhhhhhhhhhhhhhhfh........', // 17
  '.HHHHHHHHHHHHHHHHHHHH...........', // 18
  '..h.....hhh.........hhh.........', // 19 fronts pushed forward (cols 20-22)
  '..h.....hhh.....................', // 20 fronts off ground
  '..h.....hhh.....................', // 21 rears planted, fronts up
  '..k.....kkk.....................', // 22 only rear hooves on ground
  '.sssssssssssssss................', // 23
];

// Frame 2: extended-suspension. ALL FOUR hooves off ground. Body lifted
// (saddle row 10, body 1 col forward). Front legs reach FAR forward, rear
// legs reach FAR back. Sabre fully extended forward (charge).
const RUN_E_2 = [
  '................................', //  0
  '................................', //  1
  '................................', //  2
  '................................', //  3
  '...........SSS..................', //  4 plume shifted right (1 col)
  '..........SSSSS.................', //  5
  '..........kkkkk.................', //  6
  '.........kkggkk.................', //  7
  '.........kfFkkk.................', //  8
  '.........SPPS.SSSSSS............', //  9 sword arm extended further east
  '........SPPPPSPSPSSPSgggggggg...', // 10 saddle UP, sabre charged forward
  '........mwwwwwwwwwm.............', // 11 saddle UP
  '.......SPPPPPPSP................', // 12
  '......hhhhhhhhhhhhh.............', // 13
  '.....hhhhhhhhhhhhhhhh...........', // 14
  '....hhhhhhhhhhhhhhhhhhh.........', // 15 stretched east
  '...hhhhhhhhhhhhhhhhhhhhhh.......', // 16
  '..Hhhhhhhhhhhhhhhhhhhhhhhfh.....', // 17 stretched body + head far right
  '..HHHHHHHHHHHHHHHHHHHHHH........', // 18
  'hh.................hhh..........', // 19 rears far back, fronts far fwd
  'hh.................hhh..........', // 20 all 4 legs off ground
  '................................', // 21 nothing on ground
  '................................', // 22 NO hooves on row 22 (suspension)
  '...sssssssss....................', // 23 short faint shadow
];

// Frame 3: front-landing. Fronts touch ground (extended forward), rears
// still extended back. Body still stretched, saddle at row 11.
const RUN_E_3 = [
  '................................', //  0
  '................................', //  1
  '................................', //  2
  '............................g...', //  3 sabre tip
  '...........SSS.............g....', //  4
  '..........SSSSS...........g.....', //  5
  '..........kkkkk..........g......', //  6
  '.........kkggkk.........g.......', //  7
  '.........kfFkkk........g........', //  8
  '.........SPPS........gggg.......', //  9
  '........SPPPPSPSP...............', // 10
  '........mwwwwwwwwwm.............', // 11 saddle still UP
  '.......SPPPPPPSP................', // 12
  '......hhhhhhhhhhhhh.............', // 13
  '.....hhhhhhhhhhhhhhhh...........', // 14
  '....hhhhhhhhhhhhhhhhhhh.........', // 15
  '...hhhhhhhhhhhhhhhhhhhhhh.......', // 16
  '..Hhhhhhhhhhhhhhhhhhhhhhhfh.....', // 17
  '..HHHHHHHHHHHHHHHHHHHHHH........', // 18
  'hh.................hhh..........', // 19 rears still back
  'hh.................hhh..........', // 20
  '...................hhh..........', // 21 fronts coming down
  '...................kkk..........', // 22 only fronts touching ground
  '...........sssssssssssss........', // 23 shadow under fronts
];

// Frame 4: rolling-contact. Fronts planted, rears swinging forward to
// catch up. Saddle returning toward idle (row 12). Body re-compressing.
const RUN_E_4 = [
  '................................', //  0
  '................................', //  1
  '............................g...', //  2
  '...........................g....', //  3
  '..........SSS.............g.....', //  4
  '.........SSSSS...........g......', //  5
  '.........kkkkk..........g.......', //  6
  '........kkggkk.........g........', //  7
  '........kfFkkk........g.........', //  8
  '........SPPS.........g..........', //  9
  '.......SPPPPSPSP....g...........', // 10
  '......SPPPPPPSP.................', // 11
  '......mwwwwwwwwwm...............', // 12 saddle back near idle
  '.....hhhhhhhhhhhhh..............', // 13
  '....hhhhhhhhhhhhhhh.............', // 14
  '...hhhhhhhhhhhhhhhhhh...........', // 15
  '..hhhhhhhhhhhhhhhhhhhhh.........', // 16
  '.Hhhhhhhhhhhhhhhhhhhhhfh........', // 17
  '.HHHHHHHHHHHHHHHHHHHH...........', // 18
  '......hhh.........hhh...........', // 19 hinds swinging forward (cols 6-8)
  '......hhh.........hhh...........', // 20
  '..................hhh...........', // 21 fronts still planted
  '..................kkk...........', // 22 only fronts on ground
  '..........sssssssssss...........', // 23
];

// Frame 5: re-gather. Hinds landing close to fronts. Similar to frame 0
// but slight forward lean (legs cluster shifted ~1 col right).
const RUN_E_5 = [
  '................................', //  0
  '................................', //  1
  '..............................g.', //  2
  '.............................g..', //  3
  '...........SSS..............g...', //  4 plume +1 col fwd
  '..........SSSSS............g....', //  5
  '..........kkkkk...........g.....', //  6
  '.........kkggkk..........g......', //  7
  '.........kfFkkk.........g.......', //  8
  '.........SPPS..........g........', //  9
  '........SPPPPSPSP.....g.........', // 10
  '.......SPPPPPPSP.....g..........', // 11
  '................................', // 12
  '.......mwwwwwwwwwm..............', // 13 saddle DOWN, +1 col fwd
  '......hhhhhhhhhhhhh.............', // 14
  '.....hhhhhhhhhhhhhhh............', // 15
  '....hhhhhhhhhhhhhhhhhh..........', // 16
  '...hhhhhhhhhhhhhhhhhhhhh........', // 17
  '..Hhhhhhhhhhhhhhhhhhhhhfh.......', // 18 +1 col fwd
  '..HHHHHHHHHHHHHHHHHHHH..........', // 19
  '.....h...hhh...hhh..............', // 20 leg cluster +1 col fwd vs frame 0
  '.....h...hhh...hhh..............', // 21
  '.....k...kkk...kkk..............', // 22
  '......sssssssssssss.............', // 23
];

// --- N facing (back view, gallop) -----------------------------------------
// Animate aggressively: body lift via saddle row, hooves visibility on
// suspension. Idle has 4 leg strips at cols 8, 12-13, 16-17, 21.

// Frame 0: gathered/contact. Saddle DOWN (row 11). Hooves bunched (legs
// pulled inward toward body center at cols 11-12, 15-16, with outer legs
// pulled in to cols 9 and 19).
const RUN_N_0 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN by 1 row
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......hhhhhhhhhhhhhhhh.........', // 15
  '.......HHHHHHHHHHHHHHHH.........', // 16
  '........HHHHHHHHHHHHHH..........', // 17
  '.........H..HH..HH..H...........', // 18 legs clustered narrower
  '.........H..HH..HH..H...........', // 19
  '.........H..HH..HH..H...........', // 20
  '.........H..HH..HH..H...........', // 21
  '.........k..kk..kk..k...........', // 22 hooves bunched closer
  '........sssssssssssss...........', // 23
];

// Frame 1: push-off. Rear hooves planted, outer legs starting to lift
// (left-outer leg going up). Saddle row 10 (idle).
const RUN_N_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '............HH..HH..............', // 17 outers lifted (cols 8 and 21 cleared)
  '............HH..HH..............', // 18
  '........H...HH..HH...H..........', // 19 outers re-appear lower (still up)
  '........H...HH..HH...H..........', // 20
  '............kk..kk..............', // 21
  '........k...kk..kk...k..........', // 22 only inner pairs + outers planted
  '.......sssssssssssssssss........', // 23
];

// Frame 2: extended-suspension. ALL hooves OFF row 22. Saddle row 8
// (UP by 2 rows). Body slightly stretched.
const RUN_N_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '.........mwwwwwwwwwwm...........', //  8 saddle UP by 2 rows
  '..........SPPPSSPPPS............', //  9
  '.........hhhhhhhhhhhh...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '......HHHHHHHHHHHHHHHHHH........', // 16 stretched wider
  '......H.....HH..HH.....H........', // 17 legs reaching out (suspension)
  '......H.....HH..HH.....H........', // 18
  '......H.................H.......', // 19 legs spread wide
  '................................', // 20 nothing here
  '................................', // 21 hooves off ground
  '................................', // 22 NO hooves (suspended)
  '........sssssss.................', // 23 short shadow
];

// Frame 3: front-landing. Inner legs (representing fronts) touch down,
// outer legs (rears) still stretched. Saddle row 9.
const RUN_N_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle UP by 1 row
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '............HH..HH..............', // 17 inner legs only visible
  '............HH..HH..............', // 18
  '............HH..HH..............', // 19
  '............HH..HH..............', // 20
  '............HH..HH..............', // 21
  '............kk..kk..............', // 22 only inner pairs touching
  '...........ssssssss.............', // 23 shadow under inners
];

// Frame 4: rolling-contact. Inners planted, outers swinging forward
// from their stretched-back position. Saddle row 10.
const RUN_N_4 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '..........H.HH..HH.H............', // 17 outers swinging in (cols 10, 19)
  '..........H.HH..HH.H............', // 18
  '..........H.HH..HH.H............', // 19
  '............HH..HH..............', // 20
  '............HH..HH..............', // 21
  '..........k.kk..kk.k............', // 22 outers landing close + inners planted
  '.........ssssssssssss...........', // 23
];

// Frame 5: re-gather. Similar to 0 but legs slightly more separated
// (slight forward lean = re-extension starting).
const RUN_N_5 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............kkkk...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN by 1 row
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......hhhhhhhhhhhhhhhh.........', // 15
  '.......HHHHHHHHHHHHHHHH.........', // 16
  '........HHHHHHHHHHHHHH..........', // 17
  '........H...HH..HH...H..........', // 18 legs at idle spacing (slightly wider)
  '........H...HH..HH...H..........', // 19
  '........H...HH..HH...H..........', // 20
  '........H...HH..HH...H..........', // 21
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// --- S facing (front view, gallop) ----------------------------------------
// Body comes toward viewer in suspension (lift saddle UP). Idle has 4
// leg strips at cols 8, 12-13, 16-17, 21.

// Frame 0: gathered. Saddle DOWN (row 11). Legs bunched closer.
const RUN_S_0 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......hhhhhhhhhhhhhhhh.........', // 15
  '.......HHHHHHHHHHHHHHHH.........', // 16
  '........HHHHHHHHHHHHHH..........', // 17
  '.........h..hh..hh..h...........', // 18 legs clustered
  '.........h..hh..hh..h...........', // 19
  '.........h..hh..hh..h...........', // 20
  '.........h..hh..hh..h...........', // 21
  '.........k..kk..kk..k...........', // 22 hooves bunched
  '........sssssssssssss...........', // 23
];

// Frame 1: push-off. Outer strips lift, inners planted. Saddle row 9.
const RUN_S_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '............hh..hh..............', // 17 outers lifted
  '............hh..hh..............', // 18
  '........h...hh..hh...h..........', // 19 outers reappear lower
  '........h...hh..hh...h..........', // 20
  '............hh..hh..............', // 21
  '........k...kk..kk...k..........', // 22 outers planted, inners up
  '.......sssssssssssssssss........', // 23
];

// Frame 2: extended-suspension. Body comes toward viewer (saddle UP by
// 2 rows, body slightly wider). All 4 hooves OFF row 22.
const RUN_S_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '.........mwwwwwwwwwwm...........', //  8 saddle UP by 2 rows
  '..........SPPPSSPPPS............', //  9
  '.........hhhhhhhhhhhh...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '......HHHHHHHHHHHHHHHHHH........', // 15 wider belly (closer to viewer)
  '......HHHHHHHHHHHHHHHHHH........', // 16
  '......h.....hh..hh.....h........', // 17 legs reaching out (suspension)
  '......h.....hh..hh.....h........', // 18
  '......h................h........', // 19 legs spread wide
  '................................', // 20
  '................................', // 21
  '................................', // 22 NO hooves (suspended)
  '........sssssss.................', // 23 short shadow
];

// Frame 3: front-landing. Inner strips (representing fronts) touch down.
// Saddle row 9.
const RUN_S_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle UP by 1 row
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '............hh..hh..............', // 17 only inner pairs visible
  '............hh..hh..............', // 18
  '............hh..hh..............', // 19
  '............hh..hh..............', // 20
  '............hh..hh..............', // 21
  '............kk..kk..............', // 22 only inner hooves planted
  '...........ssssssss.............', // 23 shadow under inners
];

// Frame 4: rolling-contact. Outers swinging in to land. Saddle row 10.
const RUN_S_4 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhh.........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......HHHHHHHHHHHHHHHH.........', // 15
  '........HHHHHHHHHHHHHH..........', // 16
  '..........h.hh..hh.h............', // 17 outers swinging inward
  '..........h.hh..hh.h............', // 18
  '..........h.hh..hh.h............', // 19
  '............hh..hh..............', // 20
  '............hh..hh..............', // 21
  '..........k.kk..kk.k............', // 22 outers landing close + inners planted
  '.........ssssssssssss...........', // 23
];

// Frame 5: re-gather. Like frame 0 but slightly more spread = forward lean.
const RUN_S_5 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFf...............', //  5
  '............SPPPPS..............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhh.........', // 13
  '.......hhhhhhhhhhhhhhhh.........', // 14
  '.......hhhhhhhhhhhhhhhh.........', // 15
  '.......HHHHHHHHHHHHHHHH.........', // 16
  '........HHHHHHHHHHHHHH..........', // 17
  '........h...hh..hh...h..........', // 18 idle-spacing (slight spread)
  '........h...hh..hh...h..........', // 19
  '........h...hh..hh...h..........', // 20
  '........h...hh..hh...h..........', // 21
  '........k...kk..kk...k..........', // 22
  '.......sssssssssssssssss........', // 23
];

// --- SE facing (3/4 front-right, gallop) ----------------------------------
// Idle SE has body skew right by 1 col on legs (5 strips total). Sabre
// extends forward-right in charge.

// Frame 0: gathered. Saddle DOWN. Legs bunched.
const RUN_SE_0 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......hhhhhhhhhhhhhhhhh........', // 15
  '.......HHHHHHHHHHHHHHHHH........', // 16
  '........HHHHHHHHHHHHHHH.........', // 17
  '.........h..hh..hh..hh..........', // 18 legs clustered (skewed right)
  '.........h..hh..hh..hh..........', // 19
  '.........h..hh..hh..hh..........', // 20
  '.........h..hh..hh..hh..........', // 21
  '.........k..kk..kk..kk..........', // 22 hooves bunched
  '........ssssssssssssss..........', // 23
];

// Frame 1: push-off. Saddle row 9. Outer strips lift.
const RUN_SE_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle starting up
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '............hh..hh...hh.........', // 17 left-outer lifted
  '............hh..hh...hh.........', // 18
  '........h...hh..hh...hh.........', // 19
  '........h...hh..hh...hh.........', // 20
  '............hh..hh...hh.........', // 21
  '........k...kk..kk...kk.........', // 22 left-outer hoof up
  '.......ssssssssssssssssss.......', // 23
];

// Frame 2: extended-suspension. ALL hooves off. Saddle UP by 2 rows.
// Sabre extended forward-right (charge). Body forward 1 col.
const RUN_SE_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5 face
  '............SPPPSPS.gggg........', //  6 sabre forward
  '...........SPPPPPPSP....g.......', //  7
  '.........mwwwwwwwwwwm...........', //  8 saddle UP by 2 rows
  '..........SPPPSSPPPS............', //  9
  '.........hhhhhhhhhhhh...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '......hhhhhhhhhhhhhhhhhhh.......', // 14 stretched
  '......HHHHHHHHHHHHHHHHHHH.......', // 15
  '......HHHHHHHHHHHHHHHHHHH.......', // 16
  '......h.....hh..hh.....hh.......', // 17 legs reaching wide (suspension)
  '......h.....hh..hh.....hh.......', // 18
  '......h................hh.......', // 19 legs spread wide
  '................................', // 20
  '................................', // 21
  '................................', // 22 NO hooves (suspended)
  '........sssssss.................', // 23 short shadow
];

// Frame 3: front-landing. Sabre tip continues. Saddle row 9.
const RUN_SE_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP.gggg.......', //  7 sabre still extended
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle UP by 1 row
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '............hh..hh..............', // 17 inner pairs only
  '............hh..hh..............', // 18
  '............hh..hh..............', // 19
  '............hh..hh..............', // 20
  '............hh..hh..............', // 21
  '............kk..kk..............', // 22 only inners planted
  '...........ssssssss.............', // 23
];

// Frame 4: rolling-contact. Outers swinging in. Saddle row 10.
const RUN_SE_4 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '..........h.hh..hh.hh...........', // 17 outers swinging in
  '..........h.hh..hh.hh...........', // 18
  '..........h.hh..hh.hh...........', // 19
  '............hh..hh..............', // 20
  '............hh..hh..............', // 21
  '..........k.kk..kk.kk...........', // 22
  '.........sssssssssssss..........', // 23
];

// Frame 5: re-gather. Slight forward lean.
const RUN_SE_5 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS...............', //  2
  '.............kkkk...............', //  3
  '............kkggkk..............', //  4
  '.............fFFF...............', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPSP............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......hhhhhhhhhhhhhhhhh........', // 15
  '.......HHHHHHHHHHHHHHHHH........', // 16
  '........HHHHHHHHHHHHHHH.........', // 17
  '........h...hh..hh...hh.........', // 18 idle-spacing
  '........h...hh..hh...hh.........', // 19
  '........h...hh..hh...hh.........', // 20
  '........h...hh..hh...hh.........', // 21
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

// --- NE facing (3/4 back-right, gallop) -----------------------------------
// Sabre extends back-right in idle. Same gallop pattern as N+SE merged.

// Frame 0: gathered. Saddle DOWN.
const RUN_NE_0 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......hhhhhhhhhhhhhhhhh........', // 15
  '.......HHHHHHHHHHHHHHHHH........', // 16
  '........HHHHHHHHHHHHHHH.........', // 17
  '.........H..HH..HH..HH..........', // 18 legs clustered
  '.........H..HH..HH..HH..........', // 19
  '.........H..HH..HH..HH..........', // 20
  '.........H..HH..HH..HH..........', // 21
  '.........k..kk..kk..kk..........', // 22 hooves bunched
  '........ssssssssssssss..........', // 23
];

// Frame 1: push-off. Saddle row 9. Left-outer strip lifted.
const RUN_NE_1 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle starting UP
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '............HH..HH...HH.........', // 17 left-outer lifted
  '............HH..HH...HH.........', // 18
  '........H...HH..HH...HH.........', // 19
  '........H...HH..HH...HH.........', // 20
  '............HH..HH...HH.........', // 21
  '........k...kk..kk...kk.........', // 22 left-outer hoof up
  '.......ssssssssssssssssss.......', // 23
];

// Frame 2: extended-suspension. ALL hooves off. Saddle UP by 2 rows.
const RUN_NE_2 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '.........mwwwwwwwwwwm...........', //  8 saddle UP by 2 rows
  '..........SPPPSSPPPS............', //  9
  '.........hhhhhhhhhhhh...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '......hhhhhhhhhhhhhhhhhhh.......', // 14 stretched
  '......HHHHHHHHHHHHHHHHHHH.......', // 15
  '......HHHHHHHHHHHHHHHHHHH.......', // 16
  '......H.....HH..HH.....HH.......', // 17 legs reaching wide
  '......H.....HH..HH.....HH.......', // 18
  '......H................HH.......', // 19 legs spread wide
  '................................', // 20
  '................................', // 21
  '................................', // 22 NO hooves (suspended)
  '........sssssss.................', // 23 short shadow
];

// Frame 3: front-landing. Saddle row 9. Inner pairs only.
const RUN_NE_3 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '.........mwwwwwwwwwwm...........', //  9 saddle UP by 1 row
  '..........SPPPSSPPPS............', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '............HH..HH..............', // 17 inner pairs only
  '............HH..HH..............', // 18
  '............HH..HH..............', // 19
  '............HH..HH..............', // 20
  '............HH..HH..............', // 21
  '............kk..kk..............', // 22 only inners planted
  '...........ssssssss.............', // 23
];

// Frame 4: rolling-contact. Outers swinging in. Saddle row 10.
const RUN_NE_4 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '.........mwwwwwwwwwwm...........', // 10
  '........hhhhhhhhhhhhhh..........', // 11
  '.......hhhhhhhhhhhhhhhhh........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......HHHHHHHHHHHHHHHHH........', // 15
  '........HHHHHHHHHHHHHHH.........', // 16
  '..........H.HH..HH.HH...........', // 17 outers swinging in
  '..........H.HH..HH.HH...........', // 18
  '..........H.HH..HH.HH...........', // 19
  '............HH..HH..............', // 20
  '............HH..HH..............', // 21
  '..........k.kk..kk.kk...........', // 22
  '.........sssssssssssss..........', // 23
];

// Frame 5: re-gather. Slight forward lean.
const RUN_NE_5 = [
  '................................', //  0
  '..............SS................', //  1
  '.............SSSS........g......', //  2
  '.............kkkk.........g.....', //  3
  '............kkggkk.........g....', //  4
  '.............kkkk...........g...', //  5
  '............SPPPSPS.............', //  6
  '...........SPPPPPPS.............', //  7
  '..........SPPPPPPPPS............', //  8
  '..........SPPPSSPPPS............', //  9
  '..........mwwwwwwww.............', // 10
  '.........mwwwwwwwwwwm...........', // 11 saddle DOWN
  '........hhhhhhhhhhhhhh..........', // 12
  '.......hhhhhhhhhhhhhhhhh........', // 13
  '.......hhhhhhhhhhhhhhhhh........', // 14
  '.......hhhhhhhhhhhhhhhhh........', // 15
  '.......HHHHHHHHHHHHHHHHH........', // 16
  '........HHHHHHHHHHHHHHH.........', // 17
  '........H...HH..HH...HH.........', // 18 idle-spacing
  '........H...HH..HH...HH.........', // 19
  '........H...HH..HH...HH.........', // 20
  '........H...HH..HH...HH.........', // 21
  '........k...kk..kk...kk.........', // 22
  '.......ssssssssssssssssss.......', // 23
];

export const POSES = {
  idle: {
    N: [IDLE_N],
    NE: [IDLE_NE],
    E: [IDLE_E],
    SE: [IDLE_SE],
    S: [IDLE_S],
  },
  walking: {
    N:  [WALK_N_0,  WALK_N_1,  WALK_N_2,  WALK_N_3 ],
    NE: [WALK_NE_0, WALK_NE_1, WALK_NE_2, WALK_NE_3],
    E:  [WALK_E_0,  WALK_E_1,  WALK_E_2,  WALK_E_3 ],
    SE: [WALK_SE_0, WALK_SE_1, WALK_SE_2, WALK_SE_3],
    S:  [WALK_S_0,  WALK_S_1,  WALK_S_2,  WALK_S_3 ],
  },
  running: {
    N:  [RUN_N_0,  RUN_N_1,  RUN_N_2,  RUN_N_3,  RUN_N_4,  RUN_N_5 ],
    NE: [RUN_NE_0, RUN_NE_1, RUN_NE_2, RUN_NE_3, RUN_NE_4, RUN_NE_5],
    E:  [RUN_E_0,  RUN_E_1,  RUN_E_2,  RUN_E_3,  RUN_E_4,  RUN_E_5 ],
    SE: [RUN_SE_0, RUN_SE_1, RUN_SE_2, RUN_SE_3, RUN_SE_4, RUN_SE_5],
    S:  [RUN_S_0,  RUN_S_1,  RUN_S_2,  RUN_S_3,  RUN_S_4,  RUN_S_5 ],
  },
};
