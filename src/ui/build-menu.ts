import { panel } from './overlay';
import { unitKinds } from '../data/units';

export interface BuildMenu {
  /** Currently a no-op; later versions update buildable list from selection. */
  update(): void;
}

export function createBuildMenu(root: HTMLElement): BuildMenu {
  const el = panel('build-menu');
  el.classList.add('collapsed');

  const toggle = document.createElement('div');
  toggle.className = 'toggle';
  toggle.textContent = '«';
  toggle.title = 'Toggle build menu';
  el.appendChild(toggle);

  const heading = document.createElement('h3');
  heading.textContent = 'Build';
  el.appendChild(heading);

  for (const k of unitKinds) {
    const btn = document.createElement('button');
    btn.textContent = k.name;
    btn.disabled = true; // placeholder buttons in MVP-1
    btn.title = `${k.category} (placeholder)`;
    el.appendChild(btn);
  }

  toggle.addEventListener('click', () => {
    const collapsed = el.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '«' : '»';
  });

  root.appendChild(el);

  return { update() {} };
}
