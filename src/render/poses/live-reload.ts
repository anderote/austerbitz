/**
 * Dev-mode live-reload poller.
 *
 * Watches:
 * 1. Each kit's JSON on disk for changes to its per-(pose, facing) weapon
 *    block (`x`, `y`, `rot`, `flipX`). Mutates the in-memory `KitConfig` in
 *    place when a diff is detected, then notifies the runtime via
 *    `onKitsChanged` so it can recompute any kit-derived caches.
 * 2. The atlas mtime endpoint (`/api/atlas-mtime`). When the most-recent
 *    sprite-PNG mtime changes, fetch the canonical pose atlas and report it
 *    back through `onAtlasChanged` so the renderer can swap the GL texture.
 *
 * No-op outside `import.meta.env.DEV` — production builds don't poll. Returns
 * a cancel function to stop the poller (used by hot-module-replace; in normal
 * runs nothing calls it).
 */

import type { KitConfig } from './kit-loader';
import type { Facing, PoseFacingEntry, WeaponOrientation } from './resolver';

export interface LiveReloadHandles {
  /** In-memory kit map; mutated in place on diffs. */
  kits: Map<string, KitConfig>;
  /**
   * Called when the kit map has been refreshed in place — runtime should
   * recompute any kit-derived caches (e.g., the weaponUvByPrefix in
   * sprite-pass).
   */
  onKitsChanged?: () => void;
  /**
   * Called when one or more atlas PNGs have changed mtime since the last
   * tick. Runtime should refetch + re-upload the GL texture. Receives an
   * `ImageBitmap` if the module was configured with `atlasPngUrl`; otherwise
   * `null` (the runtime is expected to rebuild its own atlas in that case,
   * since the renderer composes from many small PNGs).
   */
  onAtlasChanged?: (image: ImageBitmap | null) => void;
}

export interface LiveReloadOptions {
  /** Polling interval in ms; defaults to 1500. */
  intervalMs?: number;
  /**
   * Override the atlas-mtime endpoint URL. Defaults to `/api/atlas-mtime`.
   * Used only by tests.
   */
  atlasMtimeUrl?: string;
  /**
   * Path to fetch a kit's JSON (without the kit id). Defaults to
   * `/components/kits/`. The id is appended verbatim plus `.json`.
   */
  kitJsonBaseUrl?: string;
  /**
   * Where to fetch the canonical atlas PNG. The runtime composes its texture
   * from many small PNGs, so swapping a single PNG is wrong; instead we let
   * the caller's `onAtlasChanged` handler decide what to do — pass null here
   * to disable atlas image fetching entirely (the handler can then re-build
   * its own atlas on the next call).
   */
  atlasPngUrl?: string | null;
}

const FACING_KEYS: readonly Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Poll the editor's kit JSON files + atlas mtime endpoint and notify the
 * runtime of changes. Returns a cancel function.
 */
