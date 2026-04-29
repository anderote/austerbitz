import type { UnitKind } from '../types';
import { lineInfantry } from './line-infantry';
import { cuirassier } from './cuirassier';
import { cannon12 } from './cannon-12';
import { gunCrewSponger } from './gun-crew-sponger';
import { gunCrewRammer } from './gun-crew-rammer';
import { gunCrewLoader } from './gun-crew-loader';
import { gunCrewGunner } from './gun-crew-gunner';

export const unitKinds: readonly UnitKind[] = [
  lineInfantry,
  cuirassier,
  cannon12,
  gunCrewSponger,
  gunCrewRammer,
  gunCrewLoader,
  gunCrewGunner,
];

const idToIndex = new Map<string, number>();
unitKinds.forEach((k, i) => idToIndex.set(k.id, i));

export function getUnitKind(id: string): UnitKind {
  const idx = idToIndex.get(id);
  if (idx === undefined) throw new Error(`Unknown unit kind: ${id}`);
  return unitKinds[idx]!;
}

export function getUnitKindIndex(id: string): number {
  const idx = idToIndex.get(id);
  if (idx === undefined) throw new Error(`Unknown unit kind: ${id}`);
  return idx;
}

export function getUnitKindByIndex(idx: number): UnitKind {
  const k = unitKinds[idx];
  if (!k) throw new Error(`Unit kind index out of range: ${idx}`);
  return k;
}
