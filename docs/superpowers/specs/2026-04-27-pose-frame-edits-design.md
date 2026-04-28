# Pose-frame edits — design

## Goal

Let the existing `components-editor.html` browser tool paint pixel-level
edits onto auto-derived pose-tree PNGs (e.g., cuirassier mirrored
W/SW/NW frames, line-infantry seeded trouser walk/run frames). Edits are
stored uniquely per `(kind, pose, dir, clipIdx, frameIdx)` and applied at
build time so they survive auto-derive regenerations.

## Non-goals

- Replacing the existing component-level `pixel-edits.json` flow. That
  continues to apply edits to pre-composition components for line-infantry.
  The new pose-frame edits are an additional, post-derive layer.
- New painting infrastructure. The new mode reuses the editor's
  existing canvas, zoom, and tool palette.
- Sim or runtime changes. The pose-atlas runtime continues to read PNGs
  from `public/sprites/poses/<kind>/<pose>/<dir>/<clipIdx>/<frame>.png`.
  Edits flow through the existing build path, never the runtime.

## Storage

New file `public/sprites/poses/edits.json`:

```json
{
  "<kind>": {
    "<pose>": {
      "<dir>": {
        "<clipIdx>": {
          "<frameIdx>": [
            { "x": 5, "y": 10, "color": "#ff0000" },
            { "x": 6, "y": 10, "color": "clear" }
          ]
        }
      }
    }
  }
}
```

- Sparse: only frames with edits appear. Missing keys at any level mean
  "no edits."
- Edit shape mirrors `pixel-edits.json` — `{x, y, color}` with `"clear"`
  for transparent. Hex colors use the same convention.
- Coordinates are pixel offsets within the frame's cell. For cuirassier
  that's 32×24; for line-infantry it's 32×36; for cannon-12 it's 32×28.
  The `applyEdits` helper does no bounds checking beyond ignoring
  out-of-range pixels with a warning (never throws).
- File location chosen to be alongside `manifest.json` and the pose tree
  it edits. The build pipeline doesn't write to it; only the editor does.

## Build-time application

New module `scripts/lib/pose-frame-edits.mjs` exports:

```js
export async function loadEdits();        // returns parsed JSON or {}
export function lookupEdits(tree, kind, pose, dir, clipIdx, frameIdx);
export function applyEdits(rgba, cellW, cellH, edits);
```

- `loadEdits()`: reads `public/sprites/poses/edits.json`, returns `{}` if
  file is missing.
- `lookupEdits()`: walks the tree and returns the edit array (or empty
  array if no entry).
- `applyEdits(rgba, cellW, cellH, edits)`: in-place mutates the RGBA
  buffer — for each `{x, y, color}`, writes the hex color (or full
  transparency if `"clear"`) at `(x, y)`. Out-of-range coordinates emit
  a `console.warn` and are skipped.

Auto-derive scripts call `applyEdits()` after rendering their RGBA buffer
and before writing the PNG. New order in
`scripts/draw-cuirassier-poses.mjs`:

```
ASCII grid → renderFrame() → mirrorFrame() if needed → applyEdits() → write PNG
```

Same in `scripts/seed-line-infantry-locomotion.mjs`:

```
read base PNG → walk/run frame derivation → applyEdits() → write PNG
```

This means edits stack on top of the auto-derived base. Re-running the
auto-derive scripts re-applies the same edits — they survive regen by
construction.

For line-infantry, edits at the **frame level** flow through this new path.
Edits at the **component level** continue to flow through the existing
`pixel-edits.json` → builder path. If both edit the same pixel, frame-level
wins (it's applied last in the pipeline). The editor UI documents this
ordering.

## Editor UI

`components-editor.html` gains a tab toggle near the top:
- **Components** (existing) — edit pre-composition layer pixels via
  `pixel-edits.json`.
- **Pose Frames** (new) — edit post-derive frame pixels via `edits.json`.

In the Pose Frames tab:
1. **Kind selector** — populated from the manifest's `kinds` keys.
2. **Pose selector** — populated from the kind's `poses` keys (in the
   manifest).
3. **Direction selector** — N..NW; populated from the manifest's `dirs`
   for the selected pose.
4. **Clip index picker** — defaults to 0; for now, only clip 0 is
   authored anywhere, so this is a future-proofing input.
5. **Frame index picker** — slider/spinner from 0 to `frames.length-1`
   for the selected `(kind, pose, dir, clip)`.
6. **Canvas** — loads the selected frame's PNG, scaled to the editor's
   existing zoom levels. Click-paint and click-erase use the existing
   color and tool state.
7. **Edit count** — small badge showing how many edits exist for the
   selected frame.
8. **Save button** — POSTs the in-memory edits tree to a new endpoint
   `/api/pose-frame-edits`.
