# Unified Unit Controls Panel — Design

## Problem

The per-selection HUD is fragmented and inconsistent across unit types:

- `formation-controls-panel` (bottom-left, text rows) shows `[ ]` Spacing / `, .` Ranks / `ZXCV` Stance for **any** selection.
- `cannon-ammo-panel` (bottom-center, pixel-art slots) shows Z/X/C ammo for **artillery** selections.
- `selection-panel` (bottom-left) shows a one-line selection summary plus a single-unit identity card.
- Cavalry has no unit-specific UI at all.

The Z/X/C/V keys are overloaded: when artillery is selected, they switch ammo, not stance. The formation panel lies about this — it still labels `ZXCV` "Stance" while cannons are selected. Most of the keyboard hotkeys players actually need (R = attack-move, F = hurry, T = walk/run toggle, Del = stop, Space = fire, arrow keys = aim/elevate, Esc = deselect) are not displayed anywhere in the HUD.

The skirmish scenario also doesn't mount `cannon-ammo-panel` despite player-controlled cannons, which is a latent bug the unification will fix.

## Goal

A single per-selection control panel — `unit-controls-panel` — that:

1. Always lives in the same place on screen so the player's eye lands consistently.
2. Adapts contents to the current selection: shows the relevant unit-specific actions (stance for infantry, ammo for artillery, none for cavalry) plus the formation/universal keyboard hotkeys.
3. Replaces `formation-controls-panel`, `cannon-ammo-panel`, and absorbs the selection-summary line currently in `selection-panel`.
4. Surfaces the keyboard hotkeys that today are invisible: R, F, T, Del, Esc, and (artillery-only) Space + arrow keys.

The panel is a read-only display (no clickable slots), matching `cannon-ammo-panel`'s current `pointer-events: none` style. The single-unit identity card stays in `selection-panel`; the new panel is purely about *controls*, not unit identity.

## Layout

Position: bottom-left, at the current `formation-controls-panel` location (`bottom: 8px; left: 196px`). Vertical flex column with a small gap between sections. Width is content-driven.

The panel renders these sections, top to bottom, each shown conditionally:

### 1. Selection summary (always when selection ≠ empty)

A single line aggregating selected entities by unit kind, e.g. `British Line Infantry × 24  ·  12-Pounder Cannon × 2`. Identical to today's `selection-summary` text. This replaces the summary half of `selection-panel`.

### 2. Unit-specific section (one per unit category present in the selection)

For each category that has at least one alive selected entity, render the corresponding strip. Stacked vertically when multiple categories are selected (e.g. infantry + cannons).

**Infantry — Stance strip.** Four pixel-art slots: Fire at Will (Z), Volley (X), By Ranks (C), Hold (V). Active slot highlighted via `.unit-slot.active`. "Mixed" indicator (`.unit-slot-mixed`) beside the strip when selected infantry have differing stances. Uses the same `StanceSummary` type currently computed inline in `skirmish/main.ts` (lift it to a shared utility — see Components below).

Pixel-art icons for the four stances are simple symbolic 16×16 glyphs in the same `Pixel[]` format as the existing ammo icons. Suggested motifs: a single muzzle puff (Fire at Will), three aligned puffs in a row (Volley), a stacked rank pattern with one row puffing (By Ranks), a raised hand / halt symbol (Hold). Exact pixel patterns are an implementation detail — the contract is "16×16 pixel-art glyph that reads at 32×32 display size."

**Artillery — Ammo strip.** Three pixel-art slots: Solid (Z), Shell (X), Canister (C). Re-uses the existing pixel definitions — `SOLID_PIXELS`, `SHELL_PIXELS`, `CANISTER_PIXELS`, plus the `Pixel` type and `pixelsToSvg` helper — moved verbatim from `cannon-ammo-panel.ts` into the new panel module. "Mixed" indicator when selected cannons have differing ammo.

**Cavalry — no section.** Cavalry contributes nothing to this section per Q2 in brainstorming.

### 3. Formation row (always when selection ≠ empty)

Two text rows in `fc-row` format (key badge + label + value), reusing the existing `formation-controls.fc-row` styles:

- `[ ]` Spacing — `1.00× Default` etc, from `SPACING_STEPS[params.spacingIndex]`.
- `, .` Ranks — `auto` or the integer override.

These apply to any unit type so the row is unconditional on category.

### 4. Universal keyboard hotkeys (always when selection ≠ empty)

A compact key reference, same `fc-row` text format. Static rows (always shown):

- `R` Attack-move
- `F` Hurry to slot
- `T` Walk / Run *(value reflects current `runMode` — "Walk" or "Run")*
- `Del` Stop
- `Esc` Deselect

Artillery-only rows (shown only when at least one cannon is selected):

