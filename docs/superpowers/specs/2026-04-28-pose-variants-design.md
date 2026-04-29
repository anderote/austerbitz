# Pose Variants + Layer Paint — design

## Goal

Two related but independent changes to `components.html`:

1. **Variants** — rename and resurface the existing per-`(pose, facing)` `weapons[]` array as `variants[]`, and rebuild the editor layout around browsing a unit's poses and authoring weapon-orientation variants per pose-facing.
2. **Layer paint** — a toggleable paint mode that lets the user click pixels on the composited preview to fix up the underlying source component PNGs (body, helmet, etc.). Edits flow through the existing `public/components/pixel-edits.json` file and `/api/pixel-edits` endpoint.

Variants are **only** a pose + a weapon orientation. No layer overrides, no per-layer offsets, no per-variant paint. Anything that changes the weapon's apparent position (sub-pixel shift, rotation, mirror) lives inside the `WeaponOrientation` already.

## Non-goals

- No per-variant pixel paint, layer offsets, or layer overrides. Variants vary the weapon, nothing else.
- No build-pipeline changes for variants. Variants composite at sprite-pass time as today.
- No new paint storage. Layer paint reuses `public/components/pixel-edits.json` (kit / pose / facing / componentId → `[{x, y, color}]`).
- No undo / redo, drag-paint shape tools, fills, or selection. Click-paint and click-erase only.
- No new weapon source PNGs added through the editor.
- No editor-driven changes to `public/components/index.json` (component registry).

## Data model

### Variants — naming

Per `(pose, facing)`:

```ts
interface PoseFacingEntry {
  layers: string[] | string[][];
  weapons?: WeaponOrientation[];   // [primary, ...alternates]
}
```

The on-disk field stays `weapons[]` and the runtime types are unchanged. The editor UI surfaces each entry as a **Variant** in the bottom strip, but the underlying JSON / TypeScript names remain `weapons[]` / `WeaponOrientation`.

**Why no rename:** `src/render/poses/atlas.ts` already exposes a different concept under that name — `atlas.variantCells` and `pickPoseVariantUv` handle **detachable-part variants** (`walking--no-head` and friends). Reusing "variants" for weapon-orientation alternates would collide with that established naming and confuse readers of the runtime. The user-facing label and the in-code label are decoupled here on purpose.

No data migration is needed; runtime, atlas, sprite-pass, and resolver are untouched.

### Layer paint — storage

Existing file: `public/components/pixel-edits.json`. Shape:

```json
{
  "<kitId>": {
    "<pose>": {
      "<facing>": {
        "<componentId>": [
          { "x": 12, "y": 4, "color": "#E8ECF2" },
          { "x": 12, "y": 5, "color": "clear" }
        ]
      }
    }
  }
}
```

- `componentId` matches the layer id used in kit JSONs (e.g. `rider-torso-south`).
- `color` is a hex string or the literal `"clear"` for transparent.
- Coordinates are in the **component PNG's own pixel space**. Components draw at `(0, 0)` of the cell canvas, so canvas pixel `(x, y)` maps directly to component pixel `(x, y)` for kits whose components are uniformly sized to the cell. The editor uses the canvas-to-pixel mapping for click-to-paint.

The endpoint `POST /api/pixel-edits` already exists in `vite.config.ts` and writes the body to that file. The editor's Save Edits button reuses it.

## Editor layout

