import { recolorImageData, type Regiment } from './regiments';

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const recolorCache = new Map<string, HTMLCanvasElement>();

export function loadImage(url: string): Promise<HTMLImageElement> {
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

export async function getRecoloredCanvas(url: string, reg: Regiment): Promise<HTMLCanvasElement> {
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
