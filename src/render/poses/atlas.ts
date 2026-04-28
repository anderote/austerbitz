import { POSE_NAMES, Pose, POSE_CONFIG, resolveFrame, type Direction } from './pose-config';
import { buildDirLookup, type Facing } from './resolver';
import {
  WEAPON_SOURCE_FACINGS,
  loadComponentPaths,
  loadKits,
  type ComponentPathLookup,
  type KitConfig,
} from './kit-loader';

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
  /**
   * Per-weapon-prefix lookup of the 3 authored source-facing rects in the
   * combined atlas. Derived facings (NE, SE, S, SW, E) are not stored — the
   * runtime resolves them via UV flips of the source rect.
   */
  weaponCells: Map<string, Map<Facing, PoseCellRect>>;
  /**
   * Per-headgear-prefix lookup of source-facing rects. Same structure as
   * `weaponCells` — hats live in the same atlas image, just keyed separately
   * so the dropped-items pass can route by item kind.
   */
  headCells: Map<string, Map<Facing, PoseCellRect>>;
  /**
   * Detachable-part variants. Outer key is variant name (e.g. `'head'`); inner
   * structure mirrors `cells` exactly (kind → pose → dir → clips → frames).
   * Populated when the manifest contains `<base>--no-<variant>` pose folders.
   * Lookups should fall back to `cells` if a variant is missing.
   */
  variantCells: Map<string, Map<string, Map<number, Map<string, PoseCellRect[][]>>>>;
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
    weaponCells: new Map(),
    headCells: new Map(),
    variantCells: new Map(),
  };
}

/**
 * Parse a pose folder name into its `(base, variant)` components.
 * `walking--no-head` → `{ base: 'walking', variant: 'head' }`.
 * Plain folder names → `{ base: <name>, variant: null }`.
 */
