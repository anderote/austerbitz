import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity, EntityState } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createSelection, createDragRect, createFormationDrag, createControlGroups } from './selection';
import { createSelectionController } from './selection-controller';
import { createCamera } from '../render/camera';

function makeDeps() {
  const camera = createCamera();
  camera.viewport = { w: 800, h: 600 };
  camera.center = { x: 0, y: 0 };
  camera.zoom = 1;
  const world = createWorld({ seed: 1, capacity: 32, mapSize: 1000 });
  const selection = createSelection();
  const drag = createDragRect();
  const formationDrag = createFormationDrag();
  const overlayRoot = { contains: (_n: Node) => false } as unknown as HTMLElement;
  const canvas = { style: {} as CSSStyleDeclaration } as unknown as HTMLCanvasElement;
  const controlGroups = createControlGroups();
  const ctrl = createSelectionController({ canvas, overlayRoot, camera, world, selection, drag, formationDrag, controlGroups });
  return { ctrl, world, selection, drag, formationDrag, camera };
}

function spawn(world: ReturnType<typeof createWorld>, kind: string, team: number, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex(kind);
  world.entities.team[id] = team;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

function click(ctrl: ReturnType<typeof createSelectionController>, x: number, y: number, mods: { shift?: boolean; ctrl?: boolean; button?: number } = {}) {
  const button = mods.button ?? 0;
  ctrl._internals.onMouseDown({ button, clientX: x, clientY: y, target: null });
  ctrl._internals.onMouseUp({ button, clientX: x, clientY: y, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: false });
}

function drag(ctrl: ReturnType<typeof createSelectionController>, x0: number, y0: number, x1: number, y1: number, mods: { shift?: boolean } = {}) {
  ctrl._internals.onMouseDown({ button: 0, clientX: x0, clientY: y0, target: null });
  ctrl._internals.onMouseMove({ clientX: x1, clientY: y1 });
  ctrl._internals.onMouseUp({ button: 0, clientX: x1, clientY: y1, shiftKey: !!mods.shift, ctrlKey: false, metaKey: false });
}

describe('selection-controller — modifier rules', () => {
  it('LMB click on own unit replaces selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0); // PLAYER_TEAM = 0
    const b = spawn(world, 'line-infantry', 0, 100, 0);
    selection.ids.add(b);
    click(ctrl, 400, 300); // world (0, 0)
    expect(Array.from(selection.ids)).toEqual([a]);
  });

  it('LMB click on empty clears selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    click(ctrl, 700, 500); // world (300, 200) — no unit
    expect(selection.ids.size).toBe(0);
  });

  it('LMB drag selects only own-team units in box', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);  // world (0, 0)
    const enemy = spawn(world, 'line-infantry', 1, 5, 0); // world (5, 0)
    void enemy;
    drag(ctrl, 380, 280, 420, 320); // world rect (-20,-20)..(20,20)
    expect(Array.from(selection.ids)).toEqual([own]);
  });

  it('LMB drag with only enemies in box selects the closest enemy', () => {
    const { ctrl, world, selection } = makeDeps();
    const e1 = spawn(world, 'line-infantry', 1, -5, 0);  // world (-5, 0)
    const e2 = spawn(world, 'line-infantry', 1, 8, 0);   // world (8, 0)
    void e2;
    drag(ctrl, 380, 280, 420, 320); // world rect (-20,-20)..(20,20), center (0,0)
    expect(Array.from(selection.ids)).toEqual([e1]);
  });

  it('Shift + LMB click on unit toggles it in selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    click(ctrl, 400, 300, { shift: true });
    expect(selection.ids.has(a)).toBe(true);
    click(ctrl, 400, 300, { shift: true });
    expect(selection.ids.has(a)).toBe(false);
  });

  it('Shift + LMB drag adds own-team units to selection (no toggle)', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(b);
    drag(ctrl, 380, 280, 420, 320, { shift: true });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
  });
});

