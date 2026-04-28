import { describe, expect, it } from 'vitest';
import { resolveWeaponEdits } from './bake-weapon-edits.mjs';

function makeRegistry(entries) {
  return { components: entries.map(([id, path]) => ({ id, path })) };
}

describe('resolveWeaponEdits', () => {
  const registry = makeRegistry([
    ['musket-brown-bess-north', 'weapon/musket/north/idle.png'],
    ['musket-brown-bess-northwest', 'weapon/musket/northwest/idle.png'],
    ['musket-brown-bess-west', 'weapon/musket/west/idle.png'],
  ]);

  it('returns one job per (kit, facing, weapon-component-id) tuple with non-empty edits', () => {
    const pixelEdits = {
      'line-infantry': {
        weapon: {
          N: {
            'musket-brown-bess-north': [{ x: 1, y: 2, color: '#ffffff' }],
          },
          NW: {
            'musket-brown-bess-northwest': [
              { x: 0, y: 0, color: '#000000' },
              { x: 1, y: 1, color: 'clear' },
            ],
          },
        },
      },
    };
    const jobs = resolveWeaponEdits(pixelEdits, registry);
    expect(jobs).toHaveLength(2);
    const byPath = Object.fromEntries(jobs.map((j) => [j.srcPath, j]));
    expect(byPath['weapon/musket/north/idle.png'].edits).toHaveLength(1);
    expect(byPath['weapon/musket/northwest/idle.png'].edits).toHaveLength(2);
    expect(byPath['weapon/musket/north/idle.png'].kit).toBe('line-infantry');
    expect(byPath['weapon/musket/north/idle.png'].facing).toBe('N');
    expect(byPath['weapon/musket/north/idle.png'].componentId).toBe(
      'musket-brown-bess-north',
    );
  });

  it('skips kits that have no weapon key', () => {
    const pixelEdits = {
      'line-infantry': {
        idle: { S: { 'musket-brown-bess-south': [{ x: 0, y: 0, color: '#fff' }] } },
      },
      'british-line-infantry': {
        idle: { S: { 'musket-brown-bess-south': [{ x: 0, y: 0, color: '#fff' }] } },
      },
    };
    const jobs = resolveWeaponEdits(pixelEdits, registry);
    expect(jobs).toEqual([]);
  });

  it('skips facings whose edit list is empty or non-array', () => {
    const pixelEdits = {
      'line-infantry': {
        weapon: {
          N: {
            'musket-brown-bess-north': [],
          },
          W: {
            'musket-brown-bess-west': null,
          },
          NW: {
            'musket-brown-bess-northwest': [{ x: 0, y: 0, color: '#fff' }],
          },
        },
      },
    };
    const jobs = resolveWeaponEdits(pixelEdits, registry);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].componentId).toBe('musket-brown-bess-northwest');
  });

  it('warns and skips component-ids not in the registry', () => {
    const pixelEdits = {
      'line-infantry': {
        weapon: {
          N: {
            'musket-brown-bess-north': [{ x: 0, y: 0, color: '#fff' }],
            'unknown-weapon-id': [{ x: 1, y: 1, color: '#000' }],
          },
        },
      },
    };
    const warnings = [];
    const jobs = resolveWeaponEdits(pixelEdits, registry, {
      warn: (msg) => warnings.push(msg),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].componentId).toBe('musket-brown-bess-north');
    expect(warnings.some((w) => w.includes('unknown-weapon-id'))).toBe(true);
  });

  it('honors the kit filter', () => {
    const pixelEdits = {
      'line-infantry': {
        weapon: {
          N: { 'musket-brown-bess-north': [{ x: 0, y: 0, color: '#fff' }] },
        },
      },
      'other-kit': {
        weapon: {
          NW: { 'musket-brown-bess-northwest': [{ x: 0, y: 0, color: '#fff' }] },
        },
      },
    };
    const jobs = resolveWeaponEdits(pixelEdits, registry, { kit: 'line-infantry' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kit).toBe('line-infantry');
  });
});
