import type { Camera } from '../render/camera';
import { screenToWorld } from '../render/camera';
import type { World } from '../sim/world';
import { PLAYER_TEAM } from '../sim/player';
import { hitTestPoint, hitTestRect, findSameKindInView, type Selection, type DragRect, type ControlGroups, type FormationDrag, type FormationPreview } from './selection';
import { issueMove, issueAttack, issueAttackMove, issueStop, issueRegroup, issueFormationMove, issueReformInPlace } from './commands';
import { computeFormationSlots, assignFormationSlots, liveFormationUnits as materializeUnits } from './formation';
import { isDead } from '../sim/entities';
import {
  createFormationParams, resetFormationParams,
  bumpSpacing, bumpRanks, spacingMultiplier,
  type FormationParams,
} from './formation-params';
import type { Particles } from '../particles/particles';
import { emitOrderPuff } from '../particles/emitters';
import type { Vec2 } from '../util/math';

export type CursorMode = 'normal' | 'attack-move';

export interface SelectionControllerDeps {
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
  camera: Camera;
  world: World;
  selection: Selection;
  drag: DragRect;
  formationDrag: FormationDrag;
  controlGroups: ControlGroups;
  /** Optional — when present, a small puff is emitted at each issued world point. */
  particles?: Particles;
  /** Optional — when present, click-move targets are previewed at each unit's destination. */
  movePreview?: { add(targets: Vec2[]): void };
}

export interface SelectionController {
  readonly cursorMode: CursorMode;
  readonly formationParams: FormationParams;
  /** Called once per frame. Currently a no-op; reserved for per-frame work. */
  update(dt: number): void;
  destroy(): void;
  /** Live preview of the formation being drawn, or null when no drag is active. */
  formationPreview(): FormationPreview | null;
  /** Test seam — exposes pure handlers for unit tests. Do not use from app code. */
  readonly _internals: ControllerInternals;
}

