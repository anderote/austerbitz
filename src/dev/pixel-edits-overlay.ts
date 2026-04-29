/**
 * In-memory mirror of `public/components/pixel-edits.json`. Keyed
 * `[kit][pose][facing][componentId]` → array of `{ x, y, color }` (color is a
 * hex string or the literal `"clear"` for transparent).
 */
export type PixelEdit = { x: number; y: number; color: string };
export type PixelEditsTree = Record<
  string,
  Record<string, Record<string, Record<string, PixelEdit[]>>>
>;

const PIXEL_EDITS_URL = '/components/pixel-edits.json';
const SAVE_URL = '/api/pixel-edits';

export async function loadPixelEdits(): Promise<PixelEditsTree> {
  try {
    const res = await fetch(PIXEL_EDITS_URL);
    if (!res.ok) return {};
    return (await res.json()) as PixelEditsTree;
  } catch {
    return {};
  }
}

export function lookupEdits(
  tree: PixelEditsTree,
  kit: string,
  pose: string,
  facing: string,
  componentId: string,
): readonly PixelEdit[] {
  return tree[kit]?.[pose]?.[facing]?.[componentId] ?? [];
}

/**
 * Apply edits onto an in-context 2D canvas at native pixel coords. Brush
 * pixels write `color`; `"clear"` writes a transparent pixel via clearRect(1,1).
 */
export function applyEditsToContext(
  ctx: CanvasRenderingContext2D,
  edits: readonly PixelEdit[],
): void {
  for (const e of edits) {
    if (e.color === 'clear') {
      ctx.clearRect(e.x, e.y, 1, 1);
    } else {
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x, e.y, 1, 1);
    }
  }
}

/**
 * Mutate the tree to set a single pixel. Replaces any prior entry at the
 * same `(x, y)` for the same `(kit, pose, facing, componentId)`. Returns the
 * updated tree (same object).
 */
export function setPixel(
  tree: PixelEditsTree,
  kit: string,
  pose: string,
  facing: string,
  componentId: string,
  edit: PixelEdit,
): PixelEditsTree {
  const path = ((((tree[kit] ??= {})[pose] ??= {})[facing] ??= {})[componentId] ??= []);
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i]!.x === edit.x && path[i]!.y === edit.y) path.splice(i, 1);
  }
  path.push(edit);
  return tree;
}

export async function savePixelEdits(tree: PixelEditsTree): Promise<void> {
  const res = await fetch(SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tree, null, 2),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) detail = data.error;
    } catch {
      // ignore
    }
    throw new Error(`pixel-edits save failed (${res.status}): ${detail}`);
  }
}
