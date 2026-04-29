# Austerblitz — Foundation Design

**Date:** 2026-04-26
**Status:** Approved (pending spec review)

## Vision

Austerblitz is a top-down 2D pixel-art Napoleonic real-time strategy game in the
browser. The fantasy is commanding massed lines of infantry, cavalry, and
artillery in classical Napoleonic-era battles. Visual style: sharp pixel art at
small scale (~16×20 px per soldier), with a fixed top-down view and zoomable
camera. Distinctive vivid color blocks make units readable from any zoom level.

The game is built to scale: the architecture targets battles of tens of
thousands of units with smoke, projectiles, and physics-driven impacts, even
though MVP-1 only places a handful on the field.

## Tech stack

- **TypeScript** for the entire codebase
- **Vite** for dev server and bundling, output is a static site
- **WebGL2** raw, with `gl-matrix` for math; no game framework
- UI is plain HTML/CSS overlaid on the canvas; no UI framework in MVP-1
- Static deploy target (Vercel recommended; works on any static host)

## Three-layer architecture

The runtime separates into three layers with strict directional dependencies:

1. **Simulation** — pure data, no DOM/GL references. Fixed timestep at 30 Hz.
   Deterministic, driven by seeded RNG. This isolation is what enables future
   replay recording and lockstep multiplayer without a rewrite.
2. **Render** — reads simulation buffers each frame, draws via WebGL2 instanced
   passes. Render runs at display refresh rate and interpolates between sim
   ticks for smoothness.
3. **Input/UI** — translates browser events into commands and camera intents.
   UI overlays the canvas as DOM elements.

Dependencies flow one direction: input writes commands consumed by sim; render
and UI read sim state but never write it. Sim never imports from render, input,
or UI.

## Simulation: hybrid ECS

Hot, frequently-iterated entity data is stored as **struct-of-arrays** in
typed arrays, preallocated to a max capacity. SoA is essential at this scale:
iterating tens of thousands of entities every tick demands cache locality.

Hot fields per entity slot:

- **Transform**: `posX`, `posY`, `velX`, `velY` (Float32), `facing` (Uint8, 0–7),
  `rotation` (Float32 if needed for ragdoll spin)
- **Combat**: `hp`, `morale`, `state` (Uint8), `reloadT`, `targetId`
- **Identity**: `kindId` (→ UnitKind, Uint16), `team` (Uint8), `formationId`
- **Physics**: `mass`, `impulseX/Y` (Float32), `ragdollT` (when nonzero, entity
  is in ragdoll state after impact and integrates differently)
- **Animation**: `frame` (Uint8), `frameTime` (Float32)

A free-list tracks unused slots for spawn/despawn.

Less-hot or per-kind data lives in **side tables** keyed by entity id (orders
queue, ability cooldowns, formation slot index). This avoids bloating the hot
arrays while still giving extension points.

### Systems (run in fixed order each tick)

1. `orders` — consume order queue, set velocity targets / state
2. `movement` — integrate position from velocity
3. `formation` — formation members compute slot positions, adjust velocity
4. `spatial-index-rebuild` — rebuild uniform grid from current positions
5. `combat` — find targets, fire weapons, spawn projectiles
6. `projectile` — integrate projectiles, detect impacts via grid
7. `impulse / ragdoll` — apply queued impulses, integrate ragdoll-state entities
8. `morale` — update morale from local conditions, propagate to formation
9. `death` — promote entities with `hp <= 0` to corpses
10. `cleanup` — free dead-and-faded entity slots

System order is fixed; no system runs out of order.

### Spatial index

A **uniform grid** with ~16m cells, rebuilt each tick. The right call when
most entities move every tick — quadtrees waste effort on rebalancing under
those conditions. Used by combat targeting, drag-select hit-testing,
projectile collision, and impulse propagation from explosions.

## Renderer (raw WebGL2)

Instanced quad rendering via `drawArraysInstanced`. One quad geometry, N
instances per pass. Per-instance attributes are streamed each frame:
`vec2 pos`, `uint rotation`, `uint frameIndex`, `rgba8 tint`.

A single texture atlas (e.g. 2048×2048) holds all unit types × facings × frames
for one nation. Multiple atlases per nation if needed. The vertex shader picks
the sub-rect from `frameIndex`.

### Render passes (back to front)