interface ControllerInternals {
  onMouseDown(e: { button: number; clientX: number; clientY: number; target: EventTarget | null }): void;
  onMouseMove(e: { clientX: number; clientY: number }): void;
  onMouseUp(e: { button: number; clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void;
  onKeyDown(e: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void;
  onBlur(): void;
  getCursorMode(): CursorMode;
}

const DRAG_THRESHOLD_PX = 4;

export function createSelectionController(deps: SelectionControllerDeps): SelectionController {
  const { canvas, overlayRoot, camera, world, selection, drag, formationDrag, controlGroups } = deps;
  const groups = controlGroups.groups;

  function digitFromCode(code: string): number | null {
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      return Number.isInteger(n) ? n : null;
    }
    if (code.startsWith('Numpad')) {
      const n = Number(code.slice(6));
      return Number.isInteger(n) ? n : null;
    }
    return null;
  }

  function puff(x: number, y: number) {
    if (deps.particles) emitOrderPuff(deps.particles, x, y);
  }

  let cursorMode: CursorMode = 'normal';
  const formationParams = createFormationParams();
  let lastSelectionSig = 0;
  let pendingClickStart: { x: number; y: number } | null = null;
  let pendingFormationStart: { x: number; y: number } | null = null;
  let lastClick: { id: number; t: number; x: number; y: number } | null = null;
  const DOUBLE_CLICK_MS = 300;
  const DOUBLE_CLICK_PX = 6;

  function viewRect() {
    const halfW = camera.viewport.w / (2 * camera.zoom);
    const halfH = camera.viewport.h / (2 * camera.zoom);
    return {
      x0: camera.center.x - halfW, y0: camera.center.y - halfH,
      x1: camera.center.x + halfW, y1: camera.center.y + halfH,
    };
  }

  function selectSameKindAs(id: number): void {
    const e = world.entities;
    const team = e.team[id]!;
    const kind = e.kindId[id]!;
    const ids = findSameKindInView(world, kind, viewRect(), { team });
    selection.ids.clear();
    for (const x of ids) selection.ids.add(x);
  }

  function isOnHud(target: EventTarget | null): boolean {
    return target != null && overlayRoot.contains(target as Node);
  }

  function averageFacing(): { x: number; y: number } {
    const e = world.entities;
    let sx = 0, sy = 0, n = 0;
    for (const id of selection.ids) {
      if (e.alive[id] !== 1) continue;
      const a = (e.restFacing[id]! * Math.PI) / 4;
      sx += Math.cos(a); sy += Math.sin(a); n++;
    }
    if (n === 0) return { x: 1, y: 0 };
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) return { x: 1, y: 0 };
    return { x: sx / len, y: sy / len };
  }

  function reformNow(): void {
    const fwd = averageFacing();
    issueReformInPlace(world, selection, fwd, spacingMultiplier(formationParams), formationParams.ranks);
  }

  function onMouseDown(e: { button: number; clientX: number; clientY: number; target: EventTarget | null }): void {
    if (isOnHud(e.target)) return;
    if (e.button === 0) {
      pendingClickStart = { x: e.clientX, y: e.clientY };
      drag.startWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      drag.currentScreen = { x: e.clientX, y: e.clientY };
      drag.active = false;
      return;
    }
    if (e.button === 2) {
      pendingFormationStart = { x: e.clientX, y: e.clientY };
      formationDrag.startWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      formationDrag.currentScreen = { x: e.clientX, y: e.clientY };
      formationDrag.active = false;
    }
  }

  function onMouseMove(e: { clientX: number; clientY: number }): void {
    if (pendingClickStart) {
      drag.currentScreen = { x: e.clientX, y: e.clientY };
      const dx = e.clientX - pendingClickStart.x;
      const dy = e.clientY - pendingClickStart.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.active = true;
    }
    if (pendingFormationStart) {
      formationDrag.currentScreen = { x: e.clientX, y: e.clientY };
      const dx = e.clientX - pendingFormationStart.x;
      const dy = e.clientY - pendingFormationStart.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) formationDrag.active = true;
    }
  }

