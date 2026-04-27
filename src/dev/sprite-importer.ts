import { unitKinds } from '../data/units';

type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
type AnimationState =
  | 'Idle'
  | 'Walk'
  | 'Run'
  | 'Fire'
  | 'Reload'
  | 'Melee'
  | 'Hit'
  | 'Death';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Selection {
  id: number;
  rect: Rect;
  state: AnimationState;
  direction: Direction;
  label: string;
}

const DIRECTIONS: Direction[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const STATES: AnimationState[] = ['Idle', 'Walk', 'Run', 'Fire', 'Reload', 'Melee', 'Hit', 'Death'];
const COLORS = ['#7cb3ff', '#ffd166', '#ff6b6b', '#7fff9f', '#d291ff', '#ff9f9f', '#7ff0ff', '#ffe27a'];

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = (() => {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas context unavailable');
  context.imageSmoothingEnabled = false;
  return context;
})();

const offscreen = document.createElement('canvas');
const offCtx = (() => {
  const context = offscreen.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Offscreen context unavailable');
  return context;
})();

const unitSelect = document.getElementById('unit-select') as HTMLSelectElement;
const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
const zoomBadge = document.getElementById('zoom-value') as HTMLElement;
const autoTrimCheckbox = document.getElementById('auto-trim') as HTMLInputElement;
const openFileButton = document.getElementById('open-file') as HTMLButtonElement;
const clearButton = document.getElementById('clear-selections') as HTMLButtonElement;
const downloadButton = document.getElementById('download-json') as HTMLButtonElement;
const selectionList = document.getElementById('selection-list')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const stage = document.getElementById('stage')!;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const notesInput = document.getElementById('notes') as HTMLTextAreaElement;

interface DraftRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

const state = {
  image: null as HTMLImageElement | null,
  imageName: '',
  scale: 4,
  autoTrim: true,
  selections: [] as Selection[],
  draft: null as DraftRect | null,
  isPointerDown: false,
  nextId: 1,
  highlightId: null as number | null,
};

function populateUnitSelect(): void {
  unitSelect.innerHTML = '';
  unitKinds.forEach((unit) => {
    const option = document.createElement('option');
    option.value = unit.id;
    option.textContent = unit.name;
    unitSelect.appendChild(option);
  });
}

populateUnitSelect();

function updateZoomBadge(): void {
  zoomBadge.textContent = `${Number(state.scale).toFixed(1)}×`;
}

function configureCanvasForImage(): void {
  const img = state.image;
  if (!img) return;
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = `${img.width * state.scale}px`;
  canvas.style.height = `${img.height * state.scale}px`;

  offscreen.width = img.width;
  offscreen.height = img.height;
  offCtx.clearRect(0, 0, img.width, img.height);
  offCtx.drawImage(img, 0, 0);

  emptyState.style.display = 'none';
  render();
}

function loadImageFile(file: File): void {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    state.image = img;
    state.imageName = file.name;
    state.selections = [];
    state.nextId = 1;
    configureCanvasForImage();
    rebuildSelectionList();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('Failed to load image. Make sure the file is a valid PNG.');
  };
  img.src = url;
}

function canvasToImageCoords(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const img = state.image;
  if (!img) return { x: 0, y: 0 };
  const scaleX = img.width / rect.width;
  const scaleY = img.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  return { x, y };
}

function clampRect(rect: Rect): Rect {
  const img = state.image;
  if (!img) return rect;
  const x = Math.max(0, Math.min(rect.x, img.width));
  const y = Math.max(0, Math.min(rect.y, img.height));
  const maxW = img.width - x;
  const maxH = img.height - y;
  const width = Math.max(1, Math.min(rect.width, maxW));
  const height = Math.max(1, Math.min(rect.height, maxH));
  return { x, y, width, height };
}

