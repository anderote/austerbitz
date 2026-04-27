export function createOverlay(): HTMLElement {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root missing');
  return root;
}

export function panel(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `panel ${className}`;
  return el;
}
