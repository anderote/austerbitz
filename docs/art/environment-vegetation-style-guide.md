# Environment Vegetation Pixel Style Guide

## Vision
- Deliver hand-authored grass and tree assets that feel tactile while matching the established chunky pixel aesthetic.
- Prioritize clarity at game-play zoom levels: silhouettes should read instantly, even when tiled or layered.
- Keep lighting consistent with the existing art bible (single 45° top-left light) for seamless integration.

## Palette & Lighting
- Lock palettes in advance: maintain a primary ramp of 4–6 swatches per material (grass, bark, foliage) and document the hex codes in `docs/art/palette-reference.md` (create if absent).
- Enforce a shared light logic: shadow, mid, and highlight values per material; avoid global black outlines, but add 1 px darker edges on shadow sides and pixel highlights along the lit rim.
- Reserve at least one neutral swatch for environmental blending (mud, snow) so seasonal variants stay on-model.

## Canvas & Grid
- Grass tiles default to `16×16` px; tree trunks use `32×48` px columns; tree canopies fit within `48×48` px.
- Keep every asset aligned to the master tile grid; no sub-pixel placement or semi-transparent antialiasing.
- Record anchor points (root pixel for trees, baseline for grass clusters) in a shared metadata sheet to avoid post-export nudging.

## Grass Asset Workflow
1. **Foundation Tile** – block in dominant mass using 2-tone ramp; carve negative space to suggest blades without stray single pixels.
2. **Transition Tile** – design edge tiles (top, bottom, left, right, corners) with matching horizon shading to hide seams.
3. **Accent Tufts** – create decorative overlays (flowers, rocks, dry patches) that can sit above the base tile without breaking repeatability.
4. **Seasonal Variants** – produce palette-swapped sheets (lush, worn, snow-poked) immediately after locking the base tile to ensure consistent density.

## Tree Asset Workflow
1. **Silhouette Pass** – sketch trunk gesture first, then stack canopy volumes; keep root width consistent across variants.
2. **Bark Shading** – apply 3-tone ramp with vertical striations every 2 px; add 1 px highlight ridge along the lit side.
3. **Foliage Clusters** – assemble leaf blobs from repeatable 5–7 px motifs; use dithered mid-tones inside to imply depth.
4. **Overlays & Seasons** – prepare modular layers (flowers, autumn leaves, snow caps) that sit on top of the base sprite without altering silhouette anchors.

## Documentation Templates
- **Palette Sheet** – table documenting swatch name, hex, intended material, and lighting role.
- **Asset Checklist** – per-sprite worksheet tracking tile size, anchor pixels, palette ID, and seasonal variants completed.
- **Process Notes** – quick log for brush settings, tool constraints (nearest-neighbor, 800–1200% zoom), and any experiment outcomes worth repeating.

## Digitizing & Export Pipeline
- Scan or capture drawings at 600 dpi, desaturate, and adjust levels once before pixel tracing.
- Rebuild sprites in the pixel editor using nearest-neighbor tools only; store working files as layered formats (`.ase`, `.psd`) with labeled groups.
- Export final tiles as lossless PNG; funnel them through `scripts/sprite-importer` to compile sprite sheets and verify alignment.

## QA Checklist (per asset)
- Verify readability at 1× and 2× zoom on both light and dark backgrounds.
- Ensure lighting direction and highlight treatment match the global art bible.
- Confirm tile seams: place base, transition, and accent tiles in a `4×4` grid to check for repetition artifacts.
- Cross-check metadata (anchor pixels, scale tags) before submitting to the asset library.

## Maintenance Rhythm
- Schedule weekly style syncs to compare new vegetation assets against the master reference sheet.
- Archive both raw scans and cleaned pixel versions in the same folder with version tags (`grass_base_v01.png`).
- Update this guide whenever new materials (e.g., swamp grass, desert brush) require additional palette ramps or workflows.

