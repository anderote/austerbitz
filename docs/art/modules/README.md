# Component Catalog – Idle Standing (All Facings)

These modules correspond to the soldier component system in `docs/art/soldier-component-system.md`. Each PNG aligns with the 11×18 skeleton templates under `memory/sprites/templates/anatomy/` and targets the idle standing pose across all eight compass facings.

## Body
- `body-north-base` → `public/sprites/components/anatomy/body/north/base.png`
- `body-northeast-base` → `public/sprites/components/anatomy/body/northeast/base.png`
- `body-east-base` → `public/sprites/components/anatomy/body/east/base.png`
- `body-southeast-base` → `public/sprites/components/anatomy/body/southeast/base.png`
- `body-south-base` → `public/sprites/components/anatomy/body/south/base.png`
- `body-southwest-base` → `public/sprites/components/anatomy/body/southwest/base.png`
- `body-west-base` → `public/sprites/components/anatomy/body/west/base.png`
- `body-northwest-base` → `public/sprites/components/anatomy/body/northwest/base.png`

## Uniform — Upper (Coat)
- `coat-line-<dir>` → `public/sprites/components/uniform/coat-line/<dir>/base.png`
  - `<dir>` ∈ {`north`, `northeast`, `east`, `southeast`, `south`, `southwest`, `west`, `northwest`}

## Uniform — Lower (Trousers & Gaiters)
- `trousers-<dir>` → `public/sprites/components/uniform/lower/trousers/<dir>.png`

## Headgear
- `shako-standard-<dir>` → `public/sprites/components/uniform/head/shako-standard/<dir>.png`

## Weapon
- `musket-brown-bess-<dir>` → `public/sprites/components/weapon/musket/<dir>/idle.png`

## Shadow
- `shadow-<dir>` → `public/sprites/components/shadow/<dir>/default.png`

Preview these layers interactively via `components.html` (`npm run dev` → `http://localhost:5173/components.html`) and rebuild the atlas with `node scripts/build-soldier-components.mjs --kit british-line-infantry` when you update component art.
