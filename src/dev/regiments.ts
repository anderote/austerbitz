export interface Regiment {
  id: string;
  label: string;
  primary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
}

const FALLBACK_REGIMENTS: Regiment[] = [
  { id: 'british-line', label: 'British Line', primary: [180, 40, 50], secondary: [240, 230, 210], tertiary: [25, 20, 35] },
];

export async function loadRegiments(url = '/regiments.json'): Promise<Regiment[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('regiments.json: expected array');
    return data.map((r) => ({
      id: String(r.id),
      label: String(r.label),
      primary: [r.primary[0], r.primary[1], r.primary[2]],
      secondary: [r.secondary[0], r.secondary[1], r.secondary[2]],
      tertiary: [r.tertiary[0], r.tertiary[1], r.tertiary[2]],
    }));
  } catch (err) {
    console.warn('[regiments] load failed, using fallback:', err);
    return FALLBACK_REGIMENTS;
  }
}

/** Recolor marker pixels in-place. Mirrors sprite.glsl.ts so on-disk and live previews match. */
export function recolorImageData(img: ImageData, reg: Regiment): void {
  const d = img.data;
  const eps = 0.01;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const isMag = Math.abs(r - b) < eps && g < r - eps && r > 0.1;
    const isCyn = Math.abs(g - b) < eps && r < g - eps && g > 0.1;
    const isYel = Math.abs(r - g) < eps && b < r - eps && r > 0.1;
    let slot: [number, number, number] | null = null, factor = 0, off = 0;
    if (isMag) { slot = reg.primary; factor = r; off = g; }
    else if (isCyn) { slot = reg.secondary; factor = g; off = r; }
    else if (isYel) { slot = reg.tertiary; factor = r; off = b; }
    if (!slot) continue;
    let oR = Math.min(255, slot[0] * factor);
    let oG = Math.min(255, slot[1] * factor);
    let oB = Math.min(255, slot[2] * factor);
    const lift = off * 0.5;
    oR = oR * (1 - lift) + 255 * lift;
    oG = oG * (1 - lift) + 255 * lift;
    oB = oB * (1 - lift) + 255 * lift;
    d[i] = Math.round(oR);
    d[i + 1] = Math.round(oG);
    d[i + 2] = Math.round(oB);
  }
}