export function startLiveReload(
  handles: LiveReloadHandles,
  opts: LiveReloadOptions = {},
): () => void {
  // Bail entirely in production builds. Vite inlines `import.meta.env.DEV` to
  // a constant at build time so this branch is dead-code-eliminated.
  if (!import.meta.env.DEV) {
    return () => {};
  }
  const intervalMs = opts.intervalMs ?? 1500;
  const atlasMtimeUrl = opts.atlasMtimeUrl ?? '/api/atlas-mtime';
  const kitJsonBaseUrl = opts.kitJsonBaseUrl ?? '/components/kits/';
  const atlasPngUrl = opts.atlasPngUrl === undefined ? null : opts.atlasPngUrl;

  let cancelled = false;
  let lastAtlasMtime: string | null = null;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (cancelled || inFlight) return;
    inFlight = true;
    try {
      // 1) Atlas mtime ping.
      try {
        const res = await fetch(atlasMtimeUrl, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { mtime?: string | null };
          const mtime = data.mtime ?? null;
          if (mtime !== null && mtime !== lastAtlasMtime) {
            const isFirstObservation = lastAtlasMtime === null;
            lastAtlasMtime = mtime;
            // First observation just records the baseline — don't fire the
            // change handler until something actually changes mid-session.
            if (!isFirstObservation && handles.onAtlasChanged) {
              if (atlasPngUrl) {
                try {
                  const r = await fetch(atlasPngUrl, { cache: 'no-store' });
                  if (r.ok) {
                    const blob = await r.blob();
                    const image = await createImageBitmap(blob);
                    handles.onAtlasChanged(image);
                  }
                } catch (err) {
                  console.warn('[live-reload] atlas image fetch failed:', err);
                }
              } else {
                // No PNG URL → caller rebuilds its own atlas. Pass null so
                // the handler knows it needs to do the work itself.
                handles.onAtlasChanged(null);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[live-reload] atlas mtime poll failed:', err);
      }

      // 2) Kit JSON diff per kit in handles.kits.
      let kitsDirty = false;
      for (const [id, kit] of handles.kits.entries()) {
        try {
          const res = await fetch(`${kitJsonBaseUrl}${id}.json`, { cache: 'no-store' });
          if (!res.ok) continue;
          const fresh = (await res.json()) as KitConfig;
          if (mergeWeaponPoseDiff(kit, fresh)) {
            kitsDirty = true;
          }
        } catch (err) {
          console.warn(`[live-reload] kit '${id}' fetch failed:`, err);
        }
      }
      if (kitsDirty && handles.onKitsChanged) {
        handles.onKitsChanged();
      }
    } finally {
      inFlight = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  // Kick off an immediate tick so the baseline mtime is recorded fast (the
  // first tick is otherwise delayed by a full intervalMs).
  void tick();

  return () => {
    cancelled = true;
    clearInterval(handle);
  };
}

/**
 * Merge any per-(pose, facing) inline `weapons[]` edits from `fresh` into
 * `target` in place. We sync the inline orientation arrays so the editor's
 * nudge / mirror / rotate buttons flow into the running game.
 *
 * Layers and the top-level weapon block aren't synced — those need a full
 * reload. Returns true when at least one orientation changed.
 */
function mergeWeaponPoseDiff(target: KitConfig, fresh: KitConfig): boolean {
  if (!fresh || typeof fresh !== 'object') return false;
  let dirty = false;

  const freshPoses = fresh.poses;
  if (!freshPoses || typeof freshPoses !== 'object') return dirty;
  if (!target.poses || typeof target.poses !== 'object') {
    target.poses = {};
  }
  for (const [poseId, freshFacings] of Object.entries(freshPoses)) {
    if (!freshFacings || typeof freshFacings !== 'object') continue;
    let targetFacings = target.poses[poseId];
    if (!targetFacings || typeof targetFacings !== 'object' || Array.isArray(targetFacings)) {
      target.poses[poseId] = {};
      targetFacings = target.poses[poseId];
    }
    for (const facing of FACING_KEYS) {
      const freshEntry = (freshFacings as Record<string, unknown>)[facing];
      if (!freshEntry) continue;
      const freshNorm = normalizePoseEntry(freshEntry);
      const targetEntry = targetFacings[facing];
      const targetNorm = targetEntry ? normalizePoseEntry(targetEntry) : { layers: [] };
      if (!weaponsEqual(freshNorm.weapons, targetNorm.weapons)) {
        const cloned = freshNorm.weapons
          ? freshNorm.weapons.map(cloneOrientation)
          : undefined;
        if (Array.isArray(targetEntry)) {
          targetFacings[facing] = {
            layers: targetEntry,
            ...(cloned ? { weapons: cloned } : {}),
          };
        } else if (targetEntry && typeof targetEntry === 'object') {
          if (cloned) {
            (targetEntry as PoseFacingEntry).weapons = cloned;
          } else {
            delete (targetEntry as PoseFacingEntry).weapons;
          }
        } else {
          targetFacings[facing] = {
            layers: [],
            ...(cloned ? { weapons: cloned } : {}),
          };
        }
        dirty = true;
      }
    }
  }
  return dirty;
}

function normalizePoseEntry(raw: unknown): PoseFacingEntry {
  if (Array.isArray(raw)) return { layers: raw as string[] };
  if (raw && typeof raw === 'object') return raw as PoseFacingEntry;
  return { layers: [] };
}

function orientationEquals(a: WeaponOrientation, b: WeaponOrientation): boolean {
  return (
    a.src === b.src &&
    (a.transform ?? 'none') === (b.transform ?? 'none') &&
    a.x === b.x &&
    a.y === b.y &&
    a.rot === b.rot &&
    (a.flipX ?? false) === (b.flipX ?? false)
  );
}

function weaponsEqual(
  a: WeaponOrientation[] | undefined,
  b: WeaponOrientation[] | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!orientationEquals(a[i]!, b[i]!)) return false;
  }
  return true;
}

function cloneOrientation(e: WeaponOrientation): WeaponOrientation {
  const out: WeaponOrientation = { src: e.src, x: e.x, y: e.y, rot: e.rot };
  if (e.transform) out.transform = e.transform;
  if (e.flipX === true) out.flipX = true;
  return out;
}
