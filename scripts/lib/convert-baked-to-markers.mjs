// Walks public/sprites/components/uniform/**/*.png and rewrites baked British
// primary-tone pixels to their magenta marker equivalents so the runtime
// shader, the editor preview, and build-soldier-components all recolor them
// per-regiment via the existing channel-dominance path. Idempotent: pixels
// that are already markers (or any other color) are left alone.
//
// Mapping (literal British → primary marker):
//   #C6373B (red,    primary mid)   → #FF00FF
//   #E36A6A (pink,   primary hi)    → #FF80FF
//   #8E1F25 (maroon, primary shade) → #A000A0
//   #5C1419 (deep,   primary deep)  → #500050
//
// Run via: node scripts/lib/convert-baked-to-markers.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// (r, g, b) -> (r, g, b) marker. Keys packed as (r<<16)|(g<<8)|b.
const REMAP = new Map([
  [(0xc6 << 16) | (0x37 << 8) | 0x3b, [0xff, 0x00, 0xff]],
  [(0xe3 << 16) | (0x6a << 8) | 0x6a, [0xff, 0x80, 0xff]],
  [(0x8e << 16) | (0x1f << 8) | 0x25, [0xa0, 0x00, 0xa0]],
  [(0x5c << 16) | (0x14 << 8) | 0x19, [0x50, 0x00, 0x50]],
]);

async function main() {
  const pattern = 'public/sprites/components/uniform/**/*.png';
  const root = ROOT;
  let scanned = 0;
  let touched = 0;
  let totalPixels = 0;
  for await (const relPath of glob(pattern, { cwd: root })) {
    const full = resolve(root, relPath);
    const buf = readFileSync(full);
    const png = PNG.sync.read(buf);
    let changed = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      const key = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
      const remap = REMAP.get(key);
      if (!remap) continue;
      png.data[i] = remap[0];
      png.data[i + 1] = remap[1];
      png.data[i + 2] = remap[2];
      changed++;
    }
    scanned++;
    if (changed > 0) {
      writeFileSync(full, PNG.sync.write(png));
      touched++;
      totalPixels += changed;
      console.log(`  ${relative(root, full)}: ${changed} px`);
    }
  }
  console.log(`\nScanned ${scanned} PNGs, rewrote ${touched} (${totalPixels} pixels remapped).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