9. **Build button** — uses the existing `/api/build` endpoint, which is
   extended to also run cuirassier draw + locomotion seeder so that frame
   edits take effect.
10. **Clear edits for this frame** — a button that deletes the entry
    for the selected `(kind, pose, dir, clip, frame)` from the in-memory
    tree. Save still required to persist.

The Pose Frames tab does not touch any of the existing Components tab
state, and vice versa. They share the editor shell (zoom, color picker,
keyboard shortcuts) but maintain separate "active subject" state.

## Server endpoints

New middleware in `vite.config.ts`:

- `POST /api/pose-frame-edits` — body is the full `edits.json` tree.
  Writes `public/sprites/poses/edits.json` atomically. Mirrors the
  existing `/api/pixel-edits` handler.
- `POST /api/build` — extend the existing handler to also execute, in
  series after `build-soldier-components.mjs`:
  - `scripts/draw-cuirassier-poses.mjs`
  - `scripts/seed-line-infantry-locomotion.mjs` (only if its outputs are
    missing? — see Risks)
  - `scripts/build-pose-manifest.mjs`
  
  Or simpler: `/api/build` invokes `npm run build:poses` which already
  chains the components builder + pose manifest. We then add an extra
  `node scripts/draw-cuirassier-poses.mjs` step inline.

  Decided: invoke the steps directly via `execFile` in series, mirroring
  the current pattern. Specifically run, in order:
  1. `node scripts/build-soldier-components.mjs --kit line-infantry --scale 16`
  2. `node scripts/slice-component-atlas.mjs`
  3. `node scripts/draw-cuirassier-poses.mjs`
  4. `node scripts/build-pose-manifest.mjs`

  The locomotion seeder is **NOT** included in `/api/build` because it
  overwrites the trouser PNGs and any hand-edits at the *trouser
  component* level would survive (they're in `pixel-edits.json` applied
  by the components builder); but edits at the *frame level* (new flow)
  would also survive since the seeder calls `applyEdits()` and the JSON
  stays put. So including it is safe — but it's slow-ish and only useful
  when the seeding logic itself changed. Default off; user can run it
  manually with `npm run seed:line-infantry-locomotion` when needed.

## File structure

| Path | Change |
|---|---|
| `public/sprites/poses/edits.json` | **New (created on first save)** — tree of edits keyed by kind/pose/dir/clip/frame. |
| `scripts/lib/pose-frame-edits.mjs` | **New** — `loadEdits`, `lookupEdits`, `applyEdits`. |
| `scripts/lib/pose-frame-edits.d.mts` | **New** — TS declarations for the helper. |
| `src/sprite-gen/pose-frame-edits.test.ts` | **New** — vitest covering apply/lookup/clear. |
| `scripts/draw-cuirassier-poses.mjs` | **Modify** — call `applyEdits()` before writing each PNG. |
| `scripts/seed-line-infantry-locomotion.mjs` | **Modify** — same. |
| `vite.config.ts` | **Modify** — add `/api/pose-frame-edits` middleware; extend `/api/build` to run cuirassier draw + pose manifest. |
| `public/components-editor.html` | **Modify** — add Pose Frames tab + UI. |

## Tests

- Unit tests for the helper module:
  - `loadEdits()` returns `{}` if file missing.
  - `lookupEdits()` walks the tree correctly and returns `[]` for missing
    keys.
  - `applyEdits()` writes hex colors and `"clear"` correctly to RGBA
    buffer.
  - `applyEdits()` warns and skips out-of-bounds coords.
- Integration: dispatch a fixture-driven test that calls
  `applyEdits()` on a known buffer with known edits and asserts byte
  output.
- No editor-UI unit tests — same precedent as the existing
  `components-editor.html` (no tests today). Manual smoke test in the
  browser confirms paint → save → build → frame updated.

## Risks

- **Edits get stale if the auto-derive base changes shape.** If the
  cuirassier ASCII grid moves the helmet 2 px left, prior frame-edits
  at the original helmet location are wrong. Same risk as the existing
  `pixel-edits.json` system. Mitigation: spec the editor UI to show a
  small thumbnail diff (auto-derived vs. with-edits) so the user can
  spot drift quickly. Out of scope for the first cut.
- **Two editing surfaces for line-infantry.** Components-pixel-edits and
  frame-edits. Order is well-defined (frame wins). Documented in editor
  UI tooltip.
- **`/api/build` runtime.** Adding cuirassier draw + slicer + manifest
  makes builds a few seconds longer. Acceptable for an editor-driven
  workflow.

## Out-of-band follow-ups

- Per-frame thumbnail diff in the editor.
- Integrate with the lab's runtime via a hot-reload signal so the user
  doesn't need to reload after Build.
- Extend to cannon-12 if/when its sprite pipeline gets auto-derive logic.
