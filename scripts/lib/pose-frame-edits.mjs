// scripts/lib/pose-frame-edits.mjs
//
// Tree of pixel-level edits applied to auto-derived pose-tree PNGs.
// Storage shape:
//   {
//     "<kind>": {
//       "<pose>": {
//         "<dir>": {
//           "<clipIdx>": {
//             "<frameIdx>": [{x, y, color}, ...]
//           }
//         }
//       }
//     }
//   }
//
// Edit color: '#rrggbb' or 'clear' (full transparency). Mirrors the
// existing pixel-edits.json convention.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const EDITS_PATH_REL = 'public/sprites/poses/edits.json';

/** Read public/sprites/poses/edits.json. Returns {} if missing/empty. */
export async function loadEdits(repoRoot) {
  const path = resolve(repoRoot, EDITS_PATH_REL);
  try {
    const buf = await readFile(path, 'utf8');
    if (!buf.trim()) return {};
    return JSON.parse(buf);
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

/** Walk to a frame's edit list. [] if any key missing. */
export function lookupEdits(tree, kind, pose, dir, clipIdx, frameIdx) {
  if (!tree) return [];
  const k = tree[kind];
  if (!k) return [];
  const p = k[pose];
  if (!p) return [];
  const d = p[dir];
  if (!d) return [];
  const c = d[String(clipIdx)];
  if (!c) return [];
  const f = c[String(frameIdx)];
  if (!Array.isArray(f)) return [];
  return f;
}

function parseHex(s) {
  if (typeof s !== 'string') return null;
  let m = s.match(/^#([0-9a-fA-F]{6})$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  m = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m) {
    const r = parseInt(m[1][0], 16);
    const g = parseInt(m[1][1], 16);
    const b = parseInt(m[1][2], 16);
    return [r * 17, g * 17, b * 17];
  }
  return null;
}

/**
 * Apply edits to RGBA buffer in place. Throws if buffer is wrong size.
 * Returns the count of successfully-applied edits.
 */
export function applyEdits(rgba, cellW, cellH, edits) {
  if (!Array.isArray(edits) || edits.length === 0) return 0;
  if (rgba.length !== cellW * cellH * 4) {
    throw new Error(
      `applyEdits: rgba length ${rgba.length} != ${cellW}*${cellH}*4`,
    );
  }
  let applied = 0;
  for (const e of edits) {
    if (!e || typeof e.x !== 'number' || typeof e.y !== 'number') continue;
    if (e.x < 0 || e.x >= cellW || e.y < 0 || e.y >= cellH) {
      console.warn(`[pose-frame-edits] out-of-range edit (${e.x},${e.y}) for ${cellW}x${cellH}`);
      continue;
    }
    const i = (e.y * cellW + e.x) * 4;
    if (e.color === 'clear') {
      rgba[i + 0] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    } else {
      const rgb = parseHex(e.color);
      if (!rgb) {
        console.warn(`[pose-frame-edits] unparseable color '${e.color}' at (${e.x},${e.y})`);
        continue;
      }
      rgba[i + 0] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
    }
    applied++;
  }
  return applied;
}
