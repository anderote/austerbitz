import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
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
  const canvas = {} as unknown as HTMLCanvasElement;
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

  it('Two LMB clicks within 300ms on the same unit behave like Ctrl+click', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    click(ctrl, 400, 300);
    click(ctrl, 400, 300);
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
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

  it('S key issues stop to all selected', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    world.orderQueue.set(own, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 's', code: 'KeyS', shiftKey: false, ctrlKey: false, metaKey: false });
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
});
