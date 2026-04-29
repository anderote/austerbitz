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

function panelEl(root: HTMLElement): HTMLElement {
  const el = root.querySelector('.unit-controls') as HTMLElement | null;
  if (!el) throw new Error('panel not mounted');
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

  it('hides the panel when nothing is selected', () => {
    panel.update(world, sel, params, { kind: 'none' }, false);
    expect(panelEl(root).style.display).toBe('none');
  });

  it('shows the stance strip and hides the ammo strip for an infantry-only selection', () => {
    const id = spawn(world, 'line-infantry');
    world.entities.stance[id] = FireStance.Volley;
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    expect(el.style.display).toBe('');
    const stanceStrip = el.querySelector('.unit-strip-stance') as HTMLElement;
    const ammoStrip = el.querySelector('.unit-strip-ammo') as HTMLElement;
    expect(stanceStrip.style.display).toBe('');
    expect(ammoStrip.style.display).toBe('none');
    // Volley is index 1; check it's the active slot.
    const activeSlots = stanceStrip.querySelectorAll('.unit-slot.active');
    expect(activeSlots.length).toBe(1);
    expect(activeSlots[0]!.querySelector('.unit-slot-key')!.textContent).toBe('X');
  });

  it('shows the ammo strip and hides the stance strip for a cannon-only selection', () => {
    const id = spawn(world, 'cannon-12');
    world.entities.cannonAmmo[id] = 2; // canister
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    const stanceStrip = el.querySelector('.unit-strip-stance') as HTMLElement;
    const ammoStrip = el.querySelector('.unit-strip-ammo') as HTMLElement;
    expect(stanceStrip.style.display).toBe('none');
    expect(ammoStrip.style.display).toBe('');
    const activeKey = ammoStrip.querySelector('.unit-slot.active .unit-slot-key')!.textContent;
    expect(activeKey).toBe('C');
    // Cannon-only universal block visible.
    const cannonBlock = el.querySelector('.uc-block-cannon') as HTMLElement;
    expect(cannonBlock.style.display).toBe('');
  });

  it('hides both unit-specific strips for a cavalry-only selection', () => {
    const id = spawn(world, 'cuirassier');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    expect((el.querySelector('.unit-strip-stance') as HTMLElement).style.display).toBe('none');
    expect((el.querySelector('.unit-strip-ammo') as HTMLElement).style.display).toBe('none');
    expect((el.querySelector('.uc-block-cannon') as HTMLElement).style.display).toBe('none');
    // Formation + universal blocks remain visible (parent panel visible).
    expect(el.style.display).toBe('');
  });

  it('shows both strips for a mixed infantry+artillery selection', () => {
    const inf = spawn(world, 'line-infantry');
    world.entities.stance[inf] = FireStance.Hold;
    const can = spawn(world, 'cannon-12');
    world.entities.cannonAmmo[can] = 0;
    sel.ids.add(inf); sel.ids.add(can);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    expect((el.querySelector('.unit-strip-stance') as HTMLElement).style.display).toBe('');
    expect((el.querySelector('.unit-strip-ammo') as HTMLElement).style.display).toBe('');
  });

  it('marks the stance strip mixed when infantry stances disagree', () => {
    const a = spawn(world, 'line-infantry'); world.entities.stance[a] = FireStance.AtWill;
    const b = spawn(world, 'line-infantry'); world.entities.stance[b] = FireStance.Volley;
    sel.ids.add(a); sel.ids.add(b);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    const mixedHint = el.querySelector('.unit-strip-stance .unit-slot-mixed') as HTMLElement;
    expect(mixedHint.style.display).toBe('');
    // No slot should be active.
    expect(el.querySelectorAll('.unit-strip-stance .unit-slot.active').length).toBe(0);
  });

  it('marks the ammo strip mixed when cannon ammo disagrees', () => {
    const a = spawn(world, 'cannon-12'); world.entities.cannonAmmo[a] = 0;
    const b = spawn(world, 'cannon-12'); world.entities.cannonAmmo[b] = 2;
    sel.ids.add(a); sel.ids.add(b);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    const mixedHint = el.querySelector('.unit-strip-ammo .unit-slot-mixed') as HTMLElement;
    expect(mixedHint.style.display).toBe('');
    expect(el.querySelectorAll('.unit-strip-ammo .unit-slot.active').length).toBe(0);
  });

  it('reflects runMode in the Walk/Run row value', () => {
    const id = spawn(world, 'line-infantry');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    let tVal = panelEl(root).querySelectorAll('.uc-row .uc-val');
    // Find the row whose key is "T".
    function valForKey(key: string): string {
      const rows = panelEl(root).querySelectorAll('.uc-row');
      for (const row of rows) {
        if (row.querySelector('.uc-key')!.textContent === key) {
          return row.querySelector('.uc-val')?.textContent ?? '';
        }
      }
      throw new Error(`row ${key} missing`);
    }
    expect(valForKey('T')).toBe('Walk');

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), true);
    expect(valForKey('T')).toBe('Run');
  });

  it('reflects spacing/ranks values', () => {
    const id = spawn(world, 'line-infantry');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    function valForKey(key: string): string {
      const rows = panelEl(root).querySelectorAll('.uc-row');
      for (const row of rows) {
        if (row.querySelector('.uc-key')!.textContent === key) {
          return row.querySelector('.uc-val')?.textContent ?? '';
        }
      }
      throw new Error(`row ${key} missing`);
    }
    expect(valForKey('[ ]')).toMatch(/× /);
    expect(valForKey(', .')).toBe('auto');

    params.ranks = 4;
    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    expect(valForKey(', .')).toBe('4');
  });
});