  function onMouseUp(e: { button: number; clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    if (e.button === 0) {
      if (cursorMode === 'attack-move') {
        if (!pendingClickStart) return;
        // Bare click in attack-move mode (drag intentionally treated as click for simplicity).
        const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
        issueAttackMove(world, selection, w, { queue: e.shiftKey });
        puff(w.x, w.y);
        cursorMode = 'normal';
        drag.active = false;
        pendingClickStart = null;
        return;
      }
      if (!pendingClickStart) return;
      const additive = e.shiftKey;
      if (drag.active) {
        const a = drag.startWorld;
        const b = screenToWorld(camera, drag.currentScreen);
        const own = hitTestRect(world, a.x, a.y, b.x, b.y, { team: PLAYER_TEAM });
        let picked = own;
        if (own.length === 0) {
          // Fallback: closest single non-own-team unit to the box center.
          const all = hitTestRect(world, a.x, a.y, b.x, b.y);
          const enemies = all.filter(id => world.entities.team[id] !== PLAYER_TEAM);
          if (enemies.length > 0) {
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            let bestId = enemies[0]!;
            let bestD2 = Infinity;
            for (const id of enemies) {
              const dx = world.entities.posX[id]! - cx;
              const dy = world.entities.posY[id]! - cy;
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD2) { bestD2 = d2; bestId = id; }
            }
            picked = [bestId];
          }
        }
        if (!additive) selection.ids.clear();
        for (const id of picked) selection.ids.add(id);
      } else {
        const wPoint = screenToWorld(camera, { x: e.clientX, y: e.clientY });
        const idAtPoint = hitTestPoint(world, wPoint);

        // Ctrl-click: select all of same kind in viewport.
        // Does NOT seed lastClick — a follow-up plain click should be a fresh click,
        // not a repeated same-kind selection via the double-click window.
        if (e.ctrlKey && idAtPoint !== -1) {
          selectSameKindAs(idAtPoint);
          lastClick = null;
          drag.active = false;
          pendingClickStart = null;
          return;
        }

        // Double-click: same as Ctrl-click on the same id within the timing window.
        // Only applies to plain clicks (no Shift), so Shift+click+Shift+click is not intercepted.
        if (!additive && idAtPoint !== -1 && lastClick && lastClick.id === idAtPoint) {
          const dt = performance.now() - lastClick.t;
          const dx = e.clientX - lastClick.x;
          const dy = e.clientY - lastClick.y;
          if (dt <= DOUBLE_CLICK_MS && Math.hypot(dx, dy) <= DOUBLE_CLICK_PX) {
            selectSameKindAs(idAtPoint);
            lastClick = { id: idAtPoint, t: performance.now(), x: e.clientX, y: e.clientY };
            drag.active = false;
            pendingClickStart = null;
            return;
          }
        }
        // Only record lastClick for plain (non-additive) clicks, so Shift+click doesn't seed a double-click window.
        if (!additive) {
          lastClick = idAtPoint !== -1 ? { id: idAtPoint, t: performance.now(), x: e.clientX, y: e.clientY } : null;
        }

        if (additive) {
          if (idAtPoint !== -1) {
            if (selection.ids.has(idAtPoint)) selection.ids.delete(idAtPoint);
            else selection.ids.add(idAtPoint);
          }
        } else {
          selection.ids.clear();
          if (idAtPoint !== -1) selection.ids.add(idAtPoint);
        }
      }
      drag.active = false;
      pendingClickStart = null;
      return;
    }
    if (e.button === 2) {
      if (cursorMode === 'attack-move') {
        cursorMode = 'normal';
        pendingFormationStart = null;
        formationDrag.active = false;
        return;
      }
      const opts = { queue: e.shiftKey };

      if (formationDrag.active && pendingFormationStart) {
        const startW = formationDrag.startWorld;
        const endW = screenToWorld(camera, formationDrag.currentScreen);
        const units = materializeUnits(world, selection.ids);
        if (units.length > 0) {
          const { slots, forward } = computeFormationSlots({
            units, startW, endW,
            spacingMult: spacingMultiplier(formationParams),
            ranksOverride: formationParams.ranks,
          });
          const targets = assignFormationSlots(units, slots, forward);
          const assignments = units.map((u, i) => ({ id: u.id, target: targets[i]! }));
          issueFormationMove(world, assignments, opts);
          const mx = (startW.x + endW.x) / 2;
          const my = (startW.y + endW.y) / 2;
          puff(mx, my);
        }
        pendingFormationStart = null;
        formationDrag.active = false;
        return;
      }

      pendingFormationStart = null;
      formationDrag.active = false;

      const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      const hit = hitTestPoint(world, w);
      if (hit !== -1 && world.entities.team[hit] !== PLAYER_TEAM) {
        issueAttack(world, selection, hit, opts);
        puff(w.x, w.y);
      } else {
        const assignments = issueMove(world, selection, w, opts);
        puff(w.x, w.y);
        if (deps.movePreview && assignments.length > 0) {
          deps.movePreview.add(assignments.map(a => a.target));
        }
      }
      return;
    }
  }