- `Space` Fire
- `← →` Rotate
- `↑ ↓` Elevate

Mouse gestures (RMB move, RMB drag formation, Ctrl+RMB march, Shift queue, double-click recall, control-group digits) are deliberately out of scope — they're discoverable through play and have other visual feedback (drag rectangles, formation preview, group badges). Adding them would balloon the panel without serving discoverability of *keyboard* hotkeys.

## Components and data flow

New file: `src/ui/unit-controls-panel.ts` exporting `createUnitControlsPanel(root)` returning `{ update(world, sel, params, stance, runMode) }`.

Inputs the panel needs each frame:

- `World` — to walk `selection.ids`, read `entities.alive`, `entities.kindId`, `entities.cannonAmmo`.
- `Selection` — already passed to current panels.
- `FormationParams` — for spacing/ranks, from `controller.formationParams`.
- `StanceSummary` — for the active-stance highlight; the helper currently lives inline in `skirmish/main.ts` and gets lifted to `src/input/stance-summary.ts` so all scenarios share it.
- `runMode: boolean` — already exposed on the controller as `controller.runMode`.

The panel keeps a few cached fields (`lastSummary`, `lastSpacing`, `lastRanks`, `lastStanceActive`, `lastAmmoActive`, `lastRunMode`) and only writes DOM when the relevant input changes — same pattern used by all current panels. Panel is hidden via `el.style.display = 'none'` when `selection.ids.size === 0`.

Files removed:

- `src/ui/formation-controls-panel.ts` (and its CSS block in `styles.css`).
- `src/ui/cannon-ammo-panel.ts` (and its CSS block in `styles.css`).
- The summary section and `lastSummary`/`summaryEl` from `src/ui/selection-panel.ts`. The single-unit identity sub-section stays — that file becomes the "selection identity" panel only.

The `StanceSummary` type and `computeStanceSummary` helper move from `src/skirmish/main.ts` to `src/input/stance-summary.ts`.

CSS: a new `.unit-controls` block in `styles.css`. Pixel-slot styles (`unit-slot`, `unit-slot.active`, `unit-slot-icon`, `unit-slot-name`, `unit-slot-key`, `unit-slot-mixed`) supplant the deleted `cannon-ammo-*` rules. Text-row styles (`uc-row`, `uc-key`, `uc-label`, `uc-val`) supplant the deleted `formation-controls .fc-*` rules.

Wiring touches three scenario entry points:

- `src/main.ts` — replaces `createCannonAmmoPanel` + `createFormationControlsPanel` (and the summary-update call) with `createUnitControlsPanel`.
- `src/skirmish/main.ts` — replaces `createFormationControlsPanel` with `createUnitControlsPanel` (gains the artillery section automatically — fixes the latent missing-cannon-ammo bug).
- `src/cannon-test/main.ts` — replaces `createCannonAmmoPanel` with `createUnitControlsPanel`.

## Mixed-selection behavior

When the selection contains entities from multiple unit categories (e.g. infantry + cannons), the panel stacks the relevant unit-specific sections in category order: infantry → cavalry → artillery. Each section computes its mixed/active state across only the entities of its own category. The formation and universal sections are unaffected.

The Z/X/C key-routing in the controller is unchanged: when any artillery is in the selection, those keys go to ammo; otherwise they go to stance. The panel reflects this honestly — when both an infantry stance strip and an artillery ammo strip are visible, both display their state, but only one is responsive to ZXC at a time. We accept this as documentation, not as a bug to fix in this work; rebinding the keys is out of scope.

## Testing

A focused unit test in `src/ui/unit-controls-panel.test.ts` exercising the selection cases:

- Empty selection — panel hidden.
- All infantry — stance strip visible, ammo strip absent.
- All cannons — ammo strip visible, stance strip absent.
- All cavalry — neither strip visible; formation + universal sections still visible.
- Mixed (infantry + cannons) — both strips visible.
- Mixed stance among infantry — "mixed" indicator visible on the stance strip.
- Mixed ammo among cannons — "mixed" indicator visible on the ammo strip.
- `runMode` flip — T-row value updates from "Walk" to "Run".
- Spacing/ranks change → row values update.
- Cannon-only universal rows (Space, arrows) appear iff at least one cannon selected.

Tests use a minimal `World`/`Selection` fixture matching the pattern used by other UI tests in the codebase.

## Out of scope

- Any change to the keyboard or mouse bindings themselves; the panel describes existing controls.
- Cavalry-specific actions (charge, wedge, etc.) — punted per Q2.
- Clickable / pointer-driven controls (panel stays read-only).
- Mouse-gesture documentation in the panel (RMB rules, drag rules, control-group digits).
- `control-groups-panel` — separate concern, stays untouched.
- Single-unit identity card in `selection-panel` — stays as-is.
