# Plan: 3-Slot Regiment Palette System

Spec: `docs/superpowers/specs/regiment-palette.md`

## Phase 1 — Data + shader plumbing (parallelizable internally, but must land first)

### 1a. `public/regiments.json`
Create file with the five regiments from the spec table. Order matters: index 0 = English.

### 1b. Shader: 3-slot family detection
- `src/render/shaders/sprite.glsl.ts`:
  - Add `layout(location = 8) in vec3 a_tertiary;` and `out/in vec3 v_tertiary;` plumbing.
  - Replace the existing 2-line magenta/cyan replacement with a 3-family classifier:
    ```glsl
    vec3 c = col.rgb;
    float maxC = max(c.r, max(c.g, c.b));
    if (maxC > 0.05) {
      // Magenta: g near 0, r and b both elevated
      bool mag = c.g < 0.2 * maxC && c.r > 0.2 && c.b > 0.2;
      // Cyan: r near 0
      bool cyn = c.r < 0.2 * maxC && c.g > 0.2 && c.b > 0.2;
      // Yellow: b near 0
      bool yel = c.b < 0.2 * maxC && c.r > 0.2 && c.g > 0.2;
      if (mag) {
        float f = (c.r + c.b) * 0.5;          // 1.0 for mid, ~0.31 deep, ~0.75 hi base
        col = clamp(v_primary * f * 1.0, 0.0, 1.0);
        // Off-hue (g channel) adds white tint for highlight rows
        col = mix(col, vec3(1.0), c.g * 0.5);
      } else if (cyn) {
        float f = (c.g + c.b) * 0.5;
        col = clamp(v_secondary * f, 0.0, 1.0);
        col = mix(col, vec3(1.0), c.r * 0.5);
      } else if (yel) {
        float f = (c.r + c.g) * 0.5;
        col = clamp(v_tertiary * f, 0.0, 1.0);
        col = mix(col, vec3(1.0), c.b * 0.5);
      }
    }
    ```
  - Keep the existing pattern logic for cavalry/artillery; route those branches to use `v_primary`/`v_secondary` consistently with current behavior.

### 1c. Sprite-pass: tertiary buffer + regiment loader
- `src/render/passes/sprite-pass.ts`:
  - Add `tertiary: [number, number, number]` to `FactionPalette`.
  - Replace hardcoded `TEAM_COLORS` with a mutable `let regiments: FactionPalette[] = DEFAULTS` and an async loader that fetches `/regiments.json` on init, normalizes, and replaces the array. Export a getter for use elsewhere (editor).
  - Add `tertiaryBuf` (location 8). Allocate `capacity * 3 * 4` bytes. Wire `vertexAttribDivisor`.
  - In the per-instance fill loop (~line 189), populate `scratchTertiary` analogously to primary/secondary.
  - In the draw call, `bufferSubData` it before the draw.

**Dependencies:** none. Can be a single subagent task.

## Phase 2 — Asset conversion (depends on Phase 1 only for visual verification)

### 2a. Procedural in-game sprite
- `src/render/british-soldier-sprite.ts`:
  - Locate the character-cell parsing (`P`, `S` tokens, ~line 42-45). Add `T` token mapped to `(255, 255, 0)` flat tertiary.
  - Repaint:
    - Shako region → `T`
    - Gaiters/boots region → `T`
    - Cross-belts → `S`
    - Trousers → `S`
    - Coat stays `P`
  - Verify 8 directions and all poses (idle, fire, hit, dying) updated consistently.

### 2b. Chibi components
- `scripts/redraw-components.mjs`:
  - Replace `PAL.coatMid/Hi/Shade/Deep` literals with magenta family markers (mid/hi/shade/deep).
  - Replace `PAL.beltWhite/beltShade` with cyan-family markers (mid/shade).
  - Replace `PAL.trouserMid/Hi/Shade` with cyan-family markers (mid/hi/shade).
  - Replace `PAL.shakoMid/Hi/Shade` with yellow-family markers.
  - Replace `PAL.gaiterBlack/gaiterHi` with yellow-family markers (deep/shade).
  - Re-run script: `node scripts/redraw-components.mjs` — regenerates all PNGs in `public/sprites/components/`.
  - Sanity-check that brass/skin/wood/steel/plumeRed/plumeTip stay literal.

