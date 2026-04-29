import { panel } from './overlay';
import { profiler } from '../dev/profiler';
import type { InputManager } from '../input/input-manager';

export interface PerfPanel {
  update(): void;
  show(): void;
  hide(): void;
  toggle(): void;
}

const TOGGLE_KEY = 'Backquote';

export function createPerfPanel(root: HTMLElement, input: InputManager): PerfPanel {
  const el = panel('perf-panel');
  el.style.display = 'none';
  root.appendChild(el);

  let visible = false;
  let togglePressed = false;
  let lastRender = 0;

  function show(): void { visible = true; el.style.display = 'block'; }
  function hide(): void { visible = false; el.style.display = 'none'; }
  function toggle(): void { visible ? hide() : show(); }

  return {
    show, hide, toggle,
    update(): void {
      // Edge-trigger on key press so a held key doesn't flicker.
      const held = input.state.keys.has(TOGGLE_KEY);
      if (held && !togglePressed) toggle();
      togglePressed = held;

      if (!visible) return;
      const now = performance.now();
      if (now - lastRender < 200) return; // 5Hz refresh — text is volatile enough
      lastRender = now;

      const snap = profiler.snapshot();
      const total = snap.totalMs;
      const lines: string[] = [];
      lines.push(`Frame  ${total.toFixed(2)} ms (last ${snap.lastTotalMs.toFixed(2)})`);
      lines.push('');
      lines.push('  ms    %  calls  label');
      for (const e of snap.entries) {
        if (e.avgMs < 0.05 && e.lastMs < 0.05) continue;
        const ms = e.avgMs.toFixed(2).padStart(5);
        const pct = total > 0 ? ((e.avgMs / total) * 100).toFixed(0).padStart(3) : '  -';
        const calls = e.calls.toString().padStart(4);
        lines.push(`${ms}  ${pct}  ${calls}  ${e.label}`);
      }
      el.textContent = lines.join('\n');
    },
  };
}