function autoTrimRect(rect: Rect): Rect {
  const img = state.image;
  if (!img) return rect;
  const bounded = clampRect(rect);
  if (bounded.width <= 0 || bounded.height <= 0) return bounded;
  const data = offCtx.getImageData(bounded.x, bounded.y, bounded.width, bounded.height).data;
  const stride = bounded.width * 4;

  const isForeground = (offset: number): boolean => {
    const a = data[offset + 3];
    if (a <= 10) return false;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    return !(r >= 240 && g >= 240 && b >= 240);
  };

  let top = 0;
  outerTop: for (; top < bounded.height; top++) {
    for (let x = 0; x < bounded.width; x++) {
      if (isForeground(top * stride + x * 4)) break outerTop;
    }
  }

  let bottom = bounded.height - 1;
  outerBottom: for (; bottom >= top; bottom--) {
    for (let x = 0; x < bounded.width; x++) {
      if (isForeground(bottom * stride + x * 4)) break outerBottom;
    }
  }

  let left = 0;
  outerLeft: for (; left < bounded.width; left++) {
    for (let y = top; y <= bottom; y++) {
      if (isForeground(y * stride + left * 4)) break outerLeft;
    }
  }

  let right = bounded.width - 1;
  outerRight: for (; right >= left; right--) {
    for (let y = top; y <= bottom; y++) {
      if (isForeground(y * stride + right * 4)) break outerRight;
    }
  }

  if (top > bottom || left > right) {
    return bounded;
  }

  return {
    x: bounded.x + left,
    y: bounded.y + top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function addSelection(rect: Rect): void {
  const clamped = clampRect(rect);
  const trimmed = state.autoTrim ? autoTrimRect(clamped) : clamped;
  const selection: Selection = {
    id: state.nextId++,
    rect: trimmed,
    state: 'Idle',
    direction: 'S',
    label: '',
  };
  state.selections.push(selection);
  rebuildSelectionList();
  render();
}

function removeSelection(id: number): void {
  state.selections = state.selections.filter((sel) => sel.id !== id);
  if (state.highlightId === id) state.highlightId = null;
  rebuildSelectionList();
  render();
}

function updateSelectionRect(id: number, nextRect: Rect): void {
  const selection = state.selections.find((sel) => sel.id === id);
  if (!selection) return;
  selection.rect = clampRect(nextRect);
  render();
}

function trimSelection(id: number): void {
  const selection = state.selections.find((sel) => sel.id === id);
  if (!selection) return;
  selection.rect = autoTrimRect(selection.rect);
  render();
  rebuildSelectionList();
}

function rebuildSelectionList(): void {
  selectionList.innerHTML = '';
  if (state.selections.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--muted)';
    empty.textContent = 'No clips yet — drag on the canvas to add one.';
    selectionList.appendChild(empty);
    return;
  }

  state.selections.forEach((sel) => {
    const container = document.createElement('div');
    container.className = 'selection-item';

    const header = document.createElement('header');
    const title = document.createElement('span');
    title.textContent = `#${sel.id}`;
    const actions = document.createElement('div');

    const focusBtn = document.createElement('button');
    focusBtn.textContent = 'Highlight';
    focusBtn.addEventListener('click', () => {
      state.highlightId = sel.id;
      render();
    });
    actions.appendChild(focusBtn);

    const trimBtn = document.createElement('button');
    trimBtn.textContent = 'Trim';
    trimBtn.addEventListener('click', () => trimSelection(sel.id));
    actions.appendChild(trimBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'danger';
    removeBtn.addEventListener('click', () => removeSelection(sel.id));
    actions.appendChild(removeBtn);

    header.append(title, actions);
    container.appendChild(header);

    const dirLabel = document.createElement('label');
    dirLabel.textContent = 'Direction';
    const dirSelect = document.createElement('select');
    DIRECTIONS.forEach((dir) => {
      const option = document.createElement('option');
      option.value = dir;
      option.textContent = dir;
      if (sel.direction === dir) option.selected = true;
      dirSelect.appendChild(option);
    });
    dirSelect.addEventListener('change', () => {
      sel.direction = dirSelect.value as Direction;
    });
    dirLabel.appendChild(dirSelect);
    container.appendChild(dirLabel);

    const stateLabel = document.createElement('label');
    stateLabel.textContent = 'State';
    const stateSelect = document.createElement('select');
    STATES.forEach((st) => {
      const option = document.createElement('option');
      option.value = st;
      option.textContent = st;
      if (sel.state === st) option.selected = true;
      stateSelect.appendChild(option);
    });
    stateSelect.addEventListener('change', () => {
      sel.state = stateSelect.value as AnimationState;
    });
    stateLabel.appendChild(stateSelect);
    container.appendChild(stateLabel);

    const coords: Array<{ label: string; key: keyof Rect }> = [
      { label: 'X', key: 'x' },
      { label: 'Y', key: 'y' },
      { label: 'W', key: 'width' },
      { label: 'H', key: 'height' },
    ];

    coords.forEach(({ label, key }) => {
      const coordLabel = document.createElement('label');
      coordLabel.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(sel.rect[key]);
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (Number.isNaN(value)) return;
        const rect = { ...sel.rect, [key]: value } as Rect;
        updateSelectionRect(sel.id, rect);
        rebuildSelectionList();
      });
      coordLabel.appendChild(input);
      container.appendChild(coordLabel);
    });

    const labelField = document.createElement('label');
    labelField.textContent = 'Label';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'Optional note';
    labelInput.value = sel.label;
    labelInput.addEventListener('input', () => {
      sel.label = labelInput.value;
    });
    labelField.appendChild(labelInput);
    container.appendChild(labelField);

    selectionList.appendChild(container);
  });
}

