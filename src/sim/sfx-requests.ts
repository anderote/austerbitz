export interface SfxRequests {
  capacity: number;
  count: number;
  name: string[];
  x: Float32Array;
  y: Float32Array;
}

export function createSfxRequests(capacity: number): SfxRequests {
  return {
    capacity, count: 0,
    name: [],
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
  };
}

export function pushSfxRequest(s: SfxRequests, name: string, x: number, y: number): void {
  if (s.count >= s.capacity) return;
  s.name[s.count] = name;
  s.x[s.count] = x;
  s.y[s.count] = y;
  s.count++;
}

export function clearSfxRequests(s: SfxRequests): void {
  s.count = 0;
  s.name.length = 0;
}
