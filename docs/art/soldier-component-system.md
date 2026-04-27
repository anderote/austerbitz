# Soldier Modular Component System

This guide defines how we hand-craft a reusable pixel soldier kit that matches the existing infantry style while letting us swap parts, recolor uniforms, and expand to many factions without relying on automated generation. Use it alongside `docs/art/soldier-style-guide.md` for pose, lighting, and animation specifics.

## Goals
- Maintain 1:1 compatibility with the 11×18 soldier cells used in the current atlas (33×54 sheet arranged as 3×3 cells).
- Guarantee every anatomy piece and uniform overlay snaps together, shares the same lighting logic, and respects the faction tint markers.
- Enable rapid manual authoring of new outfits (e.g. kilts, greatcoats) and alternate views without redrawing the entire sprite.

## Base Grid & Anchors
- Coordinate system: origin `(0,0)` at the top-left of each 11×18 cell, `x` rightward, `y` downward.
- Reuse the ground shadow strip on row `17`; row `16` is the ankle line where both feet anchor.
- Keep anatomy and overlays inside the safe 9 px wide column (`x = 1…9`) unless silhouettes intentionally flare (e.g. backpack, plume).

| Anchor | Front View `(x,y)` | Notes |
| --- | --- | --- |
| Head center | `(5,4)` | Midpoint of shako; head module spans rows 2–8. |
| Shoulder pivot | `(5,10)` | Arms hinge here; belt crosses align at this height. |
| Elbow relaxed | `(4,12)` left / `(6,12)` right | When arms hang, wrists fall at row 14. |
| Hip pivot | `(5,13)` | Torso taper meets legs; belts cross here. |
| Knee line | `(4,14)` left / `(6,14)` right | Determines stride length for marching loops. |
| Foot center | `(4,16)` left / `(6,16)` right | Feet occupy 4×2 px blocks. |
| Musket grip | `(3,12)` | Forward hand grips stock; keep consistent across facings. |
| Back equipment hook | `(5,11)` | Bedroll/backpack straps anchor here. |

**Template files** (create once, reuse):
- `templates/anatomy/front-skeleton.png` – blocking of the above anchors.
- `templates/anatomy/side-skeleton.png` – matches mirrored arm and musket placement in `POSE_SIDE`.
- `templates/anatomy/back-skeleton.png` – mirrors for rear facings.

## Palette & Material Rules
- Continue using the palette letters defined in `src/render/british-soldier-sprite.ts` (`k`, `w`, `f`, etc.). Extend cautiously: add new letters only after updating the palette table in code and tooling scripts.
- Primary (`P`) and secondary (`S`) marker pixels stay reserved for shader-driven recolors. When blocking new coats or facings, paint with `P`/`S` first, then carve shadows/highlights using material tones that sit one step darker/lighter than the tint the shader will inject.
- Non-tint materials (skin, leather, metals) keep three tone steps: `shadow`, `base`, `highlight`. Record each triplet in `docs/art/palette.csv` (to be created alongside new materials).
- Avoid semi-transparent AA except for the ground shadow (`s`). Use solid pixels for edges and rely on color adjacency for smoothing.

## Anatomy Modules
Author neutral anatomy parts once per facing and reuse across uniforms.

- **Head** (`head/front/default.png`): includes face, shako base, plume socket. Variant heads (bearskin, bonnet) split into separate uniform modules but share face proportions.
- **Torso Core** (`torso/front/slim.png`, `torso/front/broad.png`): contains underlying chest volume, belt anchors, and musket contact point but no uniform color. Shade using neutral desaturated tones (`k` gradients) so coats overlay cleanly.
- **Arms** (`arm-left/front/idle.png`, `arm-right/front/idle.png`): store as separate layers for idle pose plus alternate angles for march, reload, melee. Include the attached hand; weapon overlays slot between arms and torso where needed.
- **Legs** (`legs/front/idle.png`, `legs/front/march-A.png`, `legs/front/march-B.png`): neutral breeches volume without gaiter detail. Keep stride variations separated so uniform overlays can inherit motion.
- **Shadow** (`shadow/front/default.png`): 9×1 strip at row 17; stays constant for most stances.

Each anatomy file should include a metadata note (e.g. layer comment or sidecar JSON) listing: `pivot`, `compatible_facing`, and `default_sequence` (which animations reference it).

## Uniform & Pattern Modules
Build clothing as additive overlays aligned to anatomy pivots.