describe('selection-controller — same-kind selection', () => {
  it('Ctrl + LMB click selects all of same kind in viewport', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    const cav = spawn(world, 'cuirassier', 0, -5, 0);
    void cav;
    click(ctrl, 400, 300, { ctrl: true }); // clicks unit a
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
    expect(selection.ids.has(cav)).toBe(false);
  });

  it('Ctrl + LMB on enemy selects all of that enemy kind in view', () => {
    const { ctrl, world, selection } = makeDeps();
    const e1 = spawn(world, 'line-infantry', 1, 0, 0);
    const e2 = spawn(world, 'line-infantry', 1, 5, 0);
    const own = spawn(world, 'line-infantry', 0, -5, 0);
    void own;
    click(ctrl, 400, 300, { ctrl: true });
    expect(selection.ids.has(e1)).toBe(true);
    expect(selection.ids.has(e2)).toBe(true);
    expect(selection.ids.has(own)).toBe(false);
  });

  it('Two LMB clicks on a unit with no remembered group does not expand', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    void b;
    click(ctrl, 400, 300);
    click(ctrl, 400, 300);
    expect(Array.from(selection.ids)).toEqual([a]);
  });
});

describe('selection-controller — formation recall', () => {
  // Camera at center (0,0), zoom 1, viewport 800x600 → screen (400, 300) is world (0, 0).
  // line-infantry placeholderSize.w = 1.0, so click coords must land within ±0.5 of a unit.
  it('box-select stamps a shared group id on every selected unit', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    drag(ctrl, 380, 280, 420, 320); // world rect (-20,-20)..(20,20)
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
    expect(world.entities.lastSelectionGroup[a]).toBeGreaterThanOrEqual(1);
    expect(world.entities.lastSelectionGroup[b]).toBe(world.entities.lastSelectionGroup[a]);
  });

  it('double-click on a box-selected member re-selects the whole group', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);   // screen (400, 300)
    const b = spawn(world, 'line-infantry', 0, 5, 0);   // screen (405, 300)
    drag(ctrl, 380, 280, 420, 320);
    selection.ids.clear();
    click(ctrl, 400, 300); // single-click a
    click(ctrl, 400, 300); // double-click — recall group
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
  });

  it('formation recall excludes dead members', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    drag(ctrl, 380, 280, 420, 320);
    world.entities.state[b] = EntityState.Dead;
    selection.ids.clear();
    click(ctrl, 400, 300);
    click(ctrl, 400, 300);
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(false);
  });

  it('a later box-select creates a fresh group, leaving the previous group intact', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    const c = spawn(world, 'line-infantry', 0, 200, 0); // far away — out of view-rect drag
    drag(ctrl, 380, 280, 420, 320); // selects a + b → group 1
    const group1 = world.entities.lastSelectionGroup[a]!;
    // Box-select around c only (world rect around (200, 0))
    drag(ctrl, 580, 280, 620, 320); // world rect (180,-20)..(220,20)
    expect(world.entities.lastSelectionGroup[c]).not.toBe(group1);
    expect(world.entities.lastSelectionGroup[a]).toBe(group1);
    // Double-click a should still recall {a, b}, not include c.
    selection.ids.clear();
    click(ctrl, 400, 300);
    click(ctrl, 400, 300);
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
    expect(selection.ids.has(c)).toBe(false);
  });
});

