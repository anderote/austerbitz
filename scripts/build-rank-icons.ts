// Build the rank-icon atlas. Run with: npx tsx scripts/build-rank-icons.ts
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const W = 64, H = 16;
const png = new PNG({ width: W, height: H });

// Color palette (RGBA).
const T  = [0,   0,   0,   0   ] as const;   // transparent
const G  = [246, 211, 90,  255] as const;    // gold
const D  = [58,  42,  24,  255] as const;    // dark outline
const Hi = [255, 245, 200, 255] as const;    // gold highlight

// Each pixel map is row-major top→bottom, left→right;
// '.' = T, 'g' = G, 'd' = D, 'h' = Hi.
// Cells are 16×16; only the bottom rows are drawn so empty top rows = transparent padding.

const veteran = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..d..........d..',
  '..dgggggggggd...',
  '...dgggggggd....',
  '....dddddd......',
];

const sergeant = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..d..........d..',
  '..dgggggggggd...',
  '....dddddd......',
  '..d..........d..',
  '..dgggggggggd...',
  '...dgggggggd....',
  '....dddddd......',
];

const sgtMajor = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..d..........d..',
  '..dgggggggggd...',
  '....dddddd......',
  '..d..........d..',
  '..dgggggggggd...',
  '....dddddd......',
  '..d..........d..',
  '..dgggggggggd...',
  '...dgggggggd....',
  '....dddddd......',
  '................',
];

const captain = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '......d.d.......',
  '......dgd.......',
  '....ddgggdd.....',
  '..ddggghggddd...',
  '....dgggggd.....',
  '...dggdgddgd....',
  '...ddd...ddd....',
  '...d.......d....',
  '................',
  '................',
];

const cells = [veteran, sergeant, sgtMajor, captain];

function set(x: number, y: number, rgba: readonly number[]) {
  const idx = (y * W + x) << 2;
  png.data[idx + 0] = rgba[0]!;
  png.data[idx + 1] = rgba[1]!;
  png.data[idx + 2] = rgba[2]!;
  png.data[idx + 3] = rgba[3]!;
}

for (let cell = 0; cell < cells.length; cell++) {
  const rows = cells[cell]!;
  const ox = cell * 16;
  for (let r = 0; r < 16; r++) {
    const row = rows[r]!;
    for (let c = 0; c < 16; c++) {
      const ch = row[c]!;
      const px = ch === 'g' ? G : ch === 'd' ? D : ch === 'h' ? Hi : T;
      set(ox + c, r, px);
    }
  }
}

writeFileSync('public/sprites/rank-icons.png', PNG.sync.write(png));
console.log('Wrote public/sprites/rank-icons.png');
