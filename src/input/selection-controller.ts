import type { Camera } from '../render/camera';
import { screenToWorld } from '../render/camera';
import type { World } from '../sim/world';
import { PLAYER_TEAM } from '../sim/player';
import { hitTestPoint, hitTestRect, findSameKindInView, type Selection, type DragRect, type ControlGroups, type FormationDrag, type FormationPreview } from './selection';
import { issueMove, issueAttack, issueAttackMove, issueStop, issueFormationMove, issueReformInPlace, issueReformAtTarget, issueMarchFormation, issueHurryToSlots, issueNudge } from './commands';
import { computeFormationSlots, assignFormationSlots, liveFormationUnits as materializeUnits, inferRanksFromPositions, computeMarchSlots } from './formation';
import { isDead, EntityState } from '../sim/entities';
import {
  createFormationParams, resetFormationParams,
  bumpSpacing, bumpRanks, spacingMultiplier, minSpacingIndexForMult,
  MARCH_FLOOR_MULT, isTightStance,
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
  /** True when units are packed (or about to pack) at a sub-march-floor spacing. */
  readonly tightHeld: boolean;
  /** Hidden rank snapshot used to preserve the rectangle across [/] presses. */
  readonly lockedRanks: number | null;
  /** When true, single right-click runs; when false (default), single right-click walks. Toggled by KeyT. */
  readonly runMode: boolean;
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
  onKeyUp(e: { key: string; code: string }): void;
  onBlur(): void;
  getCursorMode(): CursorMode;
}