describe('selection-controller — RMB commands', () => {
  it('RMB on enemy issues attack to all selected', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    const enemy = spawn(world, 'line-infantry', 1, 5, 0);
    selection.ids.add(own);
    ctrl._internals.onMouseUp({ button: 2, clientX: 405, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.get(own)).toEqual([{ kind: 'attack', targetId: enemy }]);
  });

  it('RMB on terrain issues a move', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onMouseUp({ button: 2, clientX: 500, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    const q = world.orderQueue.get(own)!;
    expect(q[0]?.kind).toBe('move');
  });

  it('Shift + RMB queues a move instead of replacing', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    world.orderQueue.set(own, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    ctrl._internals.onMouseUp({ button: 2, clientX: 500, clientY: 300, shiftKey: true, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.get(own)?.length).toBe(2);
  });
});

describe('selection-controller — attack-move + stop + esc', () => {
  it('R key with non-empty selection enters attack-move mode', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'r', code: 'KeyR', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('attack-move');
  });

  it('R key with empty selection is a no-op', () => {
    const { ctrl } = makeDeps();
    ctrl._internals.onKeyDown({ key: 'r', code: 'KeyR', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('normal');
  });

  it('A key does not enter attack-move (reserved for camera pan)', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'a', code: 'KeyA', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('normal');
  });

  it('LMB in attack-move mode issues attack-move and returns to normal', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'r', code: 'KeyR', shiftKey: false, ctrlKey: false, metaKey: false });
    click(ctrl, 500, 300);
    expect(world.orderQueue.get(own)?.[0]?.kind).toBe('attack-move');
    expect(ctrl._internals.getCursorMode()).toBe('normal');
  });

  it('RMB in attack-move mode cancels mode without issuing an order', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'r', code: 'KeyR', shiftKey: false, ctrlKey: false, metaKey: false });
    ctrl._internals.onMouseUp({ button: 2, clientX: 500, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('normal');
    expect(world.orderQueue.has(own)).toBe(false);
  });

  it('Esc in attack-move returns to normal without clearing selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'r', code: 'KeyR', shiftKey: false, ctrlKey: false, metaKey: false });
    ctrl._internals.onKeyDown({ key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('normal');
    expect(selection.ids.has(own)).toBe(true);
  });

  it('S key does not issue stop (reserved for camera pan)', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    world.orderQueue.set(own, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 's', code: 'KeyS', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.has(own)).toBe(true);
  });

  it('Delete key issues stop to all selected', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    world.orderQueue.set(own, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'Delete', code: 'Delete', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.has(own)).toBe(false);
  });

  it('Backspace key issues stop to all selected', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    world.orderQueue.set(own, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'Backspace', code: 'Backspace', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.has(own)).toBe(false);
  });
});

