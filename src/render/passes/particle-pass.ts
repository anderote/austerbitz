import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { PARTICLE_VS, PARTICLE_FS } from '../shaders/particle.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import { ParticleClass, type Particles } from '../../particles/particles';

// Per-class alpha multiplier baked into the lifeRatio fade. Blood spurts
// looked too saturated against the new desaturated terrain — knock them
// back so they read as droplets rather than a wash of red.
const CLASS_ALPHA: Record<ParticleClass, number> = {
  [ParticleClass.Dust]: 1,
  [ParticleClass.Smoke]: 1,
  [ParticleClass.Flash]: 1,
  [ParticleClass.Blood]: 0.6,
  [ParticleClass.Debris]: 1,
  [ParticleClass.Ring]: 1,
  [ParticleClass.Ember]: 1,
};

export interface ParticlePass {
  /**
   * Draw particles. If `klassMask` is provided, only particles whose
   * `(1 << klass) & klassMask` is non-zero are rendered.
   */
  draw(particles: Particles, cam: Camera, klassMask?: number): void;
}

export function createParticlePass(gl: WebGL2RenderingContext, capacity: number): ParticlePass {
  const prog = linkProgram(gl, PARTICLE_VS, PARTICLE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const sizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const colorBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity);
  const scratchColor = new Float32Array(capacity * 4);

  return {
    draw(p, cam, klassMask) {
      let n = 0;
      for (let i = 0; i < p.capacity; i++) {
        if (p.alive[i] === 0) continue;
        if (klassMask !== undefined && ((1 << p.klass[i]!) & klassMask) === 0) continue;
        scratchPos[n * 2 + 0] = p.posX[i]!;
        scratchPos[n * 2 + 1] = p.posY[i]!;
        scratchSize[n] = p.size[i]!;
        const t = p.lifeMax[i]! > 0 ? p.life[i]! / p.lifeMax[i]! : 0;
        const a = t * CLASS_ALPHA[p.klass[i]! as ParticleClass];
        scratchColor[n * 4 + 0] = p.r[i]!;
        scratchColor[n * 4 + 1] = p.g[i]!;
        scratchColor[n * 4 + 2] = p.b[i]!;
        scratchColor[n * 4 + 3] = a;
        n++;
      }
      if (n === 0) return;

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchColor.subarray(0, n * 4));
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied additive-ish
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
  };
}
