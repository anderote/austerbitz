import { loadRegiments, recolorImageData, type Regiment } from './regiments';

// Component registry types ----------------------------------------------------
type ComponentEntry = {
  id: string;
  type: string;
  category: string;
  facings: string[];
  path: string;
  pivot?: [number, number];
  anchors?: Record<string, [number, number]>;
  notes?: string;
};

type ComponentRegistry = {
  components: ComponentEntry[];
};

type KitFacingConfig = {
  cell?: [number, number];
  layers: string[];
};

type KitConfig = {
  id: string;
  label: string;
  baseAtlas?: string;
  outputAtlas?: string;
  outputPreview?: string;
  facings: Record<string, KitFacingConfig>;
};

const COMPONENT_BASE_URL = '/sprites/components/';
const KIT_INDEX_URL = '/components/kits/index.json';
const REGISTRY_URL = '/components/index.json';

const SKELETON_URL: Record<string, string | null> = {
  none: null,
  front: '/memory/sprites/templates/anatomy/front-skeleton.png',
  side: '/memory/sprites/templates/anatomy/side-skeleton.png',
  back: '/memory/sprites/templates/anatomy/back-skeleton.png',
};

const LAYER_SEQUENCE = [
  'fx:shadow',
  'anatomy:legs',
  'uniform:lower',
  'anatomy:torso',
  'uniform:upper',
  'anatomy:head',
  'uniform:headgear',
  'weapon:primary',
];

const GROUP_LABELS: Record<string, string> = {
  fx: 'Effects',
  anatomy: 'Anatomy',
  uniform: 'Uniform',
  weapon: 'Weapons',
};

const registryContainer = document.getElementById('component-groups') as HTMLDivElement;
const facingSelect = document.getElementById('facing-select') as HTMLSelectElement;
const kitSelect = document.getElementById('kit-select') as HTMLSelectElement;
const regimentSelect = document.getElementById('regiment-select') as HTMLSelectElement | null;
const skeletonSelect = document.getElementById('skeleton-select') as HTMLSelectElement;
const resetButton = document.getElementById('reset-button') as HTMLButtonElement;
const infoCard = document.getElementById('info-card') as HTMLDivElement;

const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: true });
if (!ctx) {
  throw new Error('Unable to acquire 2D context for preview canvas.');
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const recolorCache = new Map<string, HTMLCanvasElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
  if (!imageCache.has(url)) {
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
    imageCache.set(url, promise);
  }
  return imageCache.get(url)!;
}

async function getRecoloredCanvas(url: string, reg: Regiment): Promise<HTMLCanvasElement> {
  const key = `${url}|${reg.id}`;
  const cached = recolorCache.get(key);
  if (cached) return cached;
  const img = await loadImage(url);
  const off = document.createElement('canvas');
  off.width = img.naturalWidth || img.width;
  off.height = img.naturalHeight || img.height;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) throw new Error('2D context');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(img, 0, 0);
  const data = octx.getImageData(0, 0, off.width, off.height);
  recolorImageData(data, reg);
  octx.putImageData(data, 0, 0);
  recolorCache.set(key, off);
  return off;
}

const componentsById = new Map<string, ComponentEntry>();
const kitsById = new Map<string, KitConfig>();
const componentSelections = new Set<string>();

let currentFacing = 'S';
let currentKitId: string | null = null;
let currentSkeleton = 'none';
let renderToken = 0;
let currentRegiment: Regiment | null = null;
let regiments: Regiment[] = [];

function layerKey(entry: ComponentEntry): string {
  return `${entry.type}:${entry.category}`;
}

function layerPriority(entry: ComponentEntry): number {
  const key = layerKey(entry);
  const seqIndex = LAYER_SEQUENCE.indexOf(key);
  return seqIndex >= 0 ? seqIndex : LAYER_SEQUENCE.length + 1;
}

function ensureFacingOption(facing: string) {
  for (const option of facingSelect.options) {
    if (option.value === facing) return;
  }
  const opt = document.createElement('option');
  opt.value = facing;
  opt.textContent = facing;
  facingSelect.appendChild(opt);
}

function setFacing(facing: string) {
  currentFacing = facing;
  facingSelect.value = facing;
}