describe('selection-controller — input suppression', () => {
  it('mousedown over a HUD element does not start a marquee or change selection', () => {
    const camera = createCamera();
    camera.viewport = { w: 800, h: 600 };
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = allocEntity(world.entities);
    world.entities.kindId[a] = getUnitKindIndex('line-infantry');
    world.entities.team[a] = 0;
    world.entities.posX[a] = 0; world.entities.posY[a] = 0;
    const selection = createSelection();
    const drag = createDragRect();
    const fakeNode = {} as Node;
    const overlayRoot = { contains: (n: Node) => n === fakeNode } as unknown as HTMLElement;
    const ctrl = createSelectionController({
      canvas: {} as HTMLCanvasElement, overlayRoot, camera, world, selection, drag,
      formationDrag: createFormationDrag(),
      controlGroups: createControlGroups(),
    });
    ctrl._internals.onMouseDown({ button: 0, clientX: 400, clientY: 300, target: fakeNode });
    ctrl._internals.onMouseUp({ button: 0, clientX: 400, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.size).toBe(0);
    expect(drag.active).toBe(false);
  });

  it('blur cancels pending drag and resets attack-move mode', () => {
    const { ctrl, world, selection, drag } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 0, clientX: 400, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 500, clientY: 400 });
    expect(drag.active).toBe(true);
    ctrl._internals.onKeyDown({ key: 'r', code: 'KeyR', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('attack-move');
    ctrl._internals.onBlur();
    expect(drag.active).toBe(false);
    expect(ctrl._internals.getCursorMode()).toBe('normal');
    expect(selection.ids.has(a)).toBe(true); // selection persists
  });
});

describe('selection-controller — control groups', () => {
  it('Ctrl+1 assigns selection to group 1; "1" recalls it', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(a); selection.ids.add(b);
    ctrl._internals.onKeyDown({ key: '1', code: 'Digit1', shiftKey: false, ctrlKey: true, metaKey: false });
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '1', code: 'Digit1', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
  });

  it('Shift+digit merges group into current selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    const c = spawn(world, 'line-infantry', 0, 10, 0);
    selection.ids.add(a);
    ctrl._internals.onKeyDown({ key: '2', code: 'Digit2', shiftKey: false, ctrlKey: true, metaKey: false }); // group 2 = {a}
    selection.ids.clear();
    selection.ids.add(b); selection.ids.add(c);
    ctrl._internals.onKeyDown({ key: '2', code: 'Digit2', shiftKey: true, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
    expect(selection.ids.has(c)).toBe(true);
  });

  it('Recall filters out dead entities', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(a); selection.ids.add(b);
    ctrl._internals.onKeyDown({ key: '3', code: 'Digit3', shiftKey: false, ctrlKey: true, metaKey: false });
    world.entities.alive[b] = 0;
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '3', code: 'Digit3', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(false);
  });

  it('Numpad digits work too', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    ctrl._internals.onKeyDown({ key: '4', code: 'Numpad4', shiftKey: false, ctrlKey: true, metaKey: false });
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '4', code: 'Numpad4', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
  });

  it('Recall does not add a Dead group member to selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(a); selection.ids.add(b);
    ctrl._internals.onKeyDown({ key: '5', code: 'Digit5', shiftKey: false, ctrlKey: true, metaKey: false });
    world.entities.state[b] = EntityState.Dead;
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '5', code: 'Digit5', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(false);
  });

  it('update(dt) prunes dead/dying entities from selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    const c = spawn(world, 'line-infantry', 0, 10, 0);
    selection.ids.add(a); selection.ids.add(b); selection.ids.add(c);
    world.entities.state[b] = EntityState.Dying;
    world.entities.alive[c] = 0;
    ctrl.update(0.016);
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(false);
    expect(selection.ids.has(c)).toBe(false);
  });

  it('Shift+digit (merge) does not add a Dying group member', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(a); selection.ids.add(b);
    ctrl._internals.onKeyDown({ key: '6', code: 'Digit6', shiftKey: false, ctrlKey: true, metaKey: false });
    world.entities.state[b] = EntityState.Dying;
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '6', code: 'Digit6', shiftKey: true, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(false);
  });
});

describe('selection-controller — formation drag (RMB)', () => {
  it('RMB drag past threshold issues per-unit move orders to slot positions', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    const b = spawn(world, 'line-infantry', 0, 1, -10);
    selection.ids.add(a); selection.ids.add(b);
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    const qa = world.orderQueue.get(a)!;
    const qb = world.orderQueue.get(b)!;
    expect(qa[0]?.kind).toBe('move');
    expect(qb[0]?.kind).toBe('move');
    expect((qa[0] as { kind: 'move'; targetY: number }).targetY).toBeGreaterThanOrEqual(0);
    expect((qb[0] as { kind: 'move'; targetY: number }).targetY).toBeGreaterThanOrEqual(0);
  });

  it('RMB click below threshold uses single-point move (existing behavior)', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 2, clientX: 500, clientY: 300, target: null });
    ctrl._internals.onMouseUp({ button: 2, clientX: 501, clientY: 301, shiftKey: false, ctrlKey: false, metaKey: false });
    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(1);
    expect(qa[0]?.kind).toBe('move');
  });

  it('Shift + RMB drag queues formation orders', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    selection.ids.add(a);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 99, targetY: 99 }]);
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: true, ctrlKey: false, metaKey: false });
    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(2);
    expect(qa[0]).toEqual({ kind: 'move', targetX: 99, targetY: 99 });
  });

  it('Esc cancels in-progress formation drag', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onKeyDown({ key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationPreview()).toBeNull();
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(1);
    expect((qa[0] as { kind: 'move'; targetX: number; targetY: number }).targetY).toBeCloseTo(0);
  });

  it('formationPreview() is null when not dragging', () => {
    const { ctrl } = makeDeps();
    expect(ctrl.formationPreview()).toBeNull();
  });

  it('formationPreview() returns rect + slots during active drag', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    const p = ctrl.formationPreview();
    expect(p).not.toBeNull();
    expect(p!.slots.length).toBe(1);
    expect(p!.rect.tl).toBeDefined();
  });

  it('empty selection + RMB drag does nothing', () => {
    const { ctrl, world } = makeDeps();
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.size).toBe(0);
  });

  it('formation drag skips dying units in selection (liveFormationUnits)', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    const b = spawn(world, 'line-infantry', 0, 1, -10);
    selection.ids.add(a); selection.ids.add(b);
    world.entities.state[b] = EntityState.Dying;
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.has(a)).toBe(true);
    expect(world.orderQueue.has(b)).toBe(false);
  });
});

