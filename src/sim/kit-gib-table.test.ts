import { describe, expect, it } from 'vitest';
import { buildKitGibTable, type ChunkIdLookup } from './kit-gib-table';
import type { KitConfig } from '../render/poses/kit-loader';
import { unitKinds } from '../data/units';

const CHUNK_INDEX: ChunkIdLookup = new Map<string, number>([
  ['head', 0],
  ['arm', 1],
  ['leg', 2],
  ['torso', 3],
  ['hat', 4],
  ['meat-blob', 5],
  ['arm-uniformed', 6],
  ['arm-bare', 7],
  ['leg-trousered', 8],
  ['leg-bare', 9],
  ['boot', 10],
  ['musket-stock', 11],
  ['cartridge-box', 12],
  ['epaulette', 13],
  ['hand', 14],
  ['finger', 15],
]);

function makeKit(id: string, gibChunks?: KitConfig['gibChunks']): KitConfig {
  const k: KitConfig = { id };
  if (gibChunks) k.gibChunks = gibChunks;
  return k;
}

describe('buildKitGibTable — gibChunks resolution', () => {
  it('resolves a kit with gibChunks to non-empty pools', () => {
    const kits = new Map<string, KitConfig>([
      ['line-infantry', makeKit('line-infantry', {
        arm: ['arm-uniformed', 'hand'],
        leg: ['leg-trousered', 'boot'],
        misc: ['musket-stock', 'cartridge-box', 'epaulette', 'finger'],
      })],
    ]);
    const table = buildKitGibTable(kits, CHUNK_INDEX);
    const lineIdx = unitKinds.findIndex((u) => u.id === 'line-infantry');
    const info = table.byKindIdx[lineIdx];
    expect(info).not.toBeNull();
    expect(info!.armChunkIds).toEqual([6, 14]);
    expect(info!.legChunkIds).toEqual([8, 10]);
    expect(info!.miscChunkIds).toEqual([11, 12, 13, 15]);
  });

  it('kit without gibChunks gets empty pools (legacy single-id fallback path)', () => {
    const kits = new Map<string, KitConfig>([
      ['cuirassier', makeKit('cuirassier')],
    ]);
    const table = buildKitGibTable(kits, CHUNK_INDEX);
    const cuirIdx = unitKinds.findIndex((u) => u.id === 'cuirassier');
    const info = table.byKindIdx[cuirIdx];
    expect(info).not.toBeNull();
    expect(info!.armChunkIds).toEqual([]);
    expect(info!.legChunkIds).toEqual([]);
    expect(info!.miscChunkIds).toEqual([]);
  });

  it('absent chunkIdLookup leaves all pools empty', () => {
    const kits = new Map<string, KitConfig>([
      ['line-infantry', makeKit('line-infantry', {
        arm: ['arm-uniformed'],
        misc: ['epaulette'],
      })],
    ]);
    const table = buildKitGibTable(kits);
    const lineIdx = unitKinds.findIndex((u) => u.id === 'line-infantry');
    const info = table.byKindIdx[lineIdx];
    expect(info!.armChunkIds).toEqual([]);
    expect(info!.miscChunkIds).toEqual([]);
  });

  it('unknown chunk ids in a pool are silently dropped', () => {
    const kits = new Map<string, KitConfig>([
      ['line-infantry', makeKit('line-infantry', {
        arm: ['arm-uniformed', 'this-does-not-exist', 'hand'],
      })],
    ]);
    const table = buildKitGibTable(kits, CHUNK_INDEX);
    const lineIdx = unitKinds.findIndex((u) => u.id === 'line-infantry');
    const info = table.byKindIdx[lineIdx];
    expect(info!.armChunkIds).toEqual([6, 14]);
  });
});
