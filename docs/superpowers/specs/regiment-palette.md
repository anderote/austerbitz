# 3-Slot Regiment Palette System

## Goal

Let units render in distinct national/regimental colors (English, French, Prussian, Russian, Austrian) without per-regiment art duplication. Sprite art is authored once with neutral marker colors; the renderer and editor recolor at draw time using a per-regiment palette.

## Scope

In scope:
- Three independent recolor slots in the renderer (primary / secondary / tertiary).
- Single `public/regiments.json` source of truth with five seed regiments.
- Editor + gallery dropdown to preview any regiment palette live.
- Procedural in-game british-soldier sprite + chibi component PNGs both converted to the marker scheme.

Out of scope:
- Migrating in-game line-infantry rendering off the procedural atlas onto the chibi component pipeline. Components remain a parallel authoring track for now; the shader becomes 3-slot-ready so the eventual switchover is data-only.
- Per-regiment unique sprites (e.g. distinct headgear shapes); the system only swaps colors.

## Slot Assignments

| Slot      | Visual element on the soldier                                    |
|-----------|------------------------------------------------------------------|
| Primary   | Coat (jacket body, sleeves, collar)                              |
| Secondary | Cross-belts/shoulder straps + trousers/breeches                  |
| Tertiary  | Boots/gaiters + shako/hat                                        |

Skin tones, brass fittings, wood (musket stock), steel (bayonet, musket fittings), plume tip white, and the plume body red stay **literal** — they don't recolor by regiment. (Plumes can be repainted per-regiment in the editor with literal hex if/when needed.)

## Marker Scheme

Each slot has a hue family in marker-color space. Asset PNGs are baked with marker pixels at four discrete brightness levels (deep / shade / mid / hi) so hand-shading is preserved. The shader detects the family by channel dominance and computes a per-pixel brightness factor relative to the family's "mid" reference, then outputs `slotColor × factor` (clamped).

| Slot      | Family hue | Deep            | Shade           | Mid             | Hi               |
|-----------|------------|-----------------|-----------------|-----------------|------------------|
| Primary   | Magenta    | `(80, 0, 80)`   | `(160, 0, 160)` | `(255, 0, 255)` | `(255, 128, 255)`|
| Secondary | Cyan       | `(0, 80, 80)`   | `(0, 160, 160)` | `(0, 255, 255)` | `(128, 255, 255)`|
| Tertiary  | Yellow     | `(80, 80, 0)`   | `(160, 160, 0)` | `(255, 255, 0)` | `(255, 255, 128)`|

Family-detection rules (atlas uses NEAREST so byte values come through exact):

A marker pixel always has its two **dominant channels equal** and the third (off) channel strictly lower. Literal art rarely produces that exact equality, so this is a reliable test.

- **Magenta family**: `r == b` AND `g < r` (with small epsilon for float comparison) → primary slot.
- **Cyan family**: `g == b` AND `r < g` → secondary slot.
- **Yellow family**: `r == g` AND `b < r` → tertiary slot.
- Otherwise: passthrough (literal pixel).

Brightness factor = the dominant channel value normalized to 0–1. Mid (`255`) → 1.0, shade (`160`) → 0.627, deep (`80`) → 0.314, hi (`255` with off=128) → 1.0. Final color = `clamp(slotColor * factor, 0, 1)`, then mixed toward white by `off * 0.5` for highlight tinting on hi rows.

## Regiment Data

`public/regiments.json` is a JSON array; each entry:

```json
{
  "id": "british-line",
  "label": "British Line",
  "primary":   [180, 40, 50],
  "secondary": [240, 230, 210],
  "tertiary":  [25, 20, 35]
}
```

RGB values are 0–255 integers. Order in the file is the team-index order (`entity.team[i]` indexes this array). Index 0 must remain English so existing world saves stay valid.

Seed entries:

| Index | Id            | Label         | Primary (coat)        | Secondary (belts/pants) | Tertiary (boots/shako) |
|-------|---------------|---------------|-----------------------|-------------------------|------------------------|
| 0     | british-line  | British Line  | `[180, 40, 50]` red   | `[240, 230, 210]` cream | `[25, 20, 35]` navy    |
| 1     | french-line   | French Line   | `[50, 60, 140]` blue  | `[240, 230, 210]` cream | `[25, 20, 35]` navy    |
| 2     | prussian-line | Prussian Line | `[35, 45, 75]` Pr.blue| `[240, 230, 210]` cream | `[15, 15, 20]` black   |
| 3     | russian-line  | Russian Line  | `[40, 75, 50]` green  | `[240, 230, 210]` cream | `[15, 15, 20]` black   |
| 4     | austrian-line | Austrian Line | `[225, 215, 195]` white| `[120, 105, 85]` tan   | `[15, 15, 20]` black   |

## Editor Integration

- `components-editor.html` and `components-gallery.html` get a `<select id="regiment-select">` in the header populated from `regiments.json`. Default = first regiment (British). Changing it re-renders all previews against the chosen palette.
- The editor's painter palette (`PAL` object in `components-editor.html`) gains three "slot" swatches at the top: **Primary**, **Secondary**, **Tertiary**. Painting with a slot swatch writes the family's **mid** marker pixel (`255,0,255` etc.). Shading variants are not exposed in the editor for v1 — painters can use the existing eyedropper / paint-bucket flow on the auto-baked components if they want to nudge specific shades. Existing literal swatches stay available for skin/brass/leather/etc.
- The slot swatches' visual fill is the **active regiment's** slot color, so the painter sees what they'll end up with — but the actual pixel written to the PNG is the marker.

## Recolor Pass for 2D Canvas Previews

`src/dev/component-preview.ts` composites layer PNGs via `drawImage` directly. Add a recolor stage before drawing: for each loaded `HTMLImageElement`, render it into an offscreen canvas, read pixels with `getImageData`, walk pixels, classify into family, apply slot color × shade factor, write back, cache the resulting canvas. Keyed by `(componentPath, regimentId)`. Invalidated when regiment changes or pixel-edits change.

## Procedural Sprite Update

`src/render/british-soldier-sprite.ts` currently bakes flat magenta/cyan markers from `P` / `S` cells. Extend with `T` (tertiary) cells. Repaint shako and gaiter regions with `T`, repaint cross-belts and trousers with `S`. Coat stays `P`. No multi-shade variants needed in the procedural path — flat markers suffice; the shader's brightness factor evaluates to ~1.0 for mid pixels.

## Composite Atlas Update

`scripts/build-soldier-components.mjs` regenerates per-pose preview atlases (`british-line-infantry-components-*.png`). For the static preview atlases used by the gallery, run the recolor pass against the **English** palette at bake time so the on-disk preview PNGs look like a British soldier when opened directly. Live previews in the gallery still recolor at runtime via the regiment picker.

## Risks / Notes

- The brightness-factor approach can wash out very dark regiment colors (deep markers may clip near zero). The slot colors in the seed regiments are chosen with this in mind — they're all bright enough that `× 0.31` (deepest shade) still produces a visible dark.
- Marker-family detection uses channel-dominance thresholds; if any literal art uses near-pure magenta/cyan/yellow, it'd get accidentally recolored. The current redraw script's `PAL` has no such colors — verified.
- `public/regiments.json` is fetched async at sprite-pass init. Need a synchronous fallback (hardcoded English default) for the first render frame before the fetch resolves.
