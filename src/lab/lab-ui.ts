/**
 * Dev-tool DOM overlay for the FX lab. Subject picker, action panel,
 * time-scale slider, grid + wind toggles, and a per-frame HUD.
 *
 * Not headlessly testable — exercised manually via `vite` running lab.html.
 */

export interface ActionHandlers {
  march: () => void;
  halt: () => void;
  faceL: () => void;
  faceR: () => void;
  fire: () => void;
  reload: () => void;
  solidShot: () => void;
  explosiveShell: () => void;
  charge: () => void;
  takeMusketHit: () => void;
  takeCannonHit: () => void;
  die: () => void;
  reset: () => void;
}

export interface TimeScaleState { scale: number; }
export interface WindState { accelX: number; }
export interface GridToggle { on: boolean; }

export interface LabHudStats {
  fps: number;
  entityCount: number;
  particleCount: number;
  particleCap: number;
  projCount: number;
  projCap: number;
}

export interface LabUi {
  update(stats: LabHudStats): void;
}

const SUBJECT_KINDS: readonly string[] = ['line-infantry', 'cuirassier', 'cannon-12'];

const WIND_LABELS = ['off', 'left', 'right'] as const;
const WIND_VALUES = [0, -0.5, 0.5];

export function createLabUi(
  handlers: ActionHandlers,
  getSubjectKind: () => string,
  setSubjectKind: (k: string) => void,
  timeScale: TimeScaleState,
  wind: WindState,
  gridToggle: GridToggle,
): LabUi {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('lab-ui: #ui-root missing in lab.html');

  // Subject picker (top-left).
  const subjectPanel = document.createElement('div');
  subjectPanel.className = 'lab-panel lab-subject';
  subjectPanel.innerHTML = '<h3>Subject</h3>';
  for (const kind of SUBJECT_KINDS) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'lab-subject-kind';
    radio.value = kind;
    radio.checked = kind === getSubjectKind();
    radio.addEventListener('change', () => {
      if (radio.checked) {
        setSubjectKind(kind);
        rebuildActionEnabled();
      }
    });
    label.appendChild(radio);
    label.appendChild(document.createTextNode(' ' + kind));
    subjectPanel.appendChild(label);
  }
  root.appendChild(subjectPanel);

  // Lab HUD (top-right).
  const hud = document.createElement('div');
  hud.className = 'lab-panel lab-hud';
  hud.textContent = 'fps  --\nent  --\npart 0/0\nproj 0/0';
  root.appendChild(hud);

  // Action panel (right column).
  const panel = document.createElement('div');
  panel.className = 'lab-panel lab-actions';
  panel.innerHTML = '<h3>Actions</h3>';
  root.appendChild(panel);

  function makeBtn(label: string, onClick: () => void, kindGate?: (k: string) => boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', onClick);
    if (kindGate) b.dataset['gate'] = '1';
    (b as HTMLButtonElement & { _gate?: (k: string) => boolean })._gate = kindGate;
    return b;
  }

  function group(name: string): HTMLDivElement {
    const g = document.createElement('div');
    g.className = 'group';
    const lab = document.createElement('div');
    lab.className = 'group-label';
    lab.textContent = name;
    g.appendChild(lab);
    panel.appendChild(g);
    return g;
  }

  // Build groups.
  const HAS_WEAPON = (k: string) => k === 'line-infantry' || k === 'cannon-12';
  const IS_CANNON = (k: string) => k === 'cannon-12';
  const IS_CAVALRY = (k: string) => k === 'cuirassier';

  const movement = group('Movement');
  movement.appendChild(makeBtn('March', handlers.march));
  movement.appendChild(makeBtn('Halt', handlers.halt));
  movement.appendChild(makeBtn('Face L', handlers.faceL));
  movement.appendChild(makeBtn('Face R', handlers.faceR));

  const fire = group('Fire');
  const fireBtn = makeBtn('Fire', handlers.fire, HAS_WEAPON);
  fire.appendChild(fireBtn);
  const autoBtn = makeBtn('Auto-fire: off', () => {
    autoFire = !autoFire;
    autoBtn.textContent = autoFire ? 'Auto-fire: on' : 'Auto-fire: off';
    autoBtn.classList.toggle('toggle-on', autoFire);
  }, HAS_WEAPON);
  (autoBtn as HTMLButtonElement & { _gate?: (k: string) => boolean })._gate = HAS_WEAPON;
  fire.appendChild(autoBtn);
  fire.appendChild(makeBtn('Reload', handlers.reload, HAS_WEAPON));

  const cannon = group('Cannon-only');
  cannon.appendChild(makeBtn('Solid shot', handlers.solidShot, IS_CANNON));
  cannon.appendChild(makeBtn('Explosive shell', handlers.explosiveShell, IS_CANNON));

  const cavalry = group('Cavalry-only');
  cavalry.appendChild(makeBtn('Charge', handlers.charge, IS_CAVALRY));

  const reactions = group('Reactions');
  reactions.appendChild(makeBtn('Take musket hit', handlers.takeMusketHit));
  reactions.appendChild(makeBtn('Take cannon hit', handlers.takeCannonHit));
  reactions.appendChild(makeBtn('Die', handlers.die));

  const stage = group('Stage');
  stage.appendChild(makeBtn('Reset', handlers.reset));

  // Time-scale slider.
  const timeRow = document.createElement('div');
  timeRow.className = 'row';
  const timeLabel = document.createElement('span');
  timeLabel.textContent = 'time';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0.05'; slider.max = '1.0'; slider.step = '0.05';
  slider.value = String(timeScale.scale);
  const timeVal = document.createElement('span');
  timeVal.textContent = timeScale.scale.toFixed(2) + 'x';
  slider.addEventListener('input', () => {
    timeScale.scale = parseFloat(slider.value);
    timeVal.textContent = timeScale.scale.toFixed(2) + 'x';
  });
  timeRow.appendChild(timeLabel);
  timeRow.appendChild(slider);
  timeRow.appendChild(timeVal);
  stage.appendChild(timeRow);

  // Grid toggle.
  const gridOverlay = document.getElementById('grid-overlay');
  const gridBtn = document.createElement('button');
  gridBtn.textContent = 'Toggle grid';
  gridBtn.addEventListener('click', () => {
    gridToggle.on = !gridToggle.on;
    gridBtn.classList.toggle('toggle-on', gridToggle.on);
    if (gridOverlay) gridOverlay.classList.toggle('grid-on', gridToggle.on);
  });
  stage.appendChild(gridBtn);

  // Wind toggle (cycles off / left / right).
  let windIndex = 0;
  const windBtn = document.createElement('button');
  windBtn.textContent = 'Wind: off';
  windBtn.addEventListener('click', () => {
    windIndex = (windIndex + 1) % WIND_LABELS.length;
    wind.accelX = WIND_VALUES[windIndex]!;
    windBtn.textContent = 'Wind: ' + WIND_LABELS[windIndex];
    windBtn.classList.toggle('toggle-on', windIndex !== 0);
  });
  stage.appendChild(windBtn);

  // Auto-fire flag, exposed back to the frame loop via the handler closure
  // so the loop polls it each tick.
  let autoFire = false;
  (handlers as ActionHandlers & { isAutoFire: () => boolean }).isAutoFire = () => autoFire;

  // Enable/disable buttons whose `_gate` predicate excludes the current kind.
  function rebuildActionEnabled() {
    const k = getSubjectKind();
    const buttons = panel.querySelectorAll('button');
    buttons.forEach((b) => {
      const gate = (b as HTMLButtonElement & { _gate?: (k: string) => boolean })._gate;
      if (gate) (b as HTMLButtonElement).disabled = !gate(k);
    });
  }
  rebuildActionEnabled();

  return {
    update(stats) {
      hud.textContent =
        `fps  ${stats.fps.toFixed(0)}\n` +
        `ent  ${stats.entityCount}\n` +
        `part ${stats.particleCount}/${stats.particleCap}\n` +
        `proj ${stats.projCount}/${stats.projCap}`;
    },
  };
}
