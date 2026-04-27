import { describe, it, expect } from 'vitest';
import {
  KIND_ATLAS,
  COMBINED_SHEET_W,
  COMBINED_SHEET_H,
  generateCombinedAtlas,
} from './sprite-atlas';

describe('combined sprite atlas', () => {
  it('matches declared dimensions', () => {
    const atlas = generateCombinedAtlas();
    expect(atlas.length).toBe(COMBINED_SHEET_W * COMBINED_SHEET_H * 4);
  });

  it('declares non-overlapping kind regions inside the sheet', () => {
    const entries = Object.entries(KIND_ATLAS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, meta] of entries) {
      expect(meta.region.x + meta.region.w, id).toBeLessThanOrEqual(COMBINED_SHEET_W);
      expect(meta.region.y + meta.region.h, id).toBeLessThanOrEqual(COMBINED_SHEET_H);
    }
    // Stacked vertically: pairwise y-ranges must not overlap.
    const sorted = entries.map(([, m]) => m).sort((a, b) => a.region.y - b.region.y);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      expect(prev.region.y + prev.region.h).toBeLessThanOrEqual(cur.region.y);
    }
  });

  it('keeps primary/secondary markers in each kind front cell by default', () => {
    const atlas = generateCombinedAtlas();
    for (const [id, meta] of Object.entries(KIND_ATLAS)) {
      const fx = meta.region.x + meta.frontCell.col * meta.cellW;
      const fy = meta.region.y + meta.frontCell.row * meta.cellH;
      let primaryHits = 0;
      let secondaryHits = 0;
      for (let y = 0; y < meta.cellH; y++) {
        for (let x = 0; x < meta.cellW; x++) {
          const i = ((fy + y) * COMBINED_SHEET_W + (fx + x)) * 4;
          const r = atlas[i + 0]!;
          const g = atlas[i + 1]!;
          const b = atlas[i + 2]!;
          if (r === 255 && g === 0 && b === 255) primaryHits++;
          if (r === 0 && g === 255 && b === 255) secondaryHits++;
        }
      }
      expect(primaryHits, `${id} primary markers`).toBeGreaterThan(0);
      expect(secondaryHits, `${id} secondary markers`).toBeGreaterThan(0);
    }
  });

  it('bakes resolved primary color into all kind regions', () => {
    const atlas = generateCombinedAtlas({ resolvePrimary: [10, 20, 30] });
    // No magenta markers should remain anywhere.
    for (let p = 0; p < atlas.length; p += 4) {
      const r = atlas[p + 0]!;
      const g = atlas[p + 1]!;
      const b = atlas[p + 2]!;
      expect(r === 255 && g === 0 && b === 255).toBe(false);
    }
    // At least one (10,20,30) pixel must exist inside each kind region.
    for (const [id, meta] of Object.entries(KIND_ATLAS)) {
      let hits = 0;
      for (let y = 0; y < meta.region.h; y++) {
        for (let x = 0; x < meta.region.w; x++) {
          const i = ((meta.region.y + y) * COMBINED_SHEET_W + (meta.region.x + x)) * 4;
          if (atlas[i] === 10 && atlas[i + 1] === 20 && atlas[i + 2] === 30) hits++;
        }
      }
      expect(hits, `${id} resolved-primary pixels`).toBeGreaterThan(0);
    }
  });
});