function parsePoseFolderName(name: string): { base: string; variant: string | null } {
  const m = /^(.+)--no-(.+)$/.exec(name);
  if (m) return { base: m[1]!, variant: m[2]! };
  return { base: name, variant: null };
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
      // Detachable-part variants (`<base>--no-<part>`) validate against the
      // base name only; the variant suffix is opaque here.
      const { base } = parsePoseFolderName(poseName);
      if (poseEnumFromName(base) === null) {
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
  /** Detachable-part variant name (e.g. `'head'`); null = base pose cell. */
  variant: string | null;
}

interface WeaponRef {
  /** `kit.weapon.layerPrefix`, e.g. `'musket-brown-bess'`. */
  layerPrefix: string;
  /** Source facing — always one of the 3 authored ones (N, NW, W). */
  facing: Facing;
}

/** Normalize a `(pose, facing)` raw entry to an object with optional weapons[]. */
function readPoseFacingWeapons(raw: unknown): readonly { src: Facing }[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const w = (raw as { weapons?: unknown }).weapons;
  if (!Array.isArray(w)) return [];
  return w as { src: Facing }[];
}

interface HeadRef {
  /** `kit.head.layerPrefix`, e.g. `'shako-standard'`. */
  layerPrefix: string;
  facing: Facing;
}

/**
 * Resolve component paths for the source-facing PNGs each kit's inline
 * `weapons[]` orientations actually use. Walks every kit's
 * `kit.poses[*][*].weapons[]` and packs only the unique `(layerPrefix, src)`
 * pairs it references. Returns parallel refs + urls arrays so the caller can
 * fetch + pack them alongside body pose frames.
 *
 * Dedup is keyed on `(layerPrefix, src)` — the per-source sprite is identical
 * regardless of `transform`, since `transform` is applied as a UV flip at
 * sample time. Packing the same source × multiple transforms once is the
 * correct economy.
 */
function collectWeaponRefs(
  kits: ReadonlyMap<string, KitConfig>,
  componentPaths: ComponentPathLookup,
  componentBaseUrl: string,
): { refs: WeaponRef[]; urls: string[] } {
  const refs: WeaponRef[] = [];
  const urls: string[] = [];
  // De-dupe by `${layerPrefix}|${facing}` so two kits sharing the same weapon
  // (and the same src facings) don't pack duplicate sprites.
  const seen = new Set<string>();
  for (const kit of kits.values()) {
    if (!kit.weapon) continue;
    const layerPrefix = kit.weapon.layerPrefix;
    const poses = kit.poses;
    if (!poses || typeof poses !== 'object') {
      console.warn(
        `[pose-atlas] kit '${kit.id}' has a weapon block but no poses; ` +
          `weapon sprites will not be packed.`,
      );
      continue;
    }
    let kitHadAnyWeapon = false;
    for (const poseEntry of Object.values(poses)) {
      if (!poseEntry || typeof poseEntry !== 'object' || Array.isArray(poseEntry)) continue;
      for (const facingEntry of Object.values(poseEntry)) {
        const weapons = readPoseFacingWeapons(facingEntry);
        for (const orientation of weapons) {
          kitHadAnyWeapon = true;
          const key = `${layerPrefix}|${orientation.src}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const componentId = `${layerPrefix}-${facingToComponentSuffix(orientation.src)}`;
          const path = componentPaths.get(componentId);
          if (!path) {
            console.warn(
              `[pose-atlas] weapon sprite '${componentId}' missing from component registry; ` +
                `skipping src=${orientation.src} of '${layerPrefix}'`,
            );
            continue;
          }
          refs.push({ layerPrefix, facing: orientation.src });
          urls.push(`${componentBaseUrl}/${path}`);
        }
      }
    }
    if (!kitHadAnyWeapon) {
      console.warn(
        `[pose-atlas] kit '${kit.id}' has a weapon block but no inline weapons[] ` +
          `entries on any (pose, facing); weapon sprites will not be packed.`,
      );
    }
  }
  return { refs, urls };
}

/**
 * Mirror of `collectWeaponRefs` for `kit.head` blocks. Hats are packed into
 * the same atlas image (separate cell map) so the dropped-items pass can
 * route by `kind` discriminator without an additional texture binding.
 */
function collectHeadRefs(
  kits: ReadonlyMap<string, KitConfig>,
  componentPaths: ComponentPathLookup,
  componentBaseUrl: string,
): { refs: HeadRef[]; urls: string[] } {
  const refs: HeadRef[] = [];
  const urls: string[] = [];
  const seenPrefixes = new Set<string>();
  for (const kit of kits.values()) {
    if (!kit.head) continue;
    if (seenPrefixes.has(kit.head.layerPrefix)) continue;
    seenPrefixes.add(kit.head.layerPrefix);
    for (const facing of WEAPON_SOURCE_FACINGS) {
      const componentId = `${kit.head.layerPrefix}-${facingToComponentSuffix(facing)}`;
      const path = componentPaths.get(componentId);
      if (!path) {
        console.warn(
          `[pose-atlas] head sprite '${componentId}' missing from component registry; ` +
            `skipping facing ${facing} of '${kit.head.layerPrefix}'`,
        );
        continue;
      }
      refs.push({ layerPrefix: kit.head.layerPrefix, facing });
      urls.push(`${componentBaseUrl}/${path}`);
    }
  }
  return { refs, urls };
}

/**
 * The component-registry uses lowercase compass words for facings
 * (`musket-brown-bess-north`), while the resolver uses 2-letter compass codes
 * (`N`). This mapping bridges the two so we can look up the registry path
 * from a `Facing`.
 */
function facingToComponentSuffix(f: Facing): string {
  switch (f) {
    case 'N': return 'north';
    case 'NE': return 'northeast';
    case 'E': return 'east';
    case 'SE': return 'southeast';
    case 'S': return 'south';
    case 'SW': return 'southwest';
    case 'W': return 'west';
    case 'NW': return 'northwest';
  }
}

export async function loadPoseAtlas(
  gl: WebGL2RenderingContext,
  manifestUrl = '/sprites/poses/manifest.json',
  componentBaseUrl = '/sprites/components',
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

  // Body pose frames.
  const root = manifestRoot(manifestUrl);
  const refs: FrameRef[] = [];
  const urls: string[] = [];

  if (manifest.kinds) {
    for (const [kind, kindEntry] of Object.entries(manifest.kinds)) {
      for (const [poseName, poseEntry] of Object.entries(kindEntry.poses)) {
        const { base, variant } = parsePoseFolderName(poseName);
        const pose = poseEnumFromName(base);
        if (pose === null) continue;
        for (const [dir, clips] of Object.entries(poseEntry.clips)) {
          clips.forEach((frames, clipIdx) => {
            frames.forEach((frame, frameIdx) => {
              refs.push({ kind, pose, dir, clipIdx, frameIdx, variant });
              urls.push(`${root}/${kind}/${poseName}/${frame}`);
            });
          });
        }
      }
    }
  }

  // Weapon source-facing sprites (3 per kit with a weapon block). Best-effort:
  // any failure in kit-loader returns empty maps so the rest of the atlas
  // still loads.
  const kits = await loadKits();
  const componentPaths = await loadComponentPaths();
  const weapon = collectWeaponRefs(kits, componentPaths, componentBaseUrl);
  const head = collectHeadRefs(kits, componentPaths, componentBaseUrl);

  if (refs.length === 0 && weapon.refs.length === 0 && head.refs.length === 0) {
    return emptyAtlas();
  }

  // Fetch all frames + weapon sprites + head sprites in parallel.
  const allUrls = [...urls, ...weapon.urls, ...head.urls];
  const bitmaps: BitmapLike[] = await Promise.all(
    allUrls.map(async (url) => {
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

  // Build cells lookup. `id`s 0..bodyRefCount-1 are body frames (base + variant
  // both — `ref.variant` discriminates which tree they land in);
  // bodyRefCount..bodyRefCount+weaponRefCount-1 are weapon sprites;
  // remaining ids are head/hat sprites.
  const cells: PoseAtlas['cells'] = new Map();
  const variantCells: PoseAtlas['variantCells'] = new Map();
  const weaponCells: PoseAtlas['weaponCells'] = new Map();
  const headCells: PoseAtlas['headCells'] = new Map();
  const bodyRefCount = refs.length;
  const weaponRefCount = weapon.refs.length;
  for (const r of packed.rects) {
    if (r.id < bodyRefCount) {
      const ref = refs[r.id]!;
      // Base frames go into `cells`; variant frames go into the matching
      // sub-tree of `variantCells`. Both share the same internal shape.
      let targetTree: PoseAtlas['cells'];
      if (ref.variant === null) {
        targetTree = cells;
      } else {
        let perVariant = variantCells.get(ref.variant);
        if (!perVariant) {
          perVariant = new Map();
          variantCells.set(ref.variant, perVariant);
        }
        targetTree = perVariant;
      }
      let kindMap = targetTree.get(ref.kind);
      if (!kindMap) {
        kindMap = new Map();
        targetTree.set(ref.kind, kindMap);
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
    } else if (r.id < bodyRefCount + weaponRefCount) {
      const wref = weapon.refs[r.id - bodyRefCount]!;
      let prefixMap = weaponCells.get(wref.layerPrefix);
      if (!prefixMap) {
        prefixMap = new Map();
        weaponCells.set(wref.layerPrefix, prefixMap);
      }
      prefixMap.set(wref.facing, { px: r.px, py: r.py, w: r.w, h: r.h });
    } else {
      const href = head.refs[r.id - bodyRefCount - weaponRefCount]!;
      let prefixMap = headCells.get(href.layerPrefix);
      if (!prefixMap) {
        prefixMap = new Map();
        headCells.set(href.layerPrefix, prefixMap);
      }
      prefixMap.set(href.facing, { px: r.px, py: r.py, w: r.w, h: r.h });
    }
  }

  // Build dirLookup using buildDirLookup. Variant pose folders share the same
  // direction shape as their base — base wins on collision, but variant data
  // is kept as a fallback so a kind that authors *only* a variant still has
  // a usable dirLookup entry.
  const dirLookup: PoseAtlas['dirLookup'] = new Map();
  if (manifest.kinds) {
    for (const [kind, kindEntry] of Object.entries(manifest.kinds)) {
      const kindLookup = new Map<number, string[]>();
      for (const [poseName, poseEntry] of Object.entries(kindEntry.poses)) {
        const { base, variant } = parsePoseFolderName(poseName);
        const pose = poseEnumFromName(base);
        if (pose === null) continue;
        if (variant !== null && kindLookup.has(pose)) continue;
        const dirs = poseEntry.dirs as Direction[];
        kindLookup.set(pose, buildDirLookup(dirs) as string[]);
      }
      dirLookup.set(kind, kindLookup);
    }
  }

  return {
    pixels,
    width: packed.width,
    height: packed.height,
    cells,
    dirLookup,
    weaponCells,
    headCells,
    variantCells,
  };
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
 * Resolve a weapon (layerPrefix, facing) into a `[u0, v0, us, vs]` UV rect on
 * the combined atlas, with the per-facing transform baked into the rect via
 * sign flips:
 *
 * - `flipX`: u-axis runs reversed → emit `(u0 + us, v0, -us, vs)`.
 * - `flipY`: v-axis runs reversed → emit `(u0, v0 + vs, us, -vs)`.
 * - `rot180`: both axes reversed → emit `(u0 + us, v0 + vs, -us, -vs)`.
 *
 * Negative `us`/`vs` cause the vertex shader's `quadUv` to walk the atlas
 * cell backwards, which in turn samples the mirrored pixels — no shader
 * branching needed. Returns null if the source facing isn't packed.
 */
export function pickWeaponUv(
  atlas: PoseAtlas,
  layerPrefix: string,
  sourceFacing: Facing,
  transform: 'none' | 'flipX' | 'flipY' | 'rot180',
  poseAtlasY: number,
  sheetW: number,
  sheetH: number,
): [number, number, number, number] | null {
  const prefixMap = atlas.weaponCells.get(layerPrefix);
  if (!prefixMap) return null;
  const rect = prefixMap.get(sourceFacing);
  if (!rect) return null;
  const [u0, v0, us, vs] = poseCellUv(rect, poseAtlasY, sheetW, sheetH);
  switch (transform) {
    case 'none':
      return [u0, v0, us, vs];
    case 'flipX':
      return [u0 + us, v0, -us, vs];
    case 'flipY':
      return [u0, v0 + vs, us, -vs];
    case 'rot180':
      return [u0 + us, v0 + vs, -us, -vs];
  }
}

/**
 * Resolve a (head layerPrefix, facing) into a `[u0, v0, us, vs]` UV rect.
 * Mirrors `pickWeaponUv` but reads the parallel `headCells` lookup table.
 */
export function pickHeadUv(
  atlas: PoseAtlas,
  layerPrefix: string,
  sourceFacing: Facing,
  transform: 'none' | 'flipX' | 'flipY' | 'rot180',
  poseAtlasY: number,
  sheetW: number,
  sheetH: number,
): [number, number, number, number] | null {
  const prefixMap = atlas.headCells.get(layerPrefix);
  if (!prefixMap) return null;
  const rect = prefixMap.get(sourceFacing);
  if (!rect) return null;
  const [u0, v0, us, vs] = poseCellUv(rect, poseAtlasY, sheetW, sheetH);
  switch (transform) {
    case 'none':
      return [u0, v0, us, vs];
    case 'flipX':
      return [u0 + us, v0, -us, vs];
    case 'flipY':
      return [u0, v0 + vs, us, -vs];
    case 'rot180':
      return [u0 + us, v0 + vs, -us, -vs];
  }
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

/**
 * Like `pickPoseUv` but reads from `atlas.variantCells.get(variant)` instead
 * of `atlas.cells`. Returns null on any miss (variant unknown, or
 * kind/pose/dir/clip lookup empty) — caller falls back to base via
 * `pickPoseUv`. No idle fallback inside the variant tree: the variant tree
 * mirrors the base layout 1:1, so the same call site that succeeded for the
 * base will succeed for the variant.
 */
export function pickPoseVariantUv(
  atlas: PoseAtlas,
  variant: string,
  kind: string,
  pose: number,
  facing: number,
  clipIdx: number,
  poseT: number,
  poseAtlasY: number,
  sheetW: number,
  sheetH: number,
): [number, number, number, number] | null {
  const tree = atlas.variantCells.get(variant);
  if (!tree) return null;
  const kindMap = tree.get(kind);
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
