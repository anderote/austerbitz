import { POSE_NAMES, Pose, POSE_CONFIG, resolveFrame, type Direction } from './pose-config';
import { buildDirLookup } from './resolver';

export interface PoseCellRect {
  px: number;
  py: number;
  w: number;
  h: number;
}

export interface PoseAtlas {
  pixels: Uint8Array;
  width: number;
  height: number;
  cells: Map<string, Map<number, Map<string, PoseCellRect[][]>>>;
  dirLookup: Map<string, Map<number, string[]>>;
}

interface PoseManifestPose {
  dirs: string[];
  clips: Record<string, string[][]>;
}

interface PoseManifest {
  kinds: Record<string, { poses: Record<string, PoseManifestPose> }>;
}

interface RectInput {
  id: number;
  w: number;
  h: number;
}

interface PackedRect {
  id: number;
  px: number;
  py: number;
  w: number;
  h: number;
}

interface PackResult {
  rects: PackedRect[];
  width: number;
  height: number;
}

const DEFAULT_MAX_WIDTH = 1024;

/**
 * Shelf-pack rects: sort by descending height, lay out left-to-right wrapping
 * at maxWidth, rows grow as new rects arrive. Returns positions and final
 * (width, height) of the packed sheet.
 */
export function packRects(rects: readonly RectInput[], maxWidth = DEFAULT_MAX_WIDTH): PackResult {
  if (rects.length === 0) return { rects: [], width: 1, height: 1 };
  for (const r of rects) {
    if (r.w > maxWidth) {
      throw new Error(`pose sprite too large for atlas: ${r.w}x${r.h} (max width ${maxWidth})`);
    }
  }
  const sorted = [...rects].sort((a, b) => b.h - a.h || b.w - a.w);
  const out: PackedRect[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let usedW = 0;
  for (const r of sorted) {
    if (x + r.w > maxWidth) {
      // wrap to new row
      y += rowH;
      x = 0;
      rowH = 0;
    }
    out.push({ id: r.id, px: x, py: y, w: r.w, h: r.h });
    x += r.w;
    if (r.h > rowH) rowH = r.h;
    if (x > usedW) usedW = x;
  }
  const totalH = y + rowH;
  return { rects: out, width: Math.max(1, usedW), height: Math.max(1, totalH) };
}

function emptyAtlas(): PoseAtlas {
  return {
    pixels: new Uint8Array(4),
    width: 1,
    height: 1,
    cells: new Map(),
    dirLookup: new Map(),
  };
}

function poseEnumFromName(name: string): number | null {
  const idx = POSE_NAMES.indexOf(name);
  if (idx < 0) return null;
  return idx as number;
}

function manifestRoot(manifestUrl: string): string {
  const i = manifestUrl.lastIndexOf('/');
  return i >= 0 ? manifestUrl.slice(0, i) : '';
}

/**
 * Validate a parsed manifest. Throws on invariants. Filters unknown poses with
 * a console.warn. Returns the filtered manifest.
 */
function validateManifest(manifest: PoseManifest): PoseManifest {
  for (const [kind, kindEntry] of Object.entries(manifest.kinds)) {
    for (const [poseName, poseEntry] of Object.entries(kindEntry.poses)) {
      if (poseEnumFromName(poseName) === null) {
        console.warn(`[pose-atlas] unknown pose '${poseName}' in kind '${kind}', skipping`);
        delete kindEntry.poses[poseName];
        continue;
      }
      const dirs = poseEntry.dirs ?? [];
      const hasOmni = dirs.includes('omni');
      const hasCompass = dirs.some((d) => d !== 'omni');
      if (hasOmni && hasCompass) {
        throw new Error(
          `pose '${poseName}' for kind '${kind}' has both 'omni' and compass directions`,
        );
      }
    }
  }
  return manifest;
}

interface BitmapLike {
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

interface FrameRef {
  kind: string;
  pose: number;
  dir: string;
  clipIdx: number;
  frameIdx: number;
}

export async function loadPoseAtlas(
  gl: WebGL2RenderingContext,
  manifestUrl = '/sprites/poses/manifest.json',
): Promise<PoseAtlas | null> {
  // gl is unused at this point — kept in signature for future texture-side
  // uploads if we move away from the combined-atlas compose path.
  void gl;
  let res: Response;
  try {
    res = await fetch(manifestUrl);
  } catch (err) {
    console.warn(`[pose-atlas] fetch failed: ${(err as Error).message}`);
    return null;
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pose manifest fetch failed: ${res.status}`);
  const manifest = validateManifest((await res.json()) as PoseManifest);

  if (!manifest.kinds || Object.keys(manifest.kinds).length === 0) {
    return emptyAtlas();
  }

  const root = manifestRoot(manifestUrl);
  const refs: FrameRef[] = [];
  const urls: string[] = [];

  for (const [kind, kindEntry] of Object.entries(manifest.kinds)) {
    for (const [poseName, poseEntry] of Object.entries(kindEntry.poses)) {
      const pose = poseEnumFromName(poseName);
      if (pose === null) continue;
      for (const [dir, clips] of Object.entries(poseEntry.clips)) {
        clips.forEach((frames, clipIdx) => {
          frames.forEach((frame, frameIdx) => {
            refs.push({ kind, pose, dir, clipIdx, frameIdx });
            urls.push(`${root}/${kind}/${poseName}/${frame}`);
          });
        });
      }
    }
  }

  if (refs.length === 0) return emptyAtlas();

  // Fetch all frames in parallel, decode to ImageBitmap.
  const bitmaps: BitmapLike[] = await Promise.all(
    urls.map(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`pose sprite fetch failed: ${url} (${r.status})`);
      const blob = await r.blob();
      const bm = await createImageBitmap(blob);
      return { width: bm.width, height: bm.height, bitmap: bm };
    }),
  );

  // Pack.
  const packIn = bitmaps.map((bm, i) => ({ id: i, w: bm.width, h: bm.height }));
  const packed = packRects(packIn);

  // Allocate combined buffer + draw via OffscreenCanvas, then read back once.
  const canvas = new OffscreenCanvas(packed.width, packed.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pose-atlas: 2D context unavailable');
  ctx.clearRect(0, 0, packed.width, packed.height);
  for (const r of packed.rects) {
    const bm = bitmaps[r.id]!;
    ctx.drawImage(bm.bitmap, r.px, r.py);
  }
  const imageData = ctx.getImageData(0, 0, packed.width, packed.height);
  const pixels = new Uint8Array(imageData.data.buffer.slice(0));

  // Build cells lookup.
  const cells: PoseAtlas['cells'] = new Map();
  for (const r of packed.rects) {
    const ref = refs[r.id]!;
    let kindMap = cells.get(ref.kind);
    if (!kindMap) {
      kindMap = new Map();
      cells.set(ref.kind, kindMap);
    }
    let poseMap = kindMap.get(ref.pose);
    if (!poseMap) {
      poseMap = new Map();
      kindMap.set(ref.pose, poseMap);
    }
    let clipList = poseMap.get(ref.dir);
    if (!clipList) {
      clipList = [];
      poseMap.set(ref.dir, clipList);
    }
    if (!clipList[ref.clipIdx]) clipList[ref.clipIdx] = [];
    clipList[ref.clipIdx]![ref.frameIdx] = { px: r.px, py: r.py, w: r.w, h: r.h };
  }

  // Build dirLookup using buildDirLookup.
  const dirLookup: PoseAtlas['dirLookup'] = new Map();
  for (const [kind, kindEntry] of Object.entries(manifest.kinds)) {
    const kindLookup = new Map<number, string[]>();
    for (const [poseName, poseEntry] of Object.entries(kindEntry.poses)) {
      const pose = poseEnumFromName(poseName);
      if (pose === null) continue;
      const dirs = poseEntry.dirs as Direction[];
      kindLookup.set(pose, buildDirLookup(dirs) as string[]);
    }
    dirLookup.set(kind, kindLookup);
  }

  return { pixels, width: packed.width, height: packed.height, cells, dirLookup };
}

/**
 * Compute UV rect [u0, v0, us, vs] for a pose cell whose pixel coords are
 * local to the pose-atlas region. Combined-sheet width/height supplied by
 * caller (only the sprite-pass knows the final composed dimensions).
 */
export function poseCellUv(
  rect: PoseCellRect,
  poseAtlasY: number,
  sheetW: number,
  sheetH: number,
): [number, number, number, number] {
  const halfTexelU = 0.5 / sheetW;
  const halfTexelV = 0.5 / sheetH;
  const u0 = rect.px / sheetW + halfTexelU;
  const v0 = (poseAtlasY + rect.py) / sheetH + halfTexelV;
  const us = rect.w / sheetW - 2 * halfTexelU;
  const vs = rect.h / sheetH - 2 * halfTexelV;
  return [u0, v0, us, vs];
}

/**
 * Resolve a (kind, pose, facing, clipIdx, poseT) to a UV rect on the
 * combined atlas, with idle fallback. Returns null on miss.
 */
export function pickPoseUv(
  atlas: PoseAtlas,
  kind: string,
  pose: number,
  facing: number,
  clipIdx: number,
  poseT: number,
  poseAtlasY: number,
  sheetW: number,
  sheetH: number,
): [number, number, number, number] | null {
  const kindMap = atlas.cells.get(kind);
  if (!kindMap) return null;
  let poseMap = kindMap.get(pose);
  let effectivePose = pose;
  if (!poseMap) {
    if (pose === Pose.idle) return null;
    poseMap = kindMap.get(Pose.idle);
    if (!poseMap) return null;
    effectivePose = Pose.idle;
  }
  const dirs = atlas.dirLookup.get(kind)?.get(effectivePose);
  if (!dirs) return null;
  // facing 0..7 starts at +X (E on screen) and advances CCW in math (= CW on
  // screen since world Y grows down). DIRECTIONS is N-CW. Mapping:
  //   facing=0 (E) → DIRECTIONS[2]; facing=2 (S) → [4]; facing=6 (N) → [0].
  const slot = (facing + 2) & 7;
  const dir = dirs[slot]!;
  const clipList = poseMap.get(dir);
  if (!clipList || clipList.length === 0) return null;
  const clip = clipList[clipIdx % clipList.length];
  if (!clip || clip.length === 0) return null;
  const cfg = POSE_CONFIG[effectivePose as Pose];
  const frameIdx = resolveFrame(cfg, poseT, clip.length);
  const cell = clip[frameIdx];
  if (!cell) return null;
  return poseCellUv(cell, poseAtlasY, sheetW, sheetH);
}