function render(): void {
  const img = state.image;
  if (!img) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const drawRect = (rect: Rect, color: string, fill = false): void => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (fill) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
      ctx.globalAlpha = 1.0;
    }
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    ctx.restore();
  };

  state.selections.forEach((sel, index) => {
    const color = state.highlightId === sel.id ? '#ffae41' : COLORS[index % COLORS.length];
    drawRect(sel.rect, color, true);
  });

  if (state.draft) {
    const { startX, startY, currentX, currentY } = state.draft;
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([4, 2]);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width, height);
    ctx.restore();
  }
}

function finalizeDraft(): void {
  if (!state.draft) return;
  const { startX, startY, currentX, currentY } = state.draft;
  const x = Math.round(Math.min(startX, currentX));
  const y = Math.round(Math.min(startY, currentY));
  const width = Math.round(Math.abs(currentX - startX));
  const height = Math.round(Math.abs(currentY - startY));
  state.draft = null;
  state.isPointerDown = false;
  if (width < 1 || height < 1) {
    render();
    return;
  }
  addSelection({ x, y, width, height });
}

canvas.addEventListener('pointerdown', (event) => {
  if (!state.image) return;
  canvas.setPointerCapture(event.pointerId);
  const { x, y } = canvasToImageCoords(event);
  state.draft = { startX: x, startY: y, currentX: x, currentY: y };
  state.isPointerDown = true;
  render();
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.image || !state.isPointerDown || !state.draft) return;
  const { x, y } = canvasToImageCoords(event);
  state.draft.currentX = Math.max(0, Math.min(x, state.image.width));
  state.draft.currentY = Math.max(0, Math.min(y, state.image.height));
  render();
});

const endPointer = (event: PointerEvent) => {
  if (!state.isPointerDown) return;
  canvas.releasePointerCapture(event.pointerId);
  finalizeDraft();
};

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.draft) {
      state.draft = null;
      state.isPointerDown = false;
      render();
    } else if (state.highlightId !== null) {
      state.highlightId = null;
      render();
    }
  }
});

zoomSlider.addEventListener('input', () => {
  state.scale = Number(zoomSlider.value);
  updateZoomBadge();
  const img = state.image;
  if (img) {
    canvas.style.width = `${img.width * state.scale}px`;
    canvas.style.height = `${img.height * state.scale}px`;
  }
});

autoTrimCheckbox.addEventListener('change', () => {
  state.autoTrim = autoTrimCheckbox.checked;
});

openFileButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  loadImageFile(file);
  fileInput.value = '';
});

stage.addEventListener('dragover', (event) => {
  event.preventDefault();
  stage.classList.add('dragover');
});

stage.addEventListener('dragleave', (event) => {
  if (event.target === stage) {
    stage.classList.remove('dragover');
  }
});

stage.addEventListener('drop', (event) => {
  event.preventDefault();
  stage.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    loadImageFile(file);
  }
});

clearButton.addEventListener('click', () => {
  if (state.selections.length === 0) return;
  if (!confirm('Remove all selections?')) return;
  state.selections = [];
  state.highlightId = null;
  rebuildSelectionList();
  render();
});

downloadButton.addEventListener('click', () => {
  if (!state.image) {
    alert('Load a sprite sheet first');
    return;
  }
  if (state.selections.length === 0) {
    alert('No selections to export');
    return;
  }
  const exportData = {
    unitId: unitSelect.value,
    source: {
      filename: state.imageName,
      width: state.image.width,
      height: state.image.height,
    },
    autoTrimApplied: state.autoTrim,
    notes: notesInput.value.trim() || undefined,
    selections: state.selections.map((sel) => ({
      id: sel.id,
      state: sel.state,
      direction: sel.direction,
      label: sel.label || undefined,
      rect: sel.rect,
    })),
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  const unitSlug = unitSelect.value || 'unit';
  link.href = URL.createObjectURL(blob);
  link.download = `${unitSlug}-sprites.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
});

// Kick off initial UI state
updateZoomBadge();
rebuildSelectionList();
render();