### 2c. Composite preview atlas
- `scripts/build-soldier-components.mjs`:
  - After loading component PNGs, run a JS-side recolor pass against the **English** palette before stitching into the combined atlases.
  - Use the same family-classifier + brightness-factor logic as the spec defines for the shader.
  - Re-run script: `node scripts/build-soldier-components.mjs`.
  - Updates `public/sprites/british-line-infantry*.png` to look like properly colored British soldiers.

**Dependencies:** Phase 1 must be done so the in-game shader can recolor 2a's output.

These three sub-tasks are independent of each other and can run in parallel as separate subagents.

## Phase 3 — Editor + gallery UI (depends on Phase 2c so previews already work)

### 3a. Shared regiments loader
- New file `src/dev/regiments.ts`:
  - `export async function loadRegiments(): Promise<Regiment[]>` — fetches `/regiments.json`.
  - `export function recolorImageData(src: ImageData, palette: Regiment): ImageData` — implements the family-classifier in pure JS, returns a new ImageData.
  - Export `Regiment` type.

### 3b. Editor regiment picker + recolor
- `public/components-editor.html`:
  - Add `<select id="regiment-select">` next to the kit selector.
  - Populate from `loadRegiments()` on init.
  - On change: bump `editVersion` and `redraw()`.
  - In the painter palette, prepend three slot swatches (Primary/Secondary/Tertiary) whose displayed background is the active regiment's slot color but whose `dataset.colorHex` is the family's **mid** marker (e.g. `#FF00FF`).
  - When a slot swatch is clicked, `state.activeColor` becomes the marker hex; existing paint logic writes that pixel.
  - Update `state.activeColor` swatch UI when regiment changes (re-tint the slot swatches).

### 3c. Component-preview recolor pass
- `src/dev/component-preview.ts`:
  - Wherever a layer image is composited via `drawImage`, first recolor through an offscreen canvas using `recolorImageData` with the current regiment.
  - Cache by `(layer.path, regimentId, pixelEditVersion)` keyed in `Map<string, HTMLCanvasElement>`.

### 3d. Gallery regiment picker
- `public/components-gallery.html`:
  - Same dropdown.
  - Forwards regiment selection into the same component-preview rendering path (3c handles the recolor).

**Dependencies:** Phase 3a feeds 3b/3c/3d. Within phase 3, 3b/3c/3d can run in parallel after 3a.

## Phase 4 — Verification

- `npm run dev` (or whatever the project's dev command is — check `package.json`).
- Open `/components-editor.html`, switch regiments, confirm coat/belts/pants/shako/boots all swap.
- Open `/components-gallery.html`, switch regiments, confirm grid updates.
- Open the main game (`/` or `/index.html`), confirm British (team 0) and French (team 1) units render with their palettes.
- Set a few entities to team 2/3/4 (or temporarily change a unit's team in world state) and verify Prussian/Russian/Austrian colors render.
- `npm run typecheck` and `npm test` if defined.

## Subagent Dispatch Strategy

- **Subagent A (Phase 1)**: data file + shader + sprite-pass. Single coherent change, one subagent.
- **Subagent B (Phase 2a)**: procedural british-soldier-sprite conversion.
- **Subagent C (Phase 2b)**: chibi components conversion + script rerun.
- **Subagent D (Phase 2c)**: composite atlas builder update + script rerun.
- B/C/D run in parallel after A.
- **Subagent E (Phase 3a + 3c)**: shared regiments loader + component-preview recolor (these share types).
- **Subagent F (Phase 3b)**: editor UI.
- **Subagent G (Phase 3d)**: gallery UI.
- F/G run in parallel after E.
- Phase 4 verification done in main thread.
