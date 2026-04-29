// src/ui/scenario-bar.ts — fixed-position top bar showing scenario title,
// per-team alive counts, scenario picker, options dropdown, and a slot for
// the music player. Mounted into #ui-root by both line-battles and skirmish.

import { EntityState } from '../sim/entities';
import type { World } from '../sim/world';
import { setSfxMuted } from '../audio/sfx';

const SFX_MUTED_KEY = 'austerblitz.sfx-muted';

export interface ScenarioOption {
  id: string;
  label: string;
  url: string;
}

export interface ScenarioBarConfig {
  scenarioId: string;
  scenarios: ScenarioOption[];
  options: {
    canShowHealthBars?: boolean;
    canPause?: boolean;
    canReset?: boolean;
  };
  callbacks: {
    onPauseToggle?: (paused: boolean) => void;
    onShowHealthBarsToggle?: (on: boolean) => void;
    onSoundToggle?: (muted: boolean) => void;
    onReset?: () => void;
  };
}

export interface ScenarioBar {
  root: HTMLElement;
  musicSlot: HTMLElement;
  update(world: World): void;
}

/**
 * Pure helper: returns the count of alive entities per team (team 0 = blue,
 * team 1 = red), excluding entities whose state is Dying/Dead/Ragdoll.
 * Exposed for tests; the bar uses it inside `update()`.
 */
export function countAliveByTeam(world: World): { blue: number; red: number } {
  const e = world.entities;
  let blue = 0;
  let red = 0;
  for (let i = 0; i < e.count; i++) {
    const id = e.aliveIds[i]!;
    if (e.alive[id] !== 1) continue;
    const st = e.state[id]!;
    if (st >= EntityState.Ragdoll) continue; // Ragdoll, Dying, Dead are excluded
    const team = e.team[id]!;
    if (team === 0) blue++;
    else if (team === 1) red++;
  }
  return { blue, red };
}