function setKit(kitId: string | null) {
  currentKitId = kitId;
  if (kitId) {
    kitSelect.value = kitId;
  }
}

function applyKitDefaults(kitId: string | null, facing: string) {
  if (!kitId) {
    componentSelections.clear();
    return;
  }
  const kit = kitsById.get(kitId);
  if (!kit) return;
  const facingConfig = kit.facings[facing];
  componentSelections.clear();
  if (!facingConfig) return;
  for (const id of facingConfig.layers) {
    const entry = componentsById.get(id);
    if (entry && entry.facings.includes(facing)) {
      componentSelections.add(id);
    }
  }
}

function rebuildComponentGroups() {
  registryContainer.innerHTML = '';
  const availableEntries = Array.from(componentsById.values()).filter((entry) =>
    entry.facings.includes(currentFacing)
  );
  availableEntries.sort((a, b) => {
    const layer = layerPriority(a) - layerPriority(b);
    if (layer !== 0) return layer;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.id.localeCompare(b.id);
  });

  // Remove selections that are no longer valid for this facing.
  for (const id of Array.from(componentSelections)) {
    const entry = componentsById.get(id);
    if (!entry || !entry.facings.includes(currentFacing)) {
      componentSelections.delete(id);
    }
  }

  const groups = new Map<string, HTMLDivElement>();

  const ensureGroup = (key: string) => {
    if (!groups.has(key)) {
      const section = document.createElement('div');
      const heading = document.createElement('h2');
      heading.textContent = GROUP_LABELS[key] ?? key;
      section.appendChild(heading);
      registryContainer.appendChild(section);
      groups.set(key, section);
    }
    return groups.get(key)!;
  };

  for (const entry of availableEntries) {
    const groupKey = entry.type;
    const section = ensureGroup(groupKey);
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = componentSelections.has(entry.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        componentSelections.add(entry.id);
      } else {
        componentSelections.delete(entry.id);
      }
      void renderPreview();
    });
    const descriptor = document.createElement('span');
    descriptor.textContent = `${entry.id} (${entry.category})`;
    label.append(checkbox, descriptor);
    section.appendChild(label);
  }
}

async function renderPreview() {
  const token = ++renderToken;
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const skeletonUrl = SKELETON_URL[currentSkeleton];
  if (skeletonUrl) {
    try {
      const skeletonImage = await loadImage(skeletonUrl);
      if (token !== renderToken) return;
      if (!ctx) return;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.drawImage(skeletonImage, 0, 0);
      ctx.restore();
    } catch (err) {
      console.warn(err);
    }
  }

  const layers = Array.from(componentSelections)
    .map((id) => componentsById.get(id))
    .filter((entry): entry is ComponentEntry => Boolean(entry && entry.facings.includes(currentFacing)))
    .sort((a, b) => {
      const priority = layerPriority(a) - layerPriority(b);
      if (priority !== 0) return priority;
      return a.id.localeCompare(b.id);
    });

  for (const entry of layers) {
    const url = `${COMPONENT_BASE_URL}${entry.path}`;
    try {
      if (currentRegiment) {
        const recolored = await getRecoloredCanvas(url, currentRegiment);
        if (token !== renderToken) return;
        if (!ctx) return;
        ctx.drawImage(recolored, 0, 0);
      } else {
        const image = await loadImage(url);
        if (token !== renderToken) return;
        if (!ctx) return;
        ctx.drawImage(image, 0, 0);
      }
    } catch (err) {
      console.warn(err);
    }
  }

  const lines: string[] = [];
  if (currentKitId) {
    const kit = kitsById.get(currentKitId);
    if (kit) {
      lines.push(`<strong>Kit:</strong> ${kit.label}`);
    }
  }
  lines.push(`<strong>Facing:</strong> ${currentFacing}`);
  lines.push(`<strong>Layers:</strong> ${layers.map((entry) => entry.id).join(', ') || 'none'}`);
  infoCard.innerHTML = lines.join('<br />');
}