```
┌──────────────────────────────┬─────────────────────────────────────────────────────┐
│  UNIT (S-facing thumb ~96px) │  POSES — horizontal scroll strip                    │
│  click → unit picker popover │  [idle][walk][run][make-ready][present][fire]…     │
│                              │  each = S-facing thumb + label, click sets pose     │
├──────────────────────────────┴─────────────────────────────────────────────────────┤
│                                                                                     │
│                       MAIN POSE PREVIEW — 3×3 facing grid                           │
│                       (renders selected variant; click cell to set facing)          │
│                                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  VARIANTS — wide horizontal strip for current (pose, facing)                        │
│  [v0 thumb][v1 thumb][v2 thumb]…   [+ new]                                          │
│  click variant → loads it into the weapon edit strip below                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  WEAPON EDIT STRIP (existing) — source-grid + mirror/rotate/nudge/save              │
│  PAINT TOOLBAR (new, when paint mode is on) — brush/erase/color/active layer        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

A small "⚙ Advanced" drawer (collapsible, off by default) holds: regiment selector, skeleton overlay, raw layer checkboxes, the original facing dropdown, and the Reset-to-Kit button. These exist today and remain functional but stop dominating the layout.

### Top row — unit picker + pose strip

- **Unit thumbnail** (left): renders the active kit's S-facing using the same render pipeline as the main grid, scaled to ~96px. Click opens a popover with one S-facing thumbnail per kit (from `KIT_INDEX_URL`). Click a thumbnail → switches active kit and closes popover.
- **Pose strip** (right of thumbnail): horizontal-scrolling row of cells, one per pose name in the kit's `poses` map (or the static fallback list `idle, walking, running, make-ready, present, fire, hit, dying` if the kit has no poses authored). Each cell renders that pose's S-facing thumbnail + label. Active pose has a colored ring. Click → sets `currentPose`.

Both top-row sub-renders reuse the same `renderCenterCell` flow, just into smaller canvases.

### Middle — main 3×3 facing grid

Existing 3×3 grid stays. Each cell renders the current `(kit, pose, facing)` with the **active variant's** weapon overlay (defaults to `variants[0]`). Click a cell → sets `currentFacing` and rebuilds the variants strip for the new `(pose, facing)`. Variant indicator badge in the cell's bottom-right shows count when ≥ 2 (existing behavior).

### Bottom — variants strip + editor

**Variants strip**: horizontal row of small cells, one per entry in `kit.poses[currentPose][currentFacing].variants`. Each cell renders the full pose-facing preview at ~64px with that variant's weapon. Active variant has a colored ring. Right-click (or hover-shown × button) deletes that variant.

`[+ new]` cell at the end: appends a new variant initialized with `{ src: currentFacing, x: 0, y: 0, rot: 0 }` and selects it.

**Weapon edit strip**: the existing weapon source-grid + mirror/rotate/save panel, repurposed to bind to the *currently selected variant* instead of the prior "working orientation" concept. Editing the variant updates `kit.poses[pose][facing].variants[selectedIdx]` in memory live. Save Kit writes to disk via `/api/save-kit`.

The pre-existing "target cell" / "working orientation" two-step is replaced by direct binding: select a variant cell → its values populate the edit strip → tweak → optionally Save Kit. Saving the kit now persists everything; "Save Variant" goes away because there's no separate working state.

### Paint mode

A toggle button (e.g. labeled `🖌 Paint`) somewhere in the toolbar. When **on**:

- The main 3×3 grid stops responding to clicks-as-cell-select. The active center cell (the one currently in `currentFacing`) becomes the paint surface; click on it writes one pixel.
- A **paint toolbar** appears below the main grid (above the variants strip, or alongside the weapon edit strip — see Layout open question below):
  - **Brush / Erase** toggle.
  - **Color swatch** with a color picker (defaults to the current regiment's primary palette colors as quick-access swatches; full hex picker as fallback).
  - **Active layer dropdown**: lists the layer ids contributing to the current `(pose, facing)`'s composited cell, in z-order. The user picks which layer's `pixel-edits.json` entry receives the click.
- A click at canvas pixel `(x, y)` on the active center cell writes one entry into `pixelEdits[currentKit][currentPose][currentFacing][activeLayer]`:
  - Brush mode: `{ x, y, color: <swatch> }`.
  - Erase mode: `{ x, y, color: "clear" }`.
  - Replaces any existing entry at the same `(x, y)` for that layer.
- The center cell re-renders immediately to show the new pixel — the paint overlay is applied at draw time on top of the layer's PNG so the user sees the result without a build step.
- A **Save Edits** button POSTs the in-memory pixel-edits tree to `/api/pixel-edits`.

When paint mode is **off**: clicks revert to cell-select behavior. The pixel-edits overlay continues to render so the saved edits remain visible.

### Live overlay of pixel-edits

Whether paint mode is on or off, the editor applies `pixel-edits.json` overlays at render time so what you see in the preview matches the build output. Implementation:

- On startup, `GET /components/pixel-edits.json` (served as a static asset).
- `paintLayersInto`'s drawing loop, for each layer, after drawing the source PNG, looks up `pixelEdits[kit][pose][facing][layerId]` and writes each pixel onto the cell canvas (uses the same coordinate convention as the build's `applyEdits`).
- In-memory updates from paint clicks mutate the same tree → instant feedback.

This is editor-only behavior; the build-time application of `pixel-edits.json` (in `scripts/build-soldier-components.mjs`) is unchanged.

## Files touched

| Path | Change |
|---|---|
| `components.html` | Layout rework: top row (unit picker + pose strip), middle (existing 3×3), bottom (variants strip + edit strip + paint toolbar), Advanced drawer. |
| `src/dev/component-preview.ts` | Refactor: replace target/working state with selected-variant state; wire unit picker, pose strip, variants strip; add paint mode + live pixel-edits overlay. |
| `src/dev/paint-tool.ts` | **New** — paint state, click→pixel logic, brush/erase, swatch state. |
| `src/dev/pixel-edits-overlay.ts` | **New** — load + apply pixel-edits at render time; in-memory mutation API. |
| `src/dev/unit-picker.ts` | **New** — popover with kit S-thumbnails. |
| `src/dev/pose-strip.ts` | **New** — horizontal scroll strip with pose S-thumbnails. |
| `src/dev/variants-strip.ts` | **New** — horizontal strip of variant thumbnails for current (pose, facing). |

## Phasing

The implementation plan splits into two phases, each independently shippable:

**Phase A — layout rework.**
- New layout (unit picker, pose strip, variants strip, Advanced drawer).
- Variants strip wired to the existing weapon edit strip via direct binding to the selected `weapons[selectedIdx]` entry.
- No paint, no live pixel-edits overlay yet.

**Phase B — paint mode + live overlay.**
- Live pixel-edits overlay at render time (no behavior change to existing edits, just makes them visible in the editor).
- Paint mode toggle, paint toolbar, click-to-paint into pixel-edits.json tree.
- Save Edits button → existing `/api/pixel-edits`.
- Active-layer dropdown derived from current cell's layer set.

Phase A keeps all current visuals and behaviors intact aside from the layout swap. Phase B layers paint on top.

## Risks

- **Component pixel-size assumption.** Click-to-paint assumes layer PNG `(x, y)` == cell canvas `(x, y)`. True for current kits (all components in a kit share the cell size and draw at `0, 0`). If a future kit introduces a layer with a different size or non-zero offset, paint coordinates will be wrong for that layer. Mitigation: assert in `paint-tool.ts` that the active layer's image dimensions match the cell, warn-and-skip otherwise. Out-of-scope: per-layer pivot/anchor support in the editor.
- **Variant strip render cost.** Each variant cell re-renders the full pose composite. With ~5 variants and 8 facings (the variant strip only shows current facing's variants, so 5 thumbs at most), this is small. No issue.
- **Live overlay drift.** If the user paints with the editor's overlay rendering one way and the build's `applyEdits` renders another way, edits will look different in-game. Mitigation: the editor overlay copies the build's pixel application convention exactly (port the same `{x, y, color}` write loop).

## Open questions left to the implementer (small, reversible)

- Paint toolbar placement: alongside the weapon edit strip, below it, or replacing it when paint mode is on. Pick whichever feels best at implementation time.
- Pose strip horizontal vs. vertical wrap: horizontal scroll is the spec, but if the pose count stays small, a static row (no scroll) is fine.
- Active-layer dropdown: a `<select>` is fine; a small clickable list is fine. Either.
- Paint swatch UI: a row of 6–8 regiment palette colors plus a fallback `<input type="color">`. Detail.
