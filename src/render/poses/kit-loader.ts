import type { Facing, PoseFacingEntry, WeaponBlock } from './resolver';

/**
 * Subset of the kit JSON that the runtime renderer cares about.
 *
 * The editor tracks more (cell coords, facing layer arrays, etc.); the runtime
 * only reads the per-pose weapon block + per-(pose,facing) `(x, y, rot)`.
 */
export interface KitConfig {
  id: string;
  /** Per-(pose, facing) layer + optional weapon offset. Editor namespace. */
  poses?: Record<string, Record<string, string[] | PoseFacingEntry>>;
  /** Weapon attachment block. Absent for unarmed units. */
  weapon?: WeaponBlock;
}

/**
 * Component-registry entry as written by the editor and consumed by the
 * runtime to find a weapon sprite's PNG path on disk.
 */
export interface ComponentEntry {
  id: string;
  /** Path relative to `public/sprites/components/`. */
  path: string;
}

interface ComponentRegistry {
  components: ComponentEntry[];
}

/** Maps `kit.weapon.layerPrefix-<facing>` ids to component paths. */
export type ComponentPathLookup = Map<string, string>;

const KIT_INDEX_URL = '/components/kits/index.json';
const COMPONENTS_REGISTRY_URL = '/components/index.json';

/**
 * Best-effort fetch of the kit index + every kit JSON. Returns a
 * `Map<kitId, KitConfig>`; on any network error or parse failure, returns an
 * empty map and logs a warning. Callers must tolerate missing kits — the
 * weapon pass simply skips entities whose kit is unknown or unarmed.
 */
export async function loadKits(): Promise<Map<string, KitConfig>> {
  const out = new Map<string, KitConfig>();
  let kitIds: string[];
  try {
    const res = await fetch(KIT_INDEX_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed: unknown = await res.json();
    if (!Array.isArray(parsed)) {
      throw new Error('kit index must be an array of kit ids');
    }
    kitIds = parsed.filter((x): x is string => typeof x === 'string');
  } catch (err) {
    console.warn('[kit-loader] failed to load kit index:', err);
    return out;
  }

  for (const id of kitIds) {
    try {
      const res = await fetch(`/components/kits/${id}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = (await res.json()) as KitConfig;
      if (parsed && typeof parsed === 'object' && parsed.id === id) {
        out.set(id, parsed);
      } else {
        console.warn(`[kit-loader] kit '${id}' has missing/mismatched id field`);
      }
    } catch (err) {
      console.warn(`[kit-loader] failed to load kit '${id}':`, err);
    }
  }
  return out;
}

/**
 * Load the component-id → file-path map. Used by the pose-atlas builder to
 * find the weapon source PNG for a `<layerPrefix>-<facing>` id.
 */
export async function loadComponentPaths(): Promise<ComponentPathLookup> {
  const out: ComponentPathLookup = new Map();
  try {
    const res = await fetch(COMPONENTS_REGISTRY_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = (await res.json()) as ComponentRegistry;
    if (parsed && Array.isArray(parsed.components)) {
      for (const c of parsed.components) {
        if (c && typeof c.id === 'string' && typeof c.path === 'string') {
          out.set(c.id, c.path);
        }
      }
    }
  } catch (err) {
    console.warn('[kit-loader] failed to load component registry:', err);
  }
  return out;
}

/**
 * The 3 source facings that the weapon-attachment system requires authored
 * sprites for. Derived facings (NE, SE, S, SW, E) are produced at runtime by
 * UV-flipping the source sprite.
 */
export const WEAPON_SOURCE_FACINGS: readonly Facing[] = ['N', 'NW', 'W'] as const;

/**
 * Map a runtime `Pose` enum value to the editor's pose-name namespace.
 *
 * Kit JSONs key per-pose weapon offsets under editor pose names like
 * `make-ready`, `present`, `fire`, `hit`, `dying`. The runtime tracks state
 * via the `Pose` enum (`idle`, `aiming`, `firing`, `reloading`, ...). This
 * mapping bridges the two so the runtime can look up `(x, y, rot)` for the
 * current entity state.
 *
 * Returns `null` for poses that the editor doesn't author per-pose offsets
 * for (e.g. walking / running / dead) — the caller should fall back to the
 * zero offset.
 */
export function runtimePoseToEditorPoseName(pose: number): string | null {
  // Pose enum values (kept as numeric literals to avoid a circular import via
  // pose-config). See `src/render/poses/pose-config.ts`.
  switch (pose) {
    case 0: return null;          // idle — facings block, no per-pose offset.
    case 1: return null;          // walking
    case 2: return null;          // running
    case 3: return 'present';     // aiming
    case 4: return 'fire';        // firing
    case 5: return 'make-ready';  // reloading
    case 6: return 'hit';         // flinch
    case 7: return 'dying';       // ragdoll
    case 8: return 'dying';       // dying
    case 9: return 'dying';       // dead
    default: return null;
  }
}
