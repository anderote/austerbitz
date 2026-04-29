import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { DEBRIS_VS, DEBRIS_FS, KIT_GIB_VS, KIT_GIB_FS } from '../shaders/debris.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import { DebrisKind, type Debris } from '../../sim/debris';
import type { DebrisAtlas } from '../debris-atlas';
import type { KitGibTable } from '../../sim/kit-gib-table';
import { unitKinds, getUnitKindByIndex } from '../../data/units';
import type { KitConfig } from '../poses/kit-loader';

/** Side length of one chunk PNG in pixels (matches `loadDebrisAtlas`). */
const CHUNK_PIXEL = 8;

const SPRITE_CELL_PX = 32;
const KIT_GIB_PX_W = 32;
const KIT_GIB_PX_H = 36;

interface FactionPalette {
  primary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
}

const REGIMENTS: FactionPalette[] = [
  { primary: [40, 80, 190],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
  { primary: [180, 40, 50],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
  { primary: [35, 45, 75],    secondary: [240, 230, 210], tertiary: [15, 15, 20] },
  { primary: [40, 75, 50],    secondary: [240, 230, 210], tertiary: [15, 15, 20] },
  { primary: [225, 215, 195], secondary: [120, 105, 85],  tertiary: [15, 15, 20] },
];
const FALLBACK_REGIMENT = REGIMENTS[0]!;

export interface DebrisPass {
  draw(d: Debris, atlas: DebrisAtlas, cam: Camera, worldUnitsPerPixel: number): void;
}

export function createDebrisPass(
  gl: WebGL2RenderingContext,
  capacity: number,
  spriteAtlas: WebGLTexture | null = null,
  kits: ReadonlyMap<string, KitConfig> = new Map(),
  kitGibTable: KitGibTable | null = null,
  weaponUvByPrefix: ReadonlyMap<string, ReadonlyArray<readonly [number, number, number, number] | null>> = new Map(),
  headUvByPrefix: ReadonlyMap<string, ReadonlyArray<readonly [number, number, number, number] | null>> = new Map(),
): DebrisPass {
  const prog = linkProgram(gl, DEBRIS_VS, DEBRIS_FS);
  const u = getUniforms(
    gl,
    prog,
    ['u_viewProj', 'u_pixelSize', 'u_atlas', 'u_team0', 'u_team1'] as const,
  );

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const uvBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const rotBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  const teamBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  const modulateBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(5, 1);

  gl.bindVertexArray(null);

  // Per-frame scratch — sized once at startup, reused.
  const scratchPos = new Float32Array(capacity * 2);
  const scratchUv = new Float32Array(capacity * 4);
  const scratchRot = new Float32Array(capacity);
  const scratchTeam = new Float32Array(capacity);
  const scratchModulate = new Float32Array(capacity * 3);

  // Team palettes per spec — French blue / British red, RGB 0..1.
  const TEAM0 = new Float32Array([0.15, 0.25, 0.55]);
  const TEAM1 = new Float32Array([0.7, 0.15, 0.15]);

  // ---- Kit-gib pass setup. Skipped if the sprite atlas wasn't provided.
  const kitProg = spriteAtlas ? linkProgram(gl, KIT_GIB_VS, KIT_GIB_FS) : null;
  const kitU = kitProg
    ? getUniforms(gl, kitProg, ['u_viewProj', 'u_atlas'] as const)
    : null;

  let kitVao: WebGLVertexArrayObject | null = null;
  let kitPosBuf: WebGLBuffer | null = null;
  let kitSizeBuf: WebGLBuffer | null = null;
  let kitUvBuf: WebGLBuffer | null = null;
  let kitPrimaryBuf: WebGLBuffer | null = null;
  let kitSecondaryBuf: WebGLBuffer | null = null;
  let kitTertiaryBuf: WebGLBuffer | null = null;
  let kitRotBuf: WebGLBuffer | null = null;

  if (kitProg) {
    kitVao = createVertexArray(gl);
    gl.bindVertexArray(kitVao);
    createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    kitPosBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    kitSizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    kitUvBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);

    kitPrimaryBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);

    kitSecondaryBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1);

    kitTertiaryBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1);

    kitRotBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(7, 1);

    gl.bindVertexArray(null);
  }

  const kScratchPos = new Float32Array(capacity * 2);
  const kScratchSize = new Float32Array(capacity * 2);
  const kScratchUv = new Float32Array(capacity * 4);
  const kScratchPrimary = new Float32Array(capacity * 3);
  const kScratchSecondary = new Float32Array(capacity * 3);
  const kScratchTertiary = new Float32Array(capacity * 3);
  const kScratchRot = new Float32Array(capacity);

  // Per-kitIdx layer prefixes + per-kindIdx px-to-world ratio.
  // Resolved once at construction. Hot-reload of kits is rare; if a kit is
  // missing here at draw time, the gib falls back to the generic-chunk path
  // (kind set to 0 in spawnGibs is sufficient — but here we just skip).
  const kitWeaponPrefix = new Array<string | null>(kitGibTable?.byKitIdx.length ?? 0);
  const kitHeadPrefix = new Array<string | null>(kitGibTable?.byKitIdx.length ?? 0);
  if (kitGibTable) {
    for (let i = 0; i < kitGibTable.byKitIdx.length; i++) {
      const info = kitGibTable.byKitIdx[i]!;
      const kind = getUnitKindByIndex(info.kindIdx);
      const kit = kits.get(kind.id);
      kitWeaponPrefix[i] = kit?.weapon?.layerPrefix ?? null;
      kitHeadPrefix[i] = kit?.head?.layerPrefix ?? null;
    }
  }
  const pxToWorldByKindIdx = new Float32Array(unitKinds.length);
  for (let i = 0; i < unitKinds.length; i++) {
    const k = getUnitKindByIndex(i);
    const sprW = k.spriteSize?.w ?? k.placeholderSize.w;
    pxToWorldByKindIdx[i] = sprW / SPRITE_CELL_PX;
  }

  return {
    draw(d, atlas, cam, worldUnitsPerPixel) {
      const n = d.count;
      if (n === 0) return;

      let gn = 0;
      let kn = 0;
      for (let i = 0; i < n; i++) {
        const id = d.aliveIds[i]!;
        const visualY = d.posY[id]! - d.z[id]!;
        const dKind = d.kind[id]!;
        if (dKind === DebrisKind.GenericChunk) {
          scratchPos[gn * 2 + 0] = d.posX[id]!;
          scratchPos[gn * 2 + 1] = visualY;
          const cId = d.chunkId[id]!;
          scratchUv[gn * 4 + 0] = atlas.uvByChunkId[cId * 4 + 0]!;
          scratchUv[gn * 4 + 1] = atlas.uvByChunkId[cId * 4 + 1]!;
          scratchUv[gn * 4 + 2] = atlas.uvByChunkId[cId * 4 + 2]!;
          scratchUv[gn * 4 + 3] = atlas.uvByChunkId[cId * 4 + 3]!;
          // Pixel-art aesthetic: snap rotation to 8 buckets (every 45°).
          scratchRot[gn] = Math.round(d.spinDeg[id]! / 45) * 45;
          scratchTeam[gn] = d.team[id]!;
          scratchModulate[gn * 3 + 0] = d.tintR[id]! / 255;
          scratchModulate[gn * 3 + 1] = d.tintG[id]! / 255;
          scratchModulate[gn * 3 + 2] = d.tintB[id]! / 255;
          gn++;
        } else if (kitProg && kitGibTable) {
          // Kit head/weapon — resolve UV from the combined sprite atlas.
          const kitIdx = d.kitIdx[id]!;
          if (kitIdx >= kitGibTable.byKitIdx.length) continue;
          const info = kitGibTable.byKitIdx[kitIdx];
          if (!info) continue;
          const facing = d.facing[id]! & 7;
          let uv: readonly [number, number, number, number] | null = null;
          if (dKind === DebrisKind.KitHead) {
            const prefix = kitHeadPrefix[kitIdx];
            if (!prefix) continue;
            const list = headUvByPrefix.get(prefix);
            if (!list) continue;
            uv = list[facing] ?? null;
          } else {
            const prefix = kitWeaponPrefix[kitIdx];
            if (!prefix) continue;
            const list = weaponUvByPrefix.get(prefix);
            if (!list) continue;
            uv = list[facing] ?? null;
          }
          if (!uv) continue;

          const pxToWorld = pxToWorldByKindIdx[info.kindIdx]!;
          const wWorldW = KIT_GIB_PX_W * pxToWorld;
          const wWorldH = KIT_GIB_PX_H * pxToWorld;

          kScratchPos[kn * 2 + 0] = d.posX[id]!;
          kScratchPos[kn * 2 + 1] = visualY;
          kScratchSize[kn * 2 + 0] = wWorldW;
          kScratchSize[kn * 2 + 1] = wWorldH;
          kScratchUv[kn * 4 + 0] = uv[0];
          kScratchUv[kn * 4 + 1] = uv[1];
          kScratchUv[kn * 4 + 2] = uv[2];
          kScratchUv[kn * 4 + 3] = uv[3];
          const team = REGIMENTS[d.team[id]!] ?? FALLBACK_REGIMENT;
          kScratchPrimary[kn * 3 + 0] = team.primary[0] / 255;
          kScratchPrimary[kn * 3 + 1] = team.primary[1] / 255;
          kScratchPrimary[kn * 3 + 2] = team.primary[2] / 255;
          kScratchSecondary[kn * 3 + 0] = team.secondary[0] / 255;
          kScratchSecondary[kn * 3 + 1] = team.secondary[1] / 255;
          kScratchSecondary[kn * 3 + 2] = team.secondary[2] / 255;
          kScratchTertiary[kn * 3 + 0] = team.tertiary[0] / 255;
          kScratchTertiary[kn * 3 + 1] = team.tertiary[1] / 255;
          kScratchTertiary[kn * 3 + 2] = team.tertiary[2] / 255;
          // Snap rotation to 8 buckets, in radians.
          const snappedDeg = Math.round(d.spinDeg[id]! / 45) * 45;
          kScratchRot[kn] = (snappedDeg * Math.PI) / 180;
          kn++;
        }
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // Draw A: generic chunks from the gib atlas.
      if (gn > 0) {
        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, gn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchUv.subarray(0, gn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRot.subarray(0, gn));
        gl.bindBuffer(gl.ARRAY_BUFFER, teamBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchTeam.subarray(0, gn));
        gl.bindBuffer(gl.ARRAY_BUFFER, modulateBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchModulate.subarray(0, gn * 3));

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
        gl.uniform1i(u.u_atlas, 0);
        gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
        gl.uniform1f(u.u_pixelSize, CHUNK_PIXEL * worldUnitsPerPixel);
        gl.uniform3fv(u.u_team0, TEAM0);
        gl.uniform3fv(u.u_team1, TEAM1);

        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, gn);
      }

      // Draw B: kit heads + weapons from the combined sprite atlas.
      if (kn > 0 && kitProg && kitU && spriteAtlas && kitVao) {
        gl.useProgram(kitProg);
        gl.bindVertexArray(kitVao);

        gl.bindBuffer(gl.ARRAY_BUFFER, kitPosBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, kScratchPos.subarray(0, kn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, kitSizeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, kScratchSize.subarray(0, kn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, kitUvBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, kScratchUv.subarray(0, kn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, kitPrimaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, kScratchPrimary.subarray(0, kn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, kitSecondaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, kScratchSecondary.subarray(0, kn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, kitTertiaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, kScratchTertiary.subarray(0, kn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, kitRotBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, kScratchRot.subarray(0, kn));

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, spriteAtlas);
        gl.uniform1i(kitU.u_atlas, 0);
        gl.uniformMatrix3fv(kitU.u_viewProj, false, viewProjection(cam));

        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, kn);
      }

      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
  };
}
