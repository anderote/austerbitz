/**
 * HUD overlay for the cannon-test sandbox.
 * Top-left: legend / keymap. Top-right: live counters. Right: action panel.
 */

export interface CannonTestCounters {
  aliveRegiment: number;
  projectiles: number;
  shockwaves: number;
  particles: number;
  puffs: number;
  debris: number;
  fps: number;
}

export interface CannonTestHud {
  setCounters(stats: CannonTestCounters): void;
}

export interface CannonTestHandlers {
  reset: () => void;
  togglePause: () => void;
  stepFrame: () => void;
  toggleSlowMo: () => void;
  toggleCameraShake: () => void;
}

export interface CannonTestToggles {
  isPaused: () => boolean;
  isSlowMo: () => boolean;
  isCameraShake: () => boolean;
}

export function createCannonTestHud(
  handlers: CannonTestHandlers,
  toggles: CannonTestToggles,
): CannonTestHud {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('cannon-test hud: #ui-root missing');

  // --- Legend / keymap (top-left) ---
  const legend = document.createElement('div');
  legend.className = 'lab-panel lab-subject';
  legend.innerHTML = `
    <h3>Cannon Test</h3>
    <div style="line-height:1.6">
      <b>WASD</b> — Pan camera<br>
      <i>Drag-select</i> — Select units<br>
      <i>Right-click</i> — Attack-move<br>
      <b>← →</b> aim · <b>↑ ↓</b> elevation<br>
      <b>Z X C</b> — load solid/shell/canister<br>
      <b>Space</b> — Fire selected cannons<br>
      <b>P</b> — Pause · <b>R</b> Reset · <b>.</b> Step
    </div>
  `;
  root.appendChild(legend);

  // --- Live counters (top-right) ---
  const hud = document.createElement('div');
  hud.className = 'lab-panel lab-hud';
  root.appendChild(hud);

  // --- Action panel (right side, below hud) ---
  const actions = document.createElement('div');
  actions.className = 'lab-panel lab-actions';
  actions.innerHTML = '<h3>Actions</h3>';
  root.appendChild(actions);

  function makeGroup(label: string): HTMLDivElement {
    const g = document.createElement('div');
    g.className = 'group';
    const lbl = document.createElement('div');
    lbl.className = 'group-label';
    lbl.textContent = label;
    g.appendChild(lbl);
    return g;
  }

  function makeButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function makeToggleButton(
    textOff: string,
    textOn: string,
    isOn: () => boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    const update = () => {
      const on = isOn();
      btn.textContent = on ? textOn : textOff;
      btn.classList.toggle('toggle-on', on);
    };
    update();
    btn.addEventListener('click', () => {
      onClick();
      update();
    });
    return btn;
  }

  // Sim control group
  const simGroup = makeGroup('Sim control');
  simGroup.appendChild(makeButton('[R] Reset', handlers.reset));

  const pauseBtn = makeToggleButton(
    '[P] Pause', '[P] Resume',
    toggles.isPaused,
    handlers.togglePause,
  );
  simGroup.appendChild(pauseBtn);

  simGroup.appendChild(makeButton('[.] Step frame', handlers.stepFrame));
  actions.appendChild(simGroup);

  // Options group
  const optGroup = makeGroup('Options');
  optGroup.appendChild(makeToggleButton(
    'Slow-mo (×0.25): off', 'Slow-mo (×0.25): ON',
    toggles.isSlowMo,
    handlers.toggleSlowMo,
  ));
  optGroup.appendChild(makeToggleButton(
    'Camera shake: off', 'Camera shake: ON',
    toggles.isCameraShake,
    handlers.toggleCameraShake,
  ));
  actions.appendChild(optGroup);

  // --- Keyboard handler ---
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat) return;
    switch (e.key) {
      case 'p': case 'P':
        handlers.togglePause();
        pauseBtn.textContent = toggles.isPaused() ? '[P] Resume' : '[P] Pause';
        pauseBtn.classList.toggle('toggle-on', toggles.isPaused());
        break;
      case 'r': case 'R': handlers.reset(); break;
      case '.': handlers.stepFrame(); break;
    }
  });

  return {
    setCounters(stats: CannonTestCounters): void {
      hud.textContent =
        `FPS          ${stats.fps.toFixed(0).padStart(4)}\n` +
        `Regiment     ${String(stats.aliveRegiment).padStart(4)}\n` +
        `Projectiles  ${String(stats.projectiles).padStart(4)}\n` +
        `Shockwaves   ${String(stats.shockwaves).padStart(4)}\n` +
        `Particles    ${String(stats.particles).padStart(4)}\n` +
        `Puffs        ${String(stats.puffs).padStart(4)}\n` +
        `Debris       ${String(stats.debris).padStart(4)}`;
    },
  };
}