  function onKeyDown(e: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    if (e.key === 'Escape') {
      if (formationDrag.active) {
        pendingFormationStart = null;
        formationDrag.active = false;
        return;
      }
      if (cursorMode !== 'normal') {
        cursorMode = 'normal';
        return;
      }
      selection.ids.clear();
      return;
    }
    const digit = digitFromCode(e.code);
    if (digit !== null) {
      // Ignore if a text input is focused (gate against future regressions).
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.ctrlKey || e.metaKey) {
        // Assign current selection to the group.
        groups[digit] = new Set(selection.ids);
        return;
      }
      if (e.shiftKey) {
        // Merge group into current selection (alive only).
        for (const id of groups[digit]!) {
          if (world.entities.alive[id] === 1 && !isDead(world.entities, id)) selection.ids.add(id);
        }
        return;
      }
      // Recall: replace selection with group (alive only).
      selection.ids.clear();
      for (const id of groups[digit]!) {
        if (world.entities.alive[id] === 1 && !isDead(world.entities, id)) selection.ids.add(id);
      }
      return;
    }

    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (selection.ids.size === 0) return;
      bumpSpacing(formationParams, e.code === 'BracketLeft' ? -1 : +1);
      reformNow();
      return;
    }
    if (e.code === 'Comma' || e.code === 'Period') {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (selection.ids.size === 0) return;
      bumpRanks(formationParams, e.code === 'Comma' ? -1 : +1);
      reformNow();
      return;
    }

    // Letter hotkeys — guard with code so they're layout-independent and not affected by Shift.
    if (e.code === 'KeyR') {
      if (selection.ids.size > 0 && cursorMode === 'normal') cursorMode = 'attack-move';
      return;
    }
    if (e.code === 'KeyF') {
      issueRegroup(world, selection);
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      issueStop(world, selection);
      return;
    }
  }

  function onBlur(): void {
    pendingClickStart = null;
    drag.active = false;
    pendingFormationStart = null;
    formationDrag.active = false;
    cursorMode = 'normal';
  }

  // DOM bindings — narrow event types pass through to the pure handlers above.
  const md = (e: MouseEvent) => onMouseDown({ button: e.button, clientX: e.clientX, clientY: e.clientY, target: e.target });
  const mm = (e: MouseEvent) => onMouseMove({ clientX: e.clientX, clientY: e.clientY });
  const mu = (e: MouseEvent) => onMouseUp({ button: e.button, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  const kd = (e: KeyboardEvent) => onKeyDown({ key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  const bl = () => onBlur();

  if (typeof window !== 'undefined') {
    window.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    window.addEventListener('keydown', kd);
    window.addEventListener('blur', bl);
  }

  function formationPreview(): FormationPreview | null {
    if (!formationDrag.active) return null;
    if (cursorMode !== 'normal') return null;
    const units = materializeUnits(world, selection.ids);
    if (units.length === 0) return null;
    const startW = formationDrag.startWorld;
    const endW = screenToWorld(camera, formationDrag.currentScreen);
    const { slots, rect } = computeFormationSlots({
      units, startW, endW,
      spacingMult: spacingMultiplier(formationParams),
      ranksOverride: formationParams.ranks,
    });
    return { rect, slots };
  }

  return {
    get cursorMode() { return cursorMode; },
    get formationParams() { return formationParams; },
    formationPreview,
    update(_dt) {
      const e = world.entities;
      for (const id of selection.ids) {
        if (e.alive[id] !== 1 || isDead(e, id)) selection.ids.delete(id);
      }
      if (cursorMode === 'attack-move' && selection.ids.size === 0) cursorMode = 'normal';
      canvas.style.cursor = cursorMode === 'attack-move' ? 'crosshair' : 'default';
      let sig = selection.ids.size;
      let first = -1, last = -1;
      for (const id of selection.ids) {
        if (first === -1) first = id;
        last = id;
      }
      sig = (sig * 2654435761) ^ first ^ (last << 1);
      if (sig !== lastSelectionSig) {
        resetFormationParams(formationParams);
        lastSelectionSig = sig;
      }
    },
    destroy() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousedown', md);
        window.removeEventListener('mousemove', mm);
        window.removeEventListener('mouseup', mu);
        window.removeEventListener('keydown', kd);
        window.removeEventListener('blur', bl);
      }
    },
    _internals: { onMouseDown, onMouseMove, onMouseUp, onKeyDown, onBlur, getCursorMode: () => cursorMode },
  };
}
