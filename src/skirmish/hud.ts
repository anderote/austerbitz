/**
 * HUD overlay for the Skirmish Defense scenario.
 * Top-left: keymap. Top-right: live counters. Right: action panel (reset).
 */

export interface SkirmishHudCounters {
  fps: number;
  kills: number;
  escaped: number;
  inPlay: number;
  projectiles: number;
  particles: number;
}

export interface SkirmishHud {
  setCounters(stats: SkirmishHudCounters): void;
}

export interface SkirmishHudHandlers {
  reset: () => void;
}

export function createSkirmishHud(handlers: SkirmishHudHandlers): SkirmishHud {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('skirmish hud: #ui-root missing');

  const legend = document.createElement('div');
  legend.className = 'lab-panel lab-subject';
  legend.innerHTML = `
    <h3>Skirmish Defense</h3>
    <div style="line-height:1.6">
      <b>WASD</b> — Pan camera<br>
      <i>Drag-select</i> — Select cannons<br>
      <i>Right-click</i> — Move/aim<br>
      <b>← →</b> aim · <b>↑ ↓</b> elevation<br>
      <b>Z X C</b> — load solid/shell/canister<br>
      <b>Space</b> — Fire selected cannons<br>
      <b>R</b> — Reset
    </div>
  `;
  root.appendChild(legend);

  const hud = document.createElement('div');
  hud.className = 'lab-panel lab-hud';
  root.appendChild(hud);

  const actions = document.createElement('div');
  actions.className = 'lab-panel lab-actions';
  actions.innerHTML = '<h3>Actions</h3>';
  root.appendChild(actions);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = '[R] Reset';
  resetBtn.addEventListener('click', handlers.reset);
  actions.appendChild(resetBtn);

  return {
    setCounters(stats: SkirmishHudCounters): void {
      hud.textContent =
        `FPS          ${stats.fps.toFixed(0).padStart(4)}\n` +
        `Kills        ${String(stats.kills).padStart(4)}\n` +
        `Escaped      ${String(stats.escaped).padStart(4)}\n` +
        `In play      ${String(stats.inPlay).padStart(4)}\n` +
        `Projectiles  ${String(stats.projectiles).padStart(4)}\n` +
        `Particles    ${String(stats.particles).padStart(4)}`;
    },
  };
}