async function loadRegistry(): Promise<void> {
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) {
    throw new Error(`Failed to load component registry: ${response.statusText}`);
  }
  const data = (await response.json()) as ComponentRegistry;
  for (const entry of data.components) {
    componentsById.set(entry.id, entry);
    for (const facing of entry.facings) {
      ensureFacingOption(facing);
    }
  }
  if (!componentsById.size) {
    throw new Error('Component registry is empty.');
  }
}

async function loadKits(): Promise<void> {
  const response = await fetch(KIT_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to load kit index: ${response.statusText}`);
  }
  const kitIds = (await response.json()) as string[];
  kitSelect.innerHTML = '';
  for (const id of kitIds) {
    const kitResponse = await fetch(`/components/kits/${id}.json`);
    if (!kitResponse.ok) {
      console.warn(`Skipping kit ${id}: ${kitResponse.statusText}`);
      continue;
    }
    const kit = (await kitResponse.json()) as KitConfig;
    kitsById.set(kit.id, kit);
    const opt = document.createElement('option');
    opt.value = kit.id;
    opt.textContent = kit.label;
    kitSelect.appendChild(opt);
  }
  if (!kitSelect.options.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— No Kits —';
    kitSelect.appendChild(opt);
  }
}

function initEvents() {
  facingSelect.addEventListener('change', () => {
    setFacing(facingSelect.value);
    const kit = currentKitId ? kitsById.get(currentKitId) : null;
    const newFacing = currentFacing;
    if (kit && !kit.facings[newFacing]) {
      const available = Object.keys(kit.facings);
      if (available.length) {
        setFacing(available[0]);
      }
    }
    if (currentKitId) {
      applyKitDefaults(currentKitId, currentFacing);
    }
    rebuildComponentGroups();
    void renderPreview();
  });

  kitSelect.addEventListener('change', () => {
    const kitId = kitSelect.value || null;
    setKit(kitId);
    if (kitId) {
      const kit = kitsById.get(kitId);
      if (kit) {
        if (!kit.facings[currentFacing]) {
          const available = Object.keys(kit.facings);
          if (available.length) {
            setFacing(available[0]);
          }
        }
      }
    }
    applyKitDefaults(currentKitId, currentFacing);
    rebuildComponentGroups();
    void renderPreview();
  });

  skeletonSelect.addEventListener('change', () => {
    currentSkeleton = skeletonSelect.value;
    void renderPreview();
  });

  if (regimentSelect) {
    regimentSelect.addEventListener('change', () => {
      const next = regiments.find((r) => r.id === regimentSelect.value);
      if (next) {
        currentRegiment = next;
        void renderPreview();
      }
    });
  }

  resetButton.addEventListener('click', () => {
    applyKitDefaults(currentKitId, currentFacing);
    rebuildComponentGroups();
    void renderPreview();
  });
}

async function main() {
  await loadRegistry();
  await loadKits();

  regiments = await loadRegiments();
  if (regimentSelect) {
    regimentSelect.innerHTML = '';
    for (const reg of regiments) {
      const opt = document.createElement('option');
      opt.value = reg.id;
      opt.textContent = reg.label;
      regimentSelect.appendChild(opt);
    }
  }
  currentRegiment = regiments[0] ?? null;
  if (regimentSelect && currentRegiment) {
    regimentSelect.value = currentRegiment.id;
  }

  // Default facing to first option if not present.
  if (!Array.from(facingSelect.options).some((opt) => opt.value === currentFacing)) {
    if (facingSelect.options.length) {
      currentFacing = facingSelect.options[0].value;
    }
  }
  facingSelect.value = currentFacing;

  if (kitSelect.options.length) {
    const initialKitId = kitSelect.options[0].value || null;
    if (initialKitId) {
      setKit(initialKitId);
      const kit = kitsById.get(initialKitId);
      if (kit) {
        if (!kit.facings[currentFacing]) {
          const available = Object.keys(kit.facings);
          if (available.length) {
            currentFacing = available[0];
            facingSelect.value = currentFacing;
          }
        }
      }
      applyKitDefaults(initialKitId, currentFacing);
    }
  }

  rebuildComponentGroups();
  initEvents();
  await renderPreview();
}

void main().catch((err) => {
  console.error(err);
  infoCard.innerHTML = `<strong>Error:</strong> ${String(err)}`;
});