function readSfxMuted(): boolean {
  try {
    return localStorage.getItem(SFX_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSfxMuted(muted: boolean): void {
  try {
    localStorage.setItem(SFX_MUTED_KEY, muted ? '1' : '0');
  } catch {
    // ignore storage failures (private mode, full quota)
  }
}

export function createScenarioBar(root: HTMLElement, cfg: ScenarioBarConfig): ScenarioBar {
  const { canShowHealthBars = true, canPause = true, canReset = false } = cfg.options;

  const bar = document.createElement('div');
  bar.id = 'scenario-bar';
  bar.className = 'sb-root';

  // --- Left: title + menu link ---
  const left = document.createElement('div');
  left.className = 'sb-left';
  const current = cfg.scenarios.find((s) => s.id === cfg.scenarioId);
  const titleEl = document.createElement('span');
  titleEl.className = 'sb-title';
  titleEl.textContent = (current?.label ?? cfg.scenarioId).toUpperCase();
  const menuLink = document.createElement('a');
  menuLink.className = 'sb-menu-link';
  menuLink.href = '/';
  menuLink.textContent = '< Menu';
  left.appendChild(titleEl);
  left.appendChild(menuLink);

  // --- Center: team counts ---
  const center = document.createElement('div');
  center.className = 'sb-center';
  const blueLabel = document.createElement('span');
  blueLabel.className = 'sb-team-label sb-team-blue';
  blueLabel.textContent = 'BLUE';
  const blueCount = document.createElement('span');
  blueCount.className = 'sb-team-count';
  blueCount.textContent = '0';
  const sep = document.createElement('span');
  sep.className = 'sb-team-sep';
  sep.textContent = 'vs';
  const redLabel = document.createElement('span');
  redLabel.className = 'sb-team-label sb-team-red';
  redLabel.textContent = 'RED';
  const redCount = document.createElement('span');
  redCount.className = 'sb-team-count';
  redCount.textContent = '0';
  center.appendChild(blueLabel);
  center.appendChild(blueCount);
  center.appendChild(sep);
  center.appendChild(redLabel);
  center.appendChild(redCount);

  // --- Right: scenario picker + options + music slot ---
  const right = document.createElement('div');
  right.className = 'sb-right';

  const picker = document.createElement('select');
  picker.className = 'sb-scenario-picker';
  for (const s of cfg.scenarios) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    picker.appendChild(opt);
  }
  picker.value = cfg.scenarioId;
  picker.addEventListener('change', () => {
    const chosen = cfg.scenarios.find((s) => s.id === picker.value);
    if (chosen) location.href = chosen.url;
  });

  // Options button + dropdown
  const optionsWrap = document.createElement('div');
  optionsWrap.className = 'sb-options-wrap';
  const optionsBtn = document.createElement('button');
  optionsBtn.className = 'sb-options';
  optionsBtn.textContent = 'Options';
  const dropdown = document.createElement('div');
  dropdown.className = 'sb-options-dropdown';
  dropdown.hidden = true;

  let dropdownOpen = false;
  function setDropdownOpen(open: boolean): void {
    dropdownOpen = open;
    dropdown.hidden = !open;
  }
  optionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setDropdownOpen(!dropdownOpen);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!dropdownOpen) return;
    const target = e.target as Node | null;
    if (target && !optionsWrap.contains(target)) {
      setDropdownOpen(false);
    }
  });

  // Pause toggle
  let paused = false;
  if (canPause) {
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'sb-opt-btn sb-pause';
    pauseBtn.textContent = 'Pause';
    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      pauseBtn.classList.toggle('active', paused);
      cfg.callbacks.onPauseToggle?.(paused);
    });
    dropdown.appendChild(pauseBtn);
  }

  // Sound toggle (always)
  {
    let muted = readSfxMuted();
    setSfxMuted(muted);
    const soundBtn = document.createElement('button');
    soundBtn.className = 'sb-opt-btn sb-sound';
    soundBtn.textContent = muted ? 'Sound: Off' : 'Sound: On';
    soundBtn.classList.toggle('active', muted);
    soundBtn.addEventListener('click', () => {
      muted = !muted;
      soundBtn.textContent = muted ? 'Sound: Off' : 'Sound: On';
      soundBtn.classList.toggle('active', muted);
      setSfxMuted(muted);
      writeSfxMuted(muted);
      cfg.callbacks.onSoundToggle?.(muted);
    });
    dropdown.appendChild(soundBtn);
  }

  // Health-bars toggle
  if (canShowHealthBars) {
    let on = false;
    const hbBtn = document.createElement('button');
    hbBtn.className = 'sb-opt-btn sb-healthbars';
    hbBtn.textContent = 'Health bars: Off';
    hbBtn.addEventListener('click', () => {
      on = !on;
      hbBtn.textContent = on ? 'Health bars: On' : 'Health bars: Off';
      hbBtn.classList.toggle('active', on);
      cfg.callbacks.onShowHealthBarsToggle?.(on);
    });
    dropdown.appendChild(hbBtn);
  }

  // Reset
  if (canReset) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'sb-opt-btn sb-reset';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      cfg.callbacks.onReset?.();
      setDropdownOpen(false);
    });
    dropdown.appendChild(resetBtn);
  }

  optionsWrap.appendChild(optionsBtn);
  optionsWrap.appendChild(dropdown);

  const musicSlot = document.createElement('div');
  musicSlot.className = 'sb-music-slot';

  right.appendChild(picker);
  right.appendChild(optionsWrap);
  right.appendChild(musicSlot);

  bar.appendChild(left);
  bar.appendChild(center);
  bar.appendChild(right);
  root.appendChild(bar);

  return {
    root: bar,
    musicSlot,
    update(world: World): void {
      const { blue, red } = countAliveByTeam(world);
      blueCount.textContent = String(blue);
      redCount.textContent = String(red);
    },
  };
}
