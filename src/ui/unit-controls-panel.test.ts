// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity, FireStance } from '../sim/entities';
import { createSelection } from '../input/selection';
import { createFormationParams } from '../input/formation-params';
import { getUnitKindIndex } from '../data/units';
import { computeStanceSummary } from '../input/stance-summary';
import { createUnitControlsPanel } from './unit-controls-panel';

function setupRoot(): HTMLElement {
  document.body.innerHTML = '<div id="ui-root"></div>';
  return document.getElementById('ui-root')!;
}

function spawn(world: ReturnType<typeof createWorld>, kindId: string): number {
  const id = allocEntity(world.entities);
  if (id === -1) throw new Error('out of capacity');
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  return id;
}

function customEl(root: HTMLElement): HTMLElement {
  const el = root.querySelector('.unit-controls-custom') as HTMLElement | null;
  if (!el) throw new Error('custom panel not mounted');
  return el;
}
function generalEl(root: HTMLElement): HTMLElement {
  const el = root.querySelector('.unit-controls-general') as HTMLElement | null;
  if (!el) throw new Error('general panel not mounted');
  return el;
}

describe('unit-controls-panel', () => {
  let root: HTMLElement;
  let world: ReturnType<typeof createWorld>;
  let sel: ReturnType<typeof createSelection>;
  let params: ReturnType<typeof createFormationParams>;
  let panel: ReturnType<typeof createUnitControlsPanel>;

  beforeEach(() => {
    root = setupRoot();
    world = createWorld({ seed: 1, capacity: 32, mapSize: 100 });
    sel = createSelection();
    params = createFormationParams();
    panel = createUnitControlsPanel(root);
  });

  it('hides both panels when nothing is selected', () => {
    panel.update(world, sel, params, { kind: 'none' }, false);
    expect(customEl(root).style.display).toBe('none');
    expect(generalEl(root).style.display).toBe('none');
  });

  it('shows the stance strip and hides the ammo strip for an infantry-only selection', () => {
    const id = spawn(world, 'line-infantry');
    world.entities.stance[id] = FireStance.Volley;
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    expect(customEl(root).style.display).toBe('');
    expect(generalEl(root).style.display).toBe('');
    const stanceStrip = customEl(root).querySelector('.unit-strip-stance') as HTMLElement;
    const ammoStrip = customEl(root).querySelector('.unit-strip-ammo') as HTMLElement;
    expect(stanceStrip.style.display).toBe('');
    expect(ammoStrip.style.display).toBe('none');
    // Volley is index 1; check it's the active slot.
    const activeSlots = stanceStrip.querySelectorAll('.unit-slot.active');
    expect(activeSlots.length).toBe(1);
    expect(activeSlots[0]!.querySelector('.unit-slot-key')!.textContent).toBe('X');
  });

  it('shows only the ammo strip for a cannon-only selection (no fire-mode/cannon block)', () => {
    const id = spawn(world, 'cannon-12');
    world.entities.cannonAmmo[id] = 2; // canister
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    expect(customEl(root).style.display).toBe('');
    const stanceStrip = customEl(root).querySelector('.unit-strip-stance') as HTMLElement;
    const ammoStrip = customEl(root).querySelector('.unit-strip-ammo') as HTMLElement;
    expect(stanceStrip.style.display).toBe('none');
    expect(ammoStrip.style.display).toBe('');
    const activeKey = ammoStrip.querySelector('.unit-slot.active .unit-slot-key')!.textContent;
    expect(activeKey).toBe('C');
    // No cannon-specific Space/Rotate/Elevate hint block.
    expect(root.querySelector('.uc-block-cannon')).toBeNull();
  });

  it('hides the custom panel for a cavalry-only selection but keeps the general panel', () => {
    const id = spawn(world, 'cuirassier');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    expect(customEl(root).style.display).toBe('none');
    expect(generalEl(root).style.display).toBe('');
  });

  it('shows both strips for a mixed infantry+artillery selection', () => {
    const inf = spawn(world, 'line-infantry');
    world.entities.stance[inf] = FireStance.Hold;
    const can = spawn(world, 'cannon-12');
    world.entities.cannonAmmo[can] = 0;
    sel.ids.add(inf); sel.ids.add(can);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    expect(customEl(root).style.display).toBe('');
    expect((customEl(root).querySelector('.unit-strip-stance') as HTMLElement).style.display).toBe('');
    expect((customEl(root).querySelector('.unit-strip-ammo') as HTMLElement).style.display).toBe('');
  });

  it('marks the stance strip mixed when infantry stances disagree', () => {
    const a = spawn(world, 'line-infantry'); world.entities.stance[a] = FireStance.AtWill;
    const b = spawn(world, 'line-infantry'); world.entities.stance[b] = FireStance.Volley;
    sel.ids.add(a); sel.ids.add(b);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const mixedHint = customEl(root).querySelector('.unit-strip-stance .unit-slot-mixed') as HTMLElement;
    expect(mixedHint.style.display).toBe('');
    expect(customEl(root).querySelectorAll('.unit-strip-stance .unit-slot.active').length).toBe(0);
  });

  it('marks the ammo strip mixed when cannon ammo disagrees', () => {
    const a = spawn(world, 'cannon-12'); world.entities.cannonAmmo[a] = 0;
    const b = spawn(world, 'cannon-12'); world.entities.cannonAmmo[b] = 2;
    sel.ids.add(a); sel.ids.add(b);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const mixedHint = customEl(root).querySelector('.unit-strip-ammo .unit-slot-mixed') as HTMLElement;
    expect(mixedHint.style.display).toBe('');
    expect(customEl(root).querySelectorAll('.unit-strip-ammo .unit-slot.active').length).toBe(0);
  });

  function chipValForKey(root: HTMLElement, key: string): string {
    const chips = generalEl(root).querySelectorAll('.uc-chip');
    for (const chip of chips) {
      if (chip.querySelector('.uc-chip-key')!.textContent === key) {
        return chip.querySelector('.uc-chip-val')?.textContent ?? '';
      }
    }
    throw new Error(`chip ${key} missing`);
  }

  it('reflects runMode in the Walk/Run chip value', () => {
    const id = spawn(world, 'line-infantry');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    expect(chipValForKey(root, 'T')).toBe('Walk');

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), true);
    expect(chipValForKey(root, 'T')).toBe('Run');
  });

  it('reflects spacing/ranks values', () => {
    const id = spawn(world, 'line-infantry');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    expect(chipValForKey(root, '[ ]')).toMatch(/× /);
    expect(chipValForKey(root, ',.')).toBe('auto');

    params.ranks = 4;
    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    expect(chipValForKey(root, ',.')).toBe('4');
  });
});
