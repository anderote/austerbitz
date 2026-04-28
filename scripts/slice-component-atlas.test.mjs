import { describe, expect, it } from 'vitest';
import { buildWorkList } from './slice-component-atlas.mjs';

describe('slice-component-atlas buildWorkList', () => {
  it('emits idle entry referencing the unsuffixed atlas with all 8 cells', () => {
    const kit = { id: 'line-infantry', poses: {} };
    const work = buildWorkList(kit, 'line-infantry');
    expect(work).toHaveLength(1);
    expect(work[0].runtimePose).toBe('idle');
    expect(work[0].atlasFile).toBe('line-infantry-components.png');
    expect(work[0].frameIdx).toBe(0);
    expect(work[0].cells).toHaveLength(8);
  });

  it('translates kit pose names to runtime pose names', () => {
    const kit = {
      id: 'line-infantry',
      poses: { 'make-ready': { S: ['x'] } },
    };
    const work = buildWorkList(kit, 'line-infantry');
    const reload = work.find((w) => w.runtimePose === 'reloading');
    expect(reload).toBeDefined();
    expect(reload.atlasFile).toBe('line-infantry-components-make-ready.png');
    expect(reload.cells.map((c) => c.dir)).toEqual(['S']);
  });

  it('skips poses in SKIP_KIT_POSES (musket, hit)', () => {
    const kit = {
      id: 'line-infantry',
      poses: {
        musket: { S: ['x'] },
        hit:    { S: ['x'] },
        fire:   { S: ['x'] },
      },
    };
    const work = buildWorkList(kit, 'line-infantry');
    expect(work.find((w) => w.kitPose === 'musket')).toBeUndefined();
    expect(work.find((w) => w.kitPose === 'hit')).toBeUndefined();
    expect(work.find((w) => w.kitPose === 'fire')).toBeDefined();
  });

  it('emits one entry per frame for a multi-frame pose', () => {
    const kit = {
      id: 'line-infantry',
      poses: {
        walking: {
          S: [['a0'], ['a1'], ['a2'], ['a3']],
          N: [['b0'], ['b1'], ['b2'], ['b3']],
        },
      },
    };
    const work = buildWorkList(kit, 'line-infantry').filter((w) => w.runtimePose === 'walking');
    expect(work).toHaveLength(4);
    expect(work.map((w) => w.frameIdx)).toEqual([0, 1, 2, 3]);
    expect(work[0].atlasFile).toBe('line-infantry-components-walking-0.png');
    expect(work[3].atlasFile).toBe('line-infantry-components-walking-3.png');
  });
});
