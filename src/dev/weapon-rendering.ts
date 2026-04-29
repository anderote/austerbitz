import { loadImage } from './image-cache';

export type WeaponTransform = 'flipX' | 'flipY' | 'rot180';

export interface WeaponOrientation {
  src: string;
  transform?: WeaponTransform;
  x: number;
  y: number;
  rot: number;
  flipX?: boolean;
}

/** Mirror of `facingToComponentSuffix` from `src/render/poses/atlas.ts`. */
function facingToSuffix(facing: string): string {
  switch (facing) {
    case 'N': return 'north';
    case 'NE': return 'northeast';
    case 'E': return 'east';
    case 'SE': return 'southeast';
    case 'S': return 'south';
    case 'SW': return 'southwest';
    case 'W': return 'west';
    case 'NW': return 'northwest';
    default: return facing.toLowerCase();
  }
}

export { facingToSuffix };

export async function paintWeaponInto(
  target: CanvasRenderingContext2D,
  weaponPath: string,
  orientation: WeaponOrientation,
  options: { applyOffset: boolean; bodyCenter?: [number, number] },
): Promise<void> {
  const img = await loadImage(weaponPath);

  if (!options.applyOffset) {
    target.drawImage(img, 0, 0);
    return;
  }

  const cx = options.bodyCenter?.[0] ?? target.canvas.width / 2;
  const cy = options.bodyCenter?.[1] ?? target.canvas.height / 2;

  // Mirrors runtime UV-flip + quad-rotate-around-center
  // (sprite-pass.ts weapon composition).
  target.save();
  target.translate(cx + orientation.x, cy + orientation.y);
  if (orientation.rot !== 0) {
    target.rotate((orientation.rot * Math.PI) / 180);
  }
  const t = orientation.transform;
  if (t === 'flipX') {
    target.scale(-1, 1);
  } else if (t === 'flipY') {
    target.scale(1, -1);
  } else if (t === 'rot180') {
    target.scale(-1, -1);
  }
  if (orientation.flipX) {
    target.scale(-1, 1);
  }
  target.drawImage(img, -img.width / 2, -img.height / 2);
  target.restore();
}
