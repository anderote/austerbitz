import type { Facing, PoseFacingEntry, WeaponBlock } from './resolver';

/**
 * Subset of the kit JSON that the runtime renderer cares about.
 *
 * The editor tracks more (cell coords, facing layer arrays, etc.); the runtime
 * only reads the per-pose weapon block + per-(pose,facing) inline
 * `weapons[]` orientations.
 */
export interface KitConfig {
  id: string;
  /** Per-(pose, facing) layer list + optional inline `weapons[]`. Editor namespace. */
  poses?: Record<string, Record<string, string[] | string[][] | PoseFacingEntry>>;
  /** Weapon attachment block (just `layerPrefix`). Absent for unarmed units. */
  weapon?: WeaponBlock;
  /**
   * Optional headgear block. Headgear still uses the legacy per-facing shape
   * (one source PNG per facing, no palette) — distinct from the weapon path.
   */
  head?: HeadBlock;
  /**
   * Per-kit identity colour for cheap kit-aware debris. Multiplied into the
   * generic limb chunks (legs/arms) at debris-pass draw time so a peasant's
   * legs read differently from a line-infantry leg even though both reuse the
   * same generic 8x8 sprite. Combined with the team's regiment tint so the
   * faction is also visible. RGB 0..255, omitted = neutral white (no tint).
   */
  gibTint?: [number, number, number];
  /**
   * Per-kit gib chunk pools. Chunk ids must match `manifest.json`. When a pool
   * is non-empty, the spawn picker draws uniformly from it; when absent or
   * empty, the picker falls back to the legacy random distribution. `misc` is
   * a bonus pool — full-dismemberment plans roll a small chance of one extra
   * misc chunk (e.g. an epaulette, a cartridge box) for flavour.
   */
  gibChunks?: {
    arm?: string[];
    leg?: string[];
    torso?: string[];
    misc?: string[];
  };
}

/** Texture-space transform applied when re-using a head facing's sprite. */
type HeadFacingTransform = 'flipX' | 'flipY' | 'rot180';

/** Either authored on this facing (`self`) or borrowed from another facing. */
export type HeadFacingEntry =
  | { src: 'self' }
  | { src: Facing; transform: HeadFacingTransform };

/** Top-level kit head block. Shape matches the pre-palette weapon block. */
export interface HeadBlock {
  layerPrefix: string;
  facings: Record<Facing, HeadFacingEntry>;
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
 * Weapon facings packed into the pose atlas. Any of these may be referenced
 * as a `src` by `kit.weapon.facings[F]`; the resolver UV-flips at draw time
 * for derived facings. Listing all 8 lets kits author whichever subset of
 * source sprites they want and pick freely per character facing.
 */
export const WEAPON_SOURCE_FACINGS: readonly Facing[] = [
  'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW',
] as const;

/**
 * Map a runtime `Pose` enum value to the editor's pose-name namespace.
 *
 * Kit JSONs key per-pose weapon offsets under editor pose names like
 * `idle`, `walking`, `running`, `make-ready`, `present`, `fire`, `hit`,
 * `dying`. The runtime tracks state via the `Pose` enum (`idle`, `aiming`,
 * `firing`, `reloading`, ...). This mapping bridges the two so the runtime
 * can look up `(x, y, rot)` for the current entity state.
 *
 * Returns `null` only for unknown enum values — the caller should fall back
 * to the zero offset in that case.
 */
export function runtimePoseToEditorPoseName(pose: number): string | null {
  // Pose enum values (kept as numeric literals to avoid a circular import via
  // pose-config). See `src/render/poses/pose-config.ts`.
  switch (pose) {
    case 0: return 'idle';
    case 1: return 'walking';
    case 2: return 'running';
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