1. **Terrain** — large tiled quad with grass texture, scrolled UVs
2. **Decals** — instanced quads (mud, blood, cannon impacts)
3. **Map features** — instanced quads for hedgerows / walls / buildings / trenches
4. **Corpses** — separate static layer, doesn't tick
5. **Shadows** — instanced dark ellipse quads, one per live unit
6. **Units** — instanced sprite pass, atlas-sampled (placeholder colored quads in MVP-1)
7. **Projectiles** — instanced (cannonballs, musket balls, debris)
8. **Particles** — additive blend (musket smoke, cannon smoke, explosions, dust)
9. **Selection FX** — selection rings, drag-rect, command waypoints
10. **HTML/CSS UI** — DOM overlay

In MVP-1, several passes (decals, features, projectiles, corpses) are wired
but rendered with zero instances. The structure is in place; content fills it.

## Camera

Orthographic, world-space coordinates in meters. View matrix is translation +
zoom; rotation is fixed (top-down).

- **Pan**: middle-drag, edge-scroll, arrow keys
- **Zoom**: mouse wheel, anchored to cursor position
- **Range**: 0.25× (overview) to 4× (close-up)

## Data-driven content

All game-design-tunable data lives as data files, not code. Adding a new unit
or upgrade is a one-file change.

### UnitKind

```ts
type UnitKind = {
  id: string;                              // 'line-infantry', 'cuirassier', 'cannon-12'
  category: 'infantry' | 'cavalry' | 'artillery';
  name: string;
  spriteAtlas: AtlasRef;
  baseStats: {
    hp: number;
    moveSpeed: number;          // m/s
    morale: number;
    sightRange: number;         // m
    weaponRange: number;        // m
    weaponDamage: number;
    weaponReload: number;       // s
    weaponAccuracy: number;     // 0..1
    armor: number;
    massKg: number;             // for impact physics
    formationSpacing: { x: number; y: number };
  };
  abilities: AbilityRef[];
};
```

### UpgradeNode

```ts
type UpgradeNode = {
  id: string;
  appliesTo: UnitKind['id'][] | 'all';
  modifiers: Partial<Record<keyof UnitKind['baseStats'], { mul?: number; add?: number }>>;
  prerequisites: UpgradeNode['id'][];
  cost: number;
};
```

Effective stats per `(kind, team)` are baked once at battle start from base +
active upgrades. The hot path uses the baked table; no per-tick stat
recomputation.

### MapFeature

```ts
type MapFeature = {
  id: number;
  kind: 'hedgerow' | 'wall' | 'building' | 'trench' | 'river';
  shape: { type: 'polyline' | 'polygon' | 'rect'; points: Vec2[] };
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksSight: boolean;
  cover: number;            // 0..1, damage reduction in cover
  height: number;           // negative for trenches, positive for buildings
};
```

All map elements (hedgerows, walls, trenches, buildings) reduce to this single
schema.

## Map

World coordinates in meters (Float32). MVP-1 map is a 2km × 2km grass field,
no features. The schema supports very large maps because rendering culls per
pass and the spatial grid bounds work per query.

```ts
type WorldMap = {
  size: { w: number; h: number };
  terrainTexture: TextureRef;
  features: MapFeature[];
};
```

## Input — Red Alert / classic RTS controls

- **Left click**: select single unit (clears prior selection unless shift)
- **Left click + drag**: rectangle select; shift adds to selection
- **Right click**: contextual command (move to point, attack target, enter feature)
- **Shift + right click**: queue command
- **Ctrl + 1..0**: assign current selection to control group N
- **1..0**: select control group N; double-tap centers camera on it
- **Mouse wheel**: zoom anchored to cursor
- **Middle drag / edge scroll / arrow keys**: pan
- **ESC**: cancel current command / clear selection

## UI (minimalist, HTML/CSS overlay)

- **Top bar**: stub area for resources/banner (placeholder)
- **Bottom-center**: selection panel showing selected unit kinds and counts
- **Bottom-left**: minimap, renders a downsampled world snapshot
- **Right side**: collapsible build menu (slides out), shows buildable kinds
  contextual to selection
- **HUD overlay**: FPS, entity count, debug info

UI is plain TypeScript + DOM in MVP-1. We can introduce a UI framework later
if menu complexity warrants it.

## Forward-looking plumbing (designed in, deferred to later milestones)

These are mentioned in the architecture so MVP-1 doesn't paint us into a corner.

