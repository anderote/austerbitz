import { MANIFEST } from './manifest';

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer | null>();
let loadStarted = false;
let muted = false;

export interface SfxCamera { center: { x: number; y: number } }

/** Toggle global SFX mute. When muted, `playSfx` is a no-op. */
export function setSfxMuted(v: boolean): void {
  muted = v;
}

/**
 * Lazy-initialize the AudioContext (must be called from a user gesture
 * because of browser autoplay policies). Subsequent calls are no-ops.
 * Kicks off async loads of all manifest entries; failures cache `null`.
 */
export function initSfx(): void {
  if (ctx) return;
  try { ctx = new AudioContext(); } catch { return; }
  if (!loadStarted) {
    loadStarted = true;
    for (const [name, cfg] of Object.entries(MANIFEST)) {
      void loadOne(name, cfg.url);
    }
  }
}

async function loadOne(name: string, url: string): Promise<void> {
  if (!ctx) return;
  try {
    const r = await fetch(url);
    if (!r.ok) { buffers.set(name, null); return; }
    const buf = await ctx.decodeAudioData(await r.arrayBuffer());
    buffers.set(name, buf);
  } catch {
    buffers.set(name, null);
  }
}

/**
 * Play a sound at world position (x, y) with distance falloff relative to
 * camera. Silently no-op if the AudioContext is not yet initialized or the
 * named clip is missing/failed-to-load.
 */
export function playSfx(name: string, x: number, y: number, camera: SfxCamera): void {
  if (muted) return;
  if (!ctx) return;
  const buf = buffers.get(name);
  if (!buf) return;
  const cfg = MANIFEST[name];
  if (!cfg) return;
  const dx = x - camera.center.x;
  const dy = y - camera.center.y;
  const dist = Math.hypot(dx, dy);
  const vol = cfg.gain * Math.max(0, 1 - dist / cfg.falloffM);
  if (vol <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(ctx.destination);
  src.start();
}
