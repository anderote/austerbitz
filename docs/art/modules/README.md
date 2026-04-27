# Component Catalog – Front Idle (S)

These modules correspond to the new soldier component system documented in `docs/art/soldier-component-system.md`. Each file aligns to the 11×18 grid skeleton templates.

| Component | Type | Facing | File | Key Anchors | Notes |
| --- | --- | --- | --- | --- | --- |
| head-default | anatomy | S | `public/sprites/components/anatomy/head/front/default.png` | head center (5,4) | Bare face block for swapping headgear |
| torso-front-slim | anatomy | S | `public/sprites/components/anatomy/torso/front/slim.png` | shoulder (5,10), hip (5,13) | Neutral torso volume |
| legs-front-idle | anatomy | S | `public/sprites/components/anatomy/legs/front/idle.png` | knee L (4,14), knee R (6,14) | Idle leg silhouette |
| coat-line-front | uniform | S | `public/sprites/components/uniform/coat-line/front/base.png` | -- | British red coat + belts |
| trousers-front-white | uniform | S | `public/sprites/components/uniform/lower/trousers-front.png` | -- | White breeches & black gaiters |
| shako-standard | uniform | S | `public/sprites/components/uniform/head/shako-standard.png` | plume socket (6,2) | Tall shako & plume |
| musket-brown-bess | weapon | S | `public/sprites/components/weapon/musket/front/idle.png` | grip (3,12) | Brown Bess musket |
| shadow-front | fx | S | `public/sprites/components/shadow/front/default.png` | -- | Ground contact shadow |

Use the skeleton templates in `memory/sprites/templates/anatomy/` as the alignment reference before drawing new overlays or anatomy variants.

Preview these layers interactively via `components.html` (run `npm run dev` and open `http://localhost:5173/components.html`) and rebuild the atlas with `node scripts/build-soldier-components.mjs --kit british-line-infantry` when ready for export.