- **Physics impulses**: when a cavalry charge or cannonball impact hits, apply
  an impulse to the entity, set `ragdollT` > 0, integrate position with
  friction over N seconds. The `ragdoll` system handles all impacted entities.
  No full physics engine — a single state flag and a small system.
- **Particles**: separate SoA particle pool (e.g. 50k preallocated) shared
  across emitter types. Emitter types: musket-smoke, cannon-smoke, explosion,
  dust, debris. Rendered via the same instanced-quad pipeline with additive
  blend.
- **Explosions**: a high-level facade `spawnExplosion(pos, radius, force)`
  emits particles, applies area impulses (via spatial grid query), and deals
  damage in radius.
- **Cavalry momentum**: cavalry entities track `chargeMomentum`; collision
  with infantry transfers impulse `mass × velocity` to the struck soldier,
  putting it in ragdoll state.

## Project layout

```
src/
  main.ts                       bootstrap
  gl/                           low-level WebGL helpers
    context.ts
    program.ts
    buffer.ts
    texture.ts
  render/
    renderer.ts                 coordinates passes
    camera.ts
    passes/
      terrain-pass.ts
      feature-pass.ts
      shadow-pass.ts
      sprite-pass.ts            instanced units
      projectile-pass.ts
      particle-pass.ts          additive blend
      decal-pass.ts
    shaders/
      sprite.vert / .frag
      particle.vert / .frag
      terrain.vert / .frag
  sim/
    world.ts                    top-level tick + ownership
    entities.ts                 SoA arrays + alloc/free
    components/
      transform.ts
      health.ts
      orders.ts
      formation.ts
      ragdoll.ts
    systems/
      movement-system.ts
      formation-system.ts
      combat-system.ts
      projectile-system.ts
      morale-system.ts
      death-system.ts
      ragdoll-system.ts
    spatial/
      grid.ts                   uniform spatial grid
    physics/
      impulse.ts
  data/
    units/
      line-infantry.ts
      cuirassier.ts
      cannon-12.ts
    upgrades/
    abilities/
    factions/
  map/
    world-map.ts
    feature-types.ts
  input/
    input-manager.ts
    camera-controls.ts
    selection.ts
    commands.ts
  ui/
    overlay.ts
    minimap.ts
    selection-panel.ts
    build-menu.ts
    hud.ts
  particles/
    particle-system.ts
    emitters.ts
  fx/
    explosions.ts
  util/
    time.ts                     fixed-timestep loop
    math.ts
    rng.ts                      seeded RNG
```

## MVP-1 scope (concrete first slice)

1. Vite + TypeScript scaffold; static deploy ready (`vite build` → `dist/`)
2. WebGL2 renderer skeleton with all passes wired (several pass through with
   zero instances initially)
3. Simulation core: SoA entity buffers, fixed-timestep loop, seeded RNG,
   uniform spatial grid
4. Camera: pan / zoom / edge-scroll
5. Map: 2km × 2km green field with tiled grass texture, no features
6. Three unit kinds defined as data: `line-infantry`, `cuirassier`,
   `cannon-12`. Rendered as placeholder colored quads (red, blue, gray) — no
   animation yet
7. A small handful of each placed on the map at startup
8. Drag-select rectangle and click-select with selection rings rendered
9. Right-click move with simple straight-line movement (no pathfinding /
   avoidance yet)
10. UI: HUD (FPS, entity count), bottom-center selection panel, collapsible
    right-side build menu with placeholder buttons
11. Stub particle system: dust emitter triggered under moving units, to
    validate the pipeline end-to-end

### Explicitly deferred to later milestones

- Real animated sprites and texture atlases
- Combat, projectiles, weapon firing
- Pathfinding and obstacle avoidance
- Formations (slot positioning, formation orders)
- Morale logic beyond the field on the entity
- Upgrade tree UI and effects beyond the data schema
- Map features (hedgerows, walls, buildings, trenches, rivers)
- Physics impulses and ragdolls
- Explosions
- Sound and music
- Multiplayer / networking

## Success criteria for MVP-1

- Deploys as a static site, loads in a modern browser
- Smooth pan and zoom across the full range
- Drag-select picks up units, right-click issues a move order, dust kicks up
  under moving units
- Collapsible build menu opens and closes
- Adding a new unit kind is a single-file change in `src/data/units/`
  (extensibility check)