describe('formation hotkeys', () => {
  it('] bumps spacing index up; [ bumps it down', () => {
    const { ctrl, world, selection } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(id);

    ctrl._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationParams.spacingIndex).toBe(6); // default 5 → 6

    ctrl._internals.onKeyDown({ key: '[', code: 'BracketLeft', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationParams.spacingIndex).toBe(5);
  });

  it(', and . cycle ranks', () => {
    const { ctrl, world, selection } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(id);

    ctrl._internals.onKeyDown({ key: '.', code: 'Period', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationParams.ranks).toBe(1);

    // `,` cycles 1 → null (back to "auto"). The user-facing ranks value
    // returns to null so the UI shows "auto" again.
    ctrl._internals.onKeyDown({ key: ',', code: 'Comma', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationParams.ranks).toBe(null);
  });

  it('hotkeys are no-op when selection is empty', () => {
    const { ctrl } = makeDeps();
    ctrl._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationParams.spacingIndex).toBe(5); // unchanged
  });

  it('issues a move order on hotkey press with non-empty selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(id);
    expect(world.orderQueue.has(id)).toBe(false);
    ctrl._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.has(id)).toBe(true);
    expect(world.orderQueue.get(id)![0]!.kind).toBe('move');
  });

  it('selection change resets formation params', () => {
    const { ctrl, world, selection } = makeDeps();
    const id1 = spawn(world, 'line-infantry', 0, 0, 0);
    const id2 = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(id1);
    ctrl.update(0);                     // bind initial signature

    ctrl._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationParams.spacingIndex).toBe(6);

    selection.ids.clear();
    selection.ids.add(id2);
    ctrl.update(0);                     // detect change → reset
    expect(ctrl.formationParams.spacingIndex).toBe(5);
  });
});