const DRAG_THRESHOLD_PX = 4;
// World-space step per arrow-key nudge. OS key-repeat accumulates additional
// presses, and issueNudge compounds against the previous move target so a held
// key produces continuous motion rather than locking to (pos + step).
const NUDGE_STEP_WORLD = 2;

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
  let tightHeld = false;
  let ctrlHeld = false;
  let lastCursorScreen: { x: number; y: number } | null = null;
  let lastSelectionSig = 0;
  let pendingClickStart: { x: number; y: number } | null = null;
  let pendingFormationStart: { x: number; y: number } | null = null;
  let lastClick: { id: number; t: number; x: number; y: number } | null = null;
  // Most recent empty-ground RMB that issued a move. Used to detect a double
  // right-click within DOUBLE_CLICK_MS/PX, which overrides the current run/walk
  // mode and forces a run. Only seeded on plain RMB moves (not attack, march,
  // or modifier-driven branches).
  let lastRightClick: { t: number; x: number; y: number } | null = null;
  // Default movement mode. false = walk (slower, walking animation),
  // true = run (full base speed, running animation). Toggled with KeyT.
  // Double right-click overrides this and always runs.
  let runMode = false;
  // Monotonic counter for box-select groups. Each completed box-select
  // mints a fresh id and stamps every selected unit's lastSelectionGroup
  // so a later double-click on any of them recalls the group.
  let nextSelectionGroupId = 1;
  // Hold-F = "hurry to your slot." Each frame F is held, every selected unit
  // is re-issued a full-speed move toward the position/facing it's already
  // trying to reach (current move/march-formation target, or rest anchor).
  // Does not change formation; just pre-empts the slow settle drift and
  // dissolves any march pacing.
  let fHeld = false;
  // Hidden rank snapshot used to preserve the visual rectangle across spacing
  // changes when the user has not set an explicit rank override. Separate from
  // formationParams.ranks (which is user-facing and shown as "auto" when null)
  // so that pressing [ ] never appears to change ranks in the UI.
  let lockedRanks: number | null = null;
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

  function selectGroupOf(id: number): void {
    const e = world.entities;
    const groupId = e.lastSelectionGroup[id]!;
    if (groupId === -1) return;
    selection.ids.clear();
    for (let i = 0; i < e.count; i++) {
      const otherId = e.aliveIds[i]!;
      if (e.lastSelectionGroup[otherId] === groupId && !isDead(e, otherId)) {
        selection.ids.add(otherId);
      }
    }
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

  function clearGridHold(): void {
    fHeld = false;
  }

  // Resolve the rank count to reform with. User override (formationParams.ranks)
  // wins. Otherwise fall back to the hidden snapshot — captured once from the
  // current positions — so subsequent spacing changes preserve the rectangle
  // even after units pack tight (which breaks live inference).
  function effectiveReformRanks(fwd: { x: number; y: number }): number | null {
    if (formationParams.ranks != null) return formationParams.ranks;
    if (lockedRanks == null) {
      const units = materializeUnits(world, selection.ids);
      if (units.length > 0) lockedRanks = inferRanksFromPositions(units, fwd);
    }
    return lockedRanks;
  }

  function reformNow(): void {
    const fwd = averageFacing();
    const ranks = effectiveReformRanks(fwd);
    issueReformInPlace(world, selection, fwd, spacingMultiplier(formationParams), ranks);
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
    lastCursorScreen = { x: e.clientX, y: e.clientY };
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
        tightHeld = false;
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
        // Mint a fresh group id for the resulting selection so that a future
        // double-click on any member re-selects the whole group. Skip when
        // nothing new was picked (e.g. a no-op shift+drag) to avoid churning
        // the existing group ids.
        if (picked.length > 0 && selection.ids.size > 0) {
          const groupId = nextSelectionGroupId++;
          const ent = world.entities;
          for (const id of selection.ids) ent.lastSelectionGroup[id] = groupId;
        }
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

        // Double-click: recall the unit's last box-selected group.
        // Only applies to plain clicks (no Shift), so Shift+click+Shift+click is not intercepted.
        // Falls through to plain single-click when the unit has no remembered
        // group — Ctrl+click is the explicit gesture for select-same-kind.
        if (!additive && idAtPoint !== -1 && lastClick && lastClick.id === idAtPoint
            && world.entities.lastSelectionGroup[idAtPoint]! !== -1) {
          const dt = performance.now() - lastClick.t;
          const dx = e.clientX - lastClick.x;
          const dy = e.clientY - lastClick.y;
          if (dt <= DOUBLE_CLICK_MS && Math.hypot(dx, dy) <= DOUBLE_CLICK_PX) {
            selectGroupOf(idAtPoint);
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
          // Drag tool is independent of the hotkey rank lock — drag length
          // alone determines the rank count.
          const { slots, forward } = computeFormationSlots({
            units, startW, endW,
            spacingMult: Math.max(spacingMultiplier(formationParams), MARCH_FLOOR_MULT),
            ranksOverride: null,
          });
          const targets = assignFormationSlots(units, slots, forward);
          // Unit facing is perpendicular to the front-rank axis, opposite the
          // depth direction so units face away from the back of the formation.
          const face = { x: forward.y, y: -forward.x };
          const assignments = units.map((u, i) => ({ id: u.id, target: targets[i]!, face }));
          issueFormationMove(world, assignments, opts);
          const mx = (startW.x + endW.x) / 2;
          const my = (startW.y + endW.y) / 2;
          puff(mx, my);
          tightHeld = false;
        }
        pendingFormationStart = null;
        formationDrag.active = false;
        lastRightClick = null;
        return;
      }

      pendingFormationStart = null;
      formationDrag.active = false;

      const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });

      // Ctrl + RMB: march in formation. Skips queueing (Shift is ignored here).
      if ((e.ctrlKey || e.metaKey) && selection.ids.size > 0) {
        issueMarchFormation(world, selection, w, formationParams);
        puff(w.x, w.y);
        lastRightClick = null;
        return;
      }

      const hit = hitTestPoint(world, w);
      if (hit !== -1 && world.entities.team[hit] !== PLAYER_TEAM) {
        issueAttack(world, selection, hit, opts);
        puff(w.x, w.y);
        tightHeld = false;
        // Attack on enemy isn't part of a movement double-click sequence.
        lastRightClick = null;
      } else {
        // Walk vs run: single click follows runMode, but a double right-click
        // (within the same window used for left-click double-clicks) overrides
        // and forces a run regardless of mode.
        let walk = !runMode;
        if (lastRightClick) {
          const dt = performance.now() - lastRightClick.t;
          const dx = e.clientX - lastRightClick.x;
          const dy = e.clientY - lastRightClick.y;
          if (dt <= DOUBLE_CLICK_MS && Math.hypot(dx, dy) <= DOUBLE_CLICK_PX) {
            walk = false;
          }
        }
        const moveOpts = { ...opts, walk };
        let assignments;
        if (isTightStance(formationParams)) {
          const fwd = averageFacing();
          const ranks = effectiveReformRanks(fwd);
          assignments = issueReformAtTarget(world, selection, w, fwd, MARCH_FLOOR_MULT, ranks, moveOpts);
        } else {
          assignments = issueMove(world, selection, w, moveOpts);
        }
        puff(w.x, w.y);
        if (deps.movePreview && assignments.length > 0) {
          deps.movePreview.add(assignments.map(a => a.target));
        }
        tightHeld = false;
        lastRightClick = { t: performance.now(), x: e.clientX, y: e.clientY };
      }
      return;
    }
  }

  function onKeyDown(e: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    if (e.key === 'Control' || e.key === 'Meta') {
      ctrlHeld = true;
      // fall through; other modifiers may still drive other handlers below
    }
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

    if (e.code === 'KeyT') {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      runMode = !runMode;
      return;
    }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (selection.ids.size === 0) return;
      // Floor: never pack units inside their own body radius.
      const units = materializeUnits(world, selection.ids);
      let minMult = 0;
      for (const u of units) {
        const r = u.bodyRadius ?? 0;
        const m = (2 * r) / Math.min(u.spacingX, u.spacingY);
        if (m > minMult) minMult = m;
      }
      const floorIdx = minSpacingIndexForMult(minMult);
      bumpSpacing(formationParams, e.code === 'BracketLeft' ? -1 : +1, floorIdx);
      reformNow();
      tightHeld = isTightStance(formationParams);
      return;
    }
    if (e.code === 'Comma' || e.code === 'Period') {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (selection.ids.size === 0) return;
      bumpRanks(formationParams, e.code === 'Comma' ? -1 : +1);
      // Drop the hidden snapshot — user is taking explicit control of ranks,
      // and if they cycle back to "auto" we want a fresh inference.
      lockedRanks = null;
      reformNow();
      tightHeld = isTightStance(formationParams);
      return;
    }

    // Letter hotkeys — guard with code so they're layout-independent and not affected by Shift.
    if (e.code === 'KeyR') {
      if (selection.ids.size > 0 && cursorMode === 'normal') cursorMode = 'attack-move';
      return;
    }
    if (e.code === 'KeyF') {
      // F = "hurry to your slot." Each frame F is held, every selected unit
      // gets pushed toward the position/facing it's already trying to reach
      // (active move/march target, or rest anchor) at full base speed.
      // Does NOT reform — formation, ranks, and centroid are untouched.
      if (fHeld) return; // OS key-repeat: state already captured
      if (selection.ids.size === 0) return;
      fHeld = true;
      tightHeld = false;
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      issueStop(world, selection);
      return;
    }

    if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (selection.ids.size === 0) return;
      const fwd = averageFacing();
      const leftX = -fwd.y, leftY = fwd.x;
      const s = NUDGE_STEP_WORLD;
      let dx = 0, dy = 0;
      if (e.code === 'ArrowUp') { dx = fwd.x * s; dy = fwd.y * s; }
      else if (e.code === 'ArrowDown') { dx = -fwd.x * s; dy = -fwd.y * s; }
      else if (e.code === 'ArrowLeft') { dx = leftX * s; dy = leftY * s; }
      else { dx = -leftX * s; dy = -leftY * s; }
      issueNudge(world, selection, dx, dy, fwd, { queue: e.shiftKey });
      tightHeld = false;
      return;
    }
  }

  function onKeyUp(e: { key: string; code: string }): void {
    if (e.key === 'Control' || e.key === 'Meta') ctrlHeld = false;
    if (e.code === 'KeyF') {
      clearGridHold();
    }
  }

  function onBlur(): void {
    pendingClickStart = null;
    drag.active = false;
    pendingFormationStart = null;
    formationDrag.active = false;
    cursorMode = 'normal';
    clearGridHold();
    ctrlHeld = false;
    lastCursorScreen = null;
    lastRightClick = null;
  }

  // DOM bindings — narrow event types pass through to the pure handlers above.
  const md = (e: MouseEvent) => onMouseDown({ button: e.button, clientX: e.clientX, clientY: e.clientY, target: e.target });
  const mm = (e: MouseEvent) => onMouseMove({ clientX: e.clientX, clientY: e.clientY });
  const mu = (e: MouseEvent) => onMouseUp({ button: e.button, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  const kd = (e: KeyboardEvent) => onKeyDown({ key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  const ku = (e: KeyboardEvent) => onKeyUp({ key: e.key, code: e.code });
  const bl = () => onBlur();

  if (typeof window !== 'undefined') {
    window.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', bl);
  }

  function formationPreview(): FormationPreview | null {
    if (cursorMode !== 'normal') return null;

    // Drag preview wins when an RMB drag is active.
    if (formationDrag.active) {
      const units = materializeUnits(world, selection.ids);
      if (units.length === 0) return null;
      const startW = formationDrag.startWorld;
      const endW = screenToWorld(camera, formationDrag.currentScreen);
      const { slots, rect } = computeFormationSlots({
        units, startW, endW,
        spacingMult: Math.max(spacingMultiplier(formationParams), MARCH_FLOOR_MULT),
        ranksOverride: null,
      });
      return { rect, slots };
    }

    // March preview when Ctrl is held over the canvas with a non-empty selection.
    if (ctrlHeld && selection.ids.size > 0 && lastCursorScreen) {
      const w = screenToWorld(camera, lastCursorScreen);
      const r = computeMarchSlots(world, selection.ids, w, formationParams);
      if (!r) return null;
      return { rect: r.rect, slots: r.slots };
    }

    return null;
  }

  return {
    get cursorMode() { return cursorMode; },
    get formationParams() { return formationParams; },
    get tightHeld() { return tightHeld; },
    get lockedRanks() { return lockedRanks; },
    get runMode() { return runMode; },
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
        lockedRanks = null;
        tightHeld = false;
        clearGridHold();
        lastSelectionSig = sig;
      }

      // F = hurry. Each frame F is held, push every selected unit toward the
      // position/facing it's already trying to reach at full base speed.
      // Re-issuing every frame pre-empts the slow settle drift and keeps
      // jostled units sprinting back to their slot.
      if (fHeld && selection.ids.size > 0) {
        issueHurryToSlots(world, selection);
      }

      // Auto-pack on idle when in tight stance.
      if (selection.ids.size > 0 && isTightStance(formationParams) && !tightHeld) {
        let allIdle = true;
        for (const id of selection.ids) {
          if (e.alive[id] !== 1) continue;
          const q = world.orderQueue.get(id);
          if (q && q.length > 0) { allIdle = false; break; }
          if (e.state[id] === EntityState.Moving) { allIdle = false; break; }
        }
        if (allIdle) {
          reformNow();
          tightHeld = true;
        }
      }
    },
    destroy() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousedown', md);
        window.removeEventListener('mousemove', mm);
        window.removeEventListener('mouseup', mu);
        window.removeEventListener('keydown', kd);
        window.removeEventListener('keyup', ku);
        window.removeEventListener('blur', bl);
      }
    },
    _internals: { onMouseDown, onMouseMove, onMouseUp, onKeyDown, onKeyUp, onBlur, getCursorMode: () => cursorMode },
  };
}