- **Upper Body Coats** (`uniform/coat-line/front/base.png`): replace torso neutral shading with coat colors. Use `P` marker for main cloth, `S` for facings. Maintain button and lapel highlights in coat-specific palette swaps.
- **Lower Body Variants** (`uniform/lower/kilt-front.png`, `uniform/lower/trousers-front.png`): extend from hip pivot to feet. Patterns like tartan should be authored on a separate `_pattern.png` overlay to allow recolor scripts to cycle through approved palettes.
- **Headgear** (`uniform/head/shako-standard.png`, `uniform/head/bears…`): stack on top of head anatomy; include plume or badge details. If silhouette changes width, document the offsets so side/back facings match.
- **Equipment** (`equipment/backpack/front/idle.png`, `equipment/canteen/side.png`): attach at `back equipment hook`. Provide both front and back views to prevent popping when the soldier rotates.
- **Weapon Attachments** (`weapon/musket/front/idle.png`, `weapon/musket/front/fire.png`): keep the musket separate from arms so alternate equipment (pikes, rifles) can reuse arm animations. Note the hand contact coordinates to align hands during redraws.

Document each module with a spec card (thumbnail, notes) in `docs/art/modules/` for quick reference.

## Layering Order (per facing)
1. Shadow strip.
2. Rear equipment (e.g. backpack) that should sit behind legs.
3. Legs anatomy + lower uniform overlay.
4. Torso anatomy.
5. Arms behind torso (usually right/back arm for front/SE facings).
6. Weapon body.
7. Torso uniform overlay + crossbelts.
8. Front arm.
9. Head anatomy + headgear.
10. Foreground equipment (e.g. cartridge box strap, bayonet glint).
11. Highlights/glints (optional pass for metallic accents).

Maintain consistent layer names in Aseprite (`00_shadow`, `05_legs`, etc.) so export scripts can toggle visibility deterministically.

## Manual Drawing Workflow
1. Duplicate the facing skeleton template into a new `.ase` file for the target component.
2. Block silhouette with neutral mid-tones, confirming it fits the safe column and anchor coordinates.
3. Sculpt lighting using the top-left light rule. Cross-check with the style bible to keep highlight widths consistent.
4. Drop in palette letters (or actual RGB swatches if working directly in Aseprite) following the tint marker plan.
5. Toggle anatomy and uniform layers together to verify seams align (e.g. belt edges meeting trousers).
6. Export a preview GIF at 1× and 2× to inspect for stray pixels or wobble.
7. Record any custom offsets or dependencies in a `.notes` layer and mirror them to the documentation table.

## Multi-View & Animation Expansion
- Start every new uniform in the **front** view. Once approved, propagate to diagonal (`SE`, `SW`) by copying the front anatomy modules and adjusting only the edge pixels that reveal more of the side torso.
- For mirrored facings (`W`, `NW`), flip the front/diagonal base, then repaint highlights to maintain top-left lighting. Do **not** rely on auto-mirror; re-shade manually around plumes, musket, and sash edges.
- Establish shared arm/leg frame libraries: e.g. `legs/march/frame-01.png` works for `SE`, `S`, `SW` facings with only toe highlight tweaks.
- When adding new actions (reload, melee), first rough the motion with anatomy-only layers. Lock the timing, then project uniform overlays frame-by-frame to avoid garment lag.

## File Naming & Metadata
- Use lowercase kebab-case path segments: `components/<category>/<facing>/<variant>.ase`.
- Prefix animation frames with `00`, `01`, … to keep chronological ordering.
- Maintain a `public/components/index.json` registry with entries: `{ "id": "coat-line", "category": "upper", "facings": ["S","SE","SW"], "anatomy": "torso/front/slim" }`. This powers future tooling and ensures we track coverage gaps.
- Keep exports under `public/sprites/components/` with atlas-ready PNGs plus layered source files in `memory/sprites/` (following current repo conventions).

## QA Checklist (Component-Level)
- Alignment: drop the module onto the skeleton template and confirm all anchors coincide without nudging.
- Palette audit: verify no stray colors outside the approved palette list for that material.
- Silhouette: test at 1× zoom on light/dark backgrounds; ensure the component still reads when combined with adjacent modules.
- Rotation set: confirm the component exists (or is deliberately absent) for all required facings before marking it “complete”.
- Notes synced: update `public/components/index.json` and the documentation spec card whenever you add/edit a module.

## Preview & Assembly Tools
- **Interactive preview:** run `npm run dev` and open `http://localhost:5173/components.html` to toggle components on/off, swap skeleton overlays, and inspect the composite cell in real time. The view consumes `public/components/index.json` and kit configs under `public/components/kits/`.
- **Atlas builder:** run `node scripts/build-soldier-components.mjs --kit british-line-infantry` after updating component layers. The script composites the configured layers into `public/sprites/british-line-infantry-components.png` and emits a 6× preview PNG alongside it. Pass `--out` / `--preview` to override destinations.

## Immediate Next Steps
1. Create the skeleton templates (`front`, `side`, `back`) and commit them as neutral guides.
2. Break the existing British line infantry sprite into anatomy vs. uniform layers to seed the component library.
3. Stand up the `public/components/index.json` registry and backfill entries for the British set.
4. Draft the first alternate uniform (e.g. Highland kilt) using the new pipeline to pressure-test the workflow.