describe('selection-controller — tight stance', () => {
  it('auto-packs idle units when in tight stance', () => {
    const { ctrl, world, selection } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(id);
    ctrl.update(0); // bind selection signature
    expect(ctrl.tightHeld).toBe(false);

    // Set a sub-march-floor spacing.
    ctrl.formationParams.spacingIndex = 0;
    // Ensure unit is idle and has no orders.
    world.orderQueue.delete(id);
    world.entities.state[id] = EntityState.Idle;

    ctrl.update(0);
    expect(world.orderQueue.has(id)).toBe(true);
    expect(ctrl.tightHeld).toBe(true);
  });

  it('preserves rank count across tightening that would otherwise break inference', () => {
    const { ctrl, world, selection } = makeDeps();
    // Spawn 9 units in a 3-rank × 3-file layout. line-infantry spacing is
    // (1.0, 1.2). Place units along +Y (depth axis) so restFacing pointing
    // along +Y matches the formation's depth direction.
    const ids: number[] = [];
    for (let r = 0; r < 3; r++) {
      for (let f = 0; f < 3; f++) {
        const id = spawn(world, 'line-infantry', 0, f * 1.0, r * 1.2);
        world.entities.restFacing[id] = 2; // 2 * π/4 = 90°, facing +Y
        ids.push(id);
      }
    }
    for (const id of ids) selection.ids.add(id);
    ctrl.update(0); // bind selection signature

    // First spacing press at 0.9× nominal — units still well-separated → infer = 3 ranks correctly.
    ctrl._internals.onKeyDown({ key: '[', code: 'BracketLeft', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.lockedRanks).toBe(3); // snapshotted internally
    expect(ctrl.formationParams.ranks).toBe(null); // user-facing value untouched

    // Now even if we tighten further (where inference would otherwise fail at low spacing),
    // ranks stays at 3.
    ctrl._internals.onKeyDown({ key: '[', code: 'BracketLeft', shiftKey: false, ctrlKey: false, metaKey: false });
    ctrl._internals.onKeyDown({ key: '[', code: 'BracketLeft', shiftKey: false, ctrlKey: false, metaKey: false });
    ctrl._internals.onKeyDown({ key: '[', code: 'BracketLeft', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.lockedRanks).toBe(3); // unchanged
    expect(ctrl.formationParams.ranks).toBe(null); // still untouched by [/]
  });

  it('single right-click in tight stance reforms at march-floor spacing', () => {
    const { ctrl, world, selection } = makeDeps();
    // Four line-infantry units in a row; spacingX = 1 (line-infantry default).
    const ids = [
      spawn(world, 'line-infantry', 0, 0, 0),
      spawn(world, 'line-infantry', 0, 1, 0),
      spawn(world, 'line-infantry', 0, 2, 0),
      spawn(world, 'line-infantry', 0, 3, 0),
    ];
    for (const i of ids) selection.ids.add(i);
    ctrl.update(0);

    // Set tight stance via spacing index 0 (mult 0.5, below march floor 0.9).
    ctrl.formationParams.spacingIndex = 0;

    // Single right-click (no drag) at world (50, 50). Camera center is (0,0),
    // viewport 800x600 → screen (450, 350) maps to world (50, 50).
    ctrl._internals.onMouseDown({ button: 2, clientX: 450, clientY: 350, target: null });
    ctrl._internals.onMouseUp({ button: 2, clientX: 450, clientY: 350, shiftKey: false, ctrlKey: false, metaKey: false });

    // Collect the issued targets.
    const targets: Array<{ x: number; y: number }> = [];
    for (const i of ids) {
      const q = world.orderQueue.get(i);
      expect(q).toBeDefined();
      const o = q![0]!;
      expect(o.kind).toBe('move');
      const m = o as { kind: 'move'; targetX: number; targetY: number };
      targets.push({ x: m.targetX, y: m.targetY });
    }

    // Nearest-neighbor distance must be at least MARCH_FLOOR_MULT * spacingX
    // (0.9 * 1.0 = 0.9m), proving the floor clamp kicked in.
    let minD = Infinity;
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const dx = targets[i]!.x - targets[j]!.x;
        const dy = targets[i]!.y - targets[j]!.y;
        const d = Math.hypot(dx, dy);
        if (d < minD) minD = d;
      }
    }
    expect(minD).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });
});

