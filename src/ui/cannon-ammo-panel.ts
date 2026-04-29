import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';

export interface CannonAmmoPanel {
  update(world: World, sel: Selection): void;
}

const AMMO_LABELS = ['Solid', 'Shell', 'Canister'];
const AMMO_KEYS = ['Z', 'X', 'C'];

/**
 * Hand-drawn 16×16 pixel-art icons for the three ammo types. Each entry
 * is a list of `[x, y, color]` rectangles drawn into a `<svg viewBox="0 0 16 16">`
 * so the rendering stays crisp at any size and matches the in-world pixel
 * aesthetic.
 */
type Pixel = [x: number, y: number, color: string];

// Cannonball — 12-pdr solid shot. Iron sphere with a single highlight pixel.
const SOLID_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  // Filled circle, radius ~5.5 around (8, 8). Two-tone fill for sphere read.
  for (let y = 3; y <= 13; y++) {
    for (let x = 3; x <= 13; x++) {
      const dx = x - 8 + 0.5;
      const dy = y - 8 + 0.5;
      const d = Math.hypot(dx, dy);
      if (d > 5.5) continue;
      // Darker on the bottom-right to fake spherical lighting.
      const lit = (dx + dy) < -2;
      out.push([x, y, lit ? '#3a3a3a' : '#0a0a0a']);
    }
  }
  // Specular highlight pixel — top-left.
  out.push([6, 5, '#9a9a9a']);
  return out;
})();

// Shell — cannonball with a sparking fuse on top.
const SHELL_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  // Body: same as solid but shifted down 1 row to make room for fuse.
  for (let y = 5; y <= 14; y++) {
    for (let x = 3; x <= 13; x++) {
      const dx = x - 8 + 0.5;
      const dy = y - 9 + 0.5;
      const d = Math.hypot(dx, dy);
      if (d > 5) continue;
      const lit = (dx + dy) < -2;
      out.push([x, y, lit ? '#3a3a3a' : '#0a0a0a']);
    }
  }
  out.push([6, 6, '#9a9a9a']);             // body highlight
  // Fuse stem (dark wood plug + two tiny embers at the tip).
  out.push([8, 4, '#4a3a20']);
  out.push([8, 3, '#7a5a30']);
  out.push([7, 2, '#ff8a30']);              // ember
  out.push([9, 2, '#ffd070']);              // ember
  out.push([8, 1, '#ffe080']);              // spark tip
  return out;
})();

// Canister — brass cylinder with a lid line and visible musket-ball shot inside.
const CANISTER_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  // Body — brass cylinder centered on (8, 8), 7 wide, 11 tall.
  const x0 = 5, x1 = 11;
  for (let y = 3; y <= 13; y++) {
    for (let x = x0; x <= x1; x++) {
      let color = '#a07a30';
      if (x === x0) color = '#7a5a20';      // left dark edge
      else if (x === x1) color = '#c89540'; // right highlight
      // Lid seam (top rim).
      if (y === 4) color = '#5a4018';
      // Bottom rim.
      if (y === 13) color = '#5a4018';
      out.push([x, y, color]);
    }
  }
  // Lid cap — top row.
  for (let x = x0; x <= x1; x++) {
    out.push([x, 3, '#3a2a10']);
  }
  // Iron shot showing through (3 dots in a triangle near the top).
  out.push([6, 6, '#1a1a1a']);
  out.push([8, 6, '#1a1a1a']);
  out.push([10, 6, '#1a1a1a']);
  out.push([7, 8, '#1a1a1a']);
  out.push([9, 8, '#1a1a1a']);
  out.push([8, 10, '#1a1a1a']);
  return out;
})();

const AMMO_PIXELS: Pixel[][] = [SOLID_PIXELS, SHELL_PIXELS, CANISTER_PIXELS];

function pixelsToSvg(pixels: Pixel[]): string {
  const rects = pixels
    .map(([x, y, c]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`)
    .join('');
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

export function createCannonAmmoPanel(root: HTMLElement): CannonAmmoPanel {
  const el = panel('cannon-ammo-panel');
  el.style.display = 'none';
  root.appendChild(el);

  const slots: HTMLDivElement[] = [];
  for (let i = 0; i < 3; i++) {
    const slot = document.createElement('div');
    slot.className = 'cannon-ammo-slot';
    slot.innerHTML =
      `<div class="cannon-ammo-icon">${pixelsToSvg(AMMO_PIXELS[i]!)}</div>` +
      `<div class="cannon-ammo-name">${AMMO_LABELS[i]}</div>` +
      `<div class="cannon-ammo-key">${AMMO_KEYS[i]}</div>`;
    el.appendChild(slot);
    slots.push(slot);
  }

  const mixedHint = document.createElement('div');
  mixedHint.className = 'cannon-ammo-mixed';
  mixedHint.textContent = 'mixed';
  mixedHint.style.display = 'none';
  el.appendChild(mixedHint);

  let lastActive = -2;     // -1 = mixed, 0/1/2 = ammo idx, -2 = panel hidden
  return {
    update(world, sel) {
      // Find selected cannons.
      const e = world.entities;
      let ammoSeen = -1;
      let mixed = false;
      let anyCannon = false;
      for (const id of sel.ids) {
        if (e.alive[id] !== 1) continue;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        if (kind.category !== 'artillery') continue;
        anyCannon = true;
        const a = e.cannonAmmo[id]!;
        if (ammoSeen === -1) ammoSeen = a;
        else if (ammoSeen !== a) { mixed = true; break; }
      }

      if (!anyCannon) {
        if (lastActive !== -2) {
          el.style.display = 'none';
          lastActive = -2;
        }
        return;
      }

      const active = mixed ? -1 : ammoSeen;
      if (active === lastActive) return;
      lastActive = active;

      el.style.display = '';
      for (let i = 0; i < 3; i++) {
        slots[i]!.classList.toggle('active', i === active);
      }
      mixedHint.style.display = mixed ? '' : 'none';
    },
  };
}
