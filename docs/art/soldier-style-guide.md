# Infantry Pixel Art Style Bible

## Vision
- Deliver a readable, characterful Napoleonic line infantryman reminiscent of classic RTS sprites such as *Command & Conquer: Red Alert*, scaled for modern HD displays while preserving chunky pixels.
- Prioritize clarity at 1x zoom: each frame must immediately communicate facing, action, and allegiance through silhouette and color blocking.

## Canvas & Grid
- Final render: 48×108 px bounding box, transparent background (3×3 cells of 16×36). Each individual cell is 16 px wide by 36 px tall.
- Safe silhouette: keep the body within 30 px width; musket can break silhouette up to 6 px on either side for readability.
- Snap all elements to full pixels; avoid sub-pixel offsets or semi-transparent anti-aliasing.
- Maintain a consistent ground shadow strip 6 px tall (rows 30–35) using 40% opacity neutral gray; aligns characters to the same baseline.

## Proportions & Posing
- Head: 8×10 px with shako 10 px tall; eyes implied via 1–2 px highlight (no outlines inside face). Chin sits on row 12 inside the 16×36 cell.
- Torso: taper from 14 px at shoulders (rows 13–18) to 9 px at waist (row 24); emphasize chest buttons with 1 px highlights alternating brass/white.
- Arms: 4 px wide at bicep, taper to 3 px at forearm; in idle, elbows rest one pixel outside the torso silhouette.
- Legs: 4 px width each, separated by a 2 px gap when standing. Knees sit at row 27; feet are 6×3 px blocks (rows 31–33) angled per facing direction with a 1 px heel cut.

## Palette Strategy
- Base uniform colors (keep hex references, convert to palette file for tooling):
  - `#1E2B68` deep navy coat
  - `#3857C9` bright blue mid-tone
  - `#E7ECF1` white cloth
  - `#D13B33` crimson cuffs/plume
  - `#F5B044` brass trim
  - `#3F2F20` musket wood
  - `#8C959E` steel
- Lighting: single 45° top-left source. Use 3 tones per material (shadow, mid, highlight). Example for navy coat: `#0F153C` shadow, `#1E2B68` base, `#4A66C9` highlight.
- Outline: no universal black outline. Instead, use 1 px darkening along shadowed edges (`#0B0F24` for navy, `#2B1A13` for musket) and contrasting highlight edge on lit side.

## Texture & Detailing
- Buttons and straps limited to 1 px clusters; suggest detail via contrast, not noise.
- Keep checkerboard back banner consistent (4×4 blocks) to reinforce faction identity in rear view.
- Preserve readable musket barrel via alternating dark/light pixels every other column to imply cylindrical form.

## Direction Set (8-way)
Create sprites for: N, NE, E, SE, S, SW, W, NW. Each direction shares the same bounding box and baseline; reuse mirrored frames when possible but redraw highlights/shadows so lighting remains top-left.

## Core Animation States
For each direction produce the following sequences:
1. **Idle / Breathing** – 4 frames, 12 fps. Subtle plume bob, shoulder rise, musket slight tilt.
2. **Walk / March** – 6 frames, 10 fps. Emphasize opposing arm/leg swing; keep musket stable but allow 1–2 px sway.
3. **Run / Advance** – 6 frames, 12 fps. Lean torso forward 3°; feet travel 10 px stride.
4. **Fire / Ready** – 3 key frames, 8 fps. Frame breakdown: ready (stock to shoulder), recoil (torso pushes back 1 px, muzzle flash 6×4 px), recover.
5. **Reload** – 5 frames, 8 fps. Motions: return musket vertical, reach cartridge box, ramrod insertion, prime, ready.
6. **Melee / Bayonet** – 4 frames, 10 fps. Extend musket; add 6 px bayonet glint.
7. **Hit Reaction** – 2 frames, 12 fps. Quick knock-back and recovery.
8. **Death** – 6 frames, 10 fps. Collapse to ground while maintaining silhouette readability; final frame flattened 48×40 px footprint.

## Variant Philosophy
- Each state should support at least two micro-variants to prevent repetition in large formations (e.g., alternate idle breathing with plume sway vs. shoulder shift).
- Color swaps: establish palette layers for coat, cuffs, and shako plume to enable quick faction recolors without re-shading.
- Accessory toggles: backpack, cartridge box on left hip, bedroll. Ensure toggles follow the same pivot points so they animate in sync.

## File & Layer Management
- Source files maintained as layered projects (`british-line-infantry-source.png` or Aseprite `.ase`) with labeled groups per direction (`idle_N`, `walk_NE`, etc.).
- Export pipeline: script slices to individual `PNG` frames using `direction/state/frame#.png` naming (e.g., `infantry/walk_NE/02.png`).
- Include metadata JSON describing frame duration and anchor point for engine integration.

## QA Checklist
- Verify readability at 50% and 100% zooms against light/dark map backgrounds.
- Check that all directions share identical ground contact pixel and vertical alignment.
- Ensure lighting consistency: top-left highlights, bottom-right shadows even on mirrored frames.
- Review animation loops for foot sliding; adjust stride length or frame timing as needed.