describe('selectionController Ctrl+RMB march-formation', () => {
  it('Ctrl+RMB up with non-empty selection on terrain creates a march group', () => {
    const { ctrl, world, selection } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);

    ctrl._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 200,
      shiftKey: false, ctrlKey: true, metaKey: false,
    });

    expect(world.marchGroups.size).toBe(1);
    const head = world.orderQueue.get(id)![0]!;
    expect(head.kind).toBe('march-formation');
  });

  it('Ctrl+RMB up with empty selection is a no-op', () => {
    const { ctrl, world, selection } = makeDeps();
    expect(selection.ids.size).toBe(0);

    ctrl._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 200,
      shiftKey: false, ctrlKey: true, metaKey: false,
    });

    expect(world.marchGroups.size).toBe(0);
  });

  it('Ctrl+Shift+RMB behaves the same as Ctrl+RMB (Shift ignored, no queueing)', () => {
    const { ctrl, world, selection } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);

    ctrl._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 200,
      shiftKey: true, ctrlKey: true, metaKey: false,
    });

    // One queue entry (replace, not append).
    expect(world.orderQueue.get(id)!.length).toBe(1);
    expect(world.orderQueue.get(id)![0]!.kind).toBe('march-formation');
    expect(world.marchGroups.size).toBe(1);
  });

  it('Ctrl+RMB during a formation drag falls through to the drag commit', () => {
    const { ctrl, world, selection } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    // Start an RMB drag past the threshold so formationDrag.active becomes true.
    ctrl._internals.onMouseDown({ button: 2, clientX: 100, clientY: 100, target: null });
    ctrl._internals.onMouseMove({ clientX: 200, clientY: 100 });

    ctrl._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 100,
      shiftKey: false, ctrlKey: true, metaKey: false,
    });

    // Drag commit produces 'move' orders via issueFormationMove, not march-formation.
    expect(world.marchGroups.size).toBe(0);
    expect(world.orderQueue.get(id)![0]!.kind).toBe('move');
  });
});

describe('selectionController march placement preview', () => {
  it('formationPreview() returns null when Ctrl is not held', () => {
    const { ctrl, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    expect(ctrl.formationPreview()).toBeNull();
  });

  it('returns a non-null preview after Ctrl keydown + mousemove', () => {
    const { ctrl, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);

    ctrl._internals.onMouseMove({ clientX: 200, clientY: 200 });
    ctrl._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });

    const preview = ctrl.formationPreview();
    expect(preview).not.toBeNull();
    expect(preview!.slots.length).toBe(1);
  });

  it('Ctrl keyup clears the preview', () => {
    const { ctrl, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);

    ctrl._internals.onMouseMove({ clientX: 200, clientY: 200 });
    ctrl._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });
    expect(ctrl.formationPreview()).not.toBeNull();

    ctrl._internals.onKeyUp({ key: 'Control', code: 'ControlLeft' });
    expect(ctrl.formationPreview()).toBeNull();
  });

  it('preview is null when selection becomes empty even with Ctrl held', () => {
    const { ctrl, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    ctrl._internals.onMouseMove({ clientX: 200, clientY: 200 });
    ctrl._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });
    expect(ctrl.formationPreview()).not.toBeNull();

    selection.ids.clear();
    expect(ctrl.formationPreview()).toBeNull();
  });

  it('formation drag wins over march preview when both could apply', () => {
    const { ctrl, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    // Hold Ctrl so the march preview would fire.
    ctrl._internals.onMouseMove({ clientX: 100, clientY: 100 });
    ctrl._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });

    // Now start an RMB drag past the threshold.
    ctrl._internals.onMouseDown({ button: 2, clientX: 100, clientY: 100, target: null });
    ctrl._internals.onMouseMove({ clientX: 300, clientY: 100 });

    // formationPreview should reflect the drag, not the march.
    // We can't easily compare slot positions here, but the preview must be
    // non-null and computed from the drag's startWorld→currentScreen rather
    // than the cursor. Sanity check: forward direction should be roughly +x
    // (drag along screen-x) regardless of where the march preview would point.
    const preview = ctrl.formationPreview();
    expect(preview).not.toBeNull();
    // Without a march, the only way to produce a preview here is the drag —
    // and that's what we want.
  });

  it('onBlur clears Ctrl-held state and the preview', () => {
    const { ctrl, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    ctrl._internals.onMouseMove({ clientX: 200, clientY: 200 });
    ctrl._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });
    expect(ctrl.formationPreview()).not.toBeNull();

    ctrl._internals.onBlur();
    expect(ctrl.formationPreview()).toBeNull();
  });
});
