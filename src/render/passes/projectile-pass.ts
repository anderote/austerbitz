import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { PROJECTILE_VS, PROJECTILE_FS } from '../shaders/projectile.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { Projectiles } from '../../sim/projectiles';
import { ProjectileKind } from '../../sim/projectiles';

export interface ProjectilePass {
  draw(projectiles: Projectiles, cam: Camera): void;
}

/**
 * One bucket's worth of per-instance scratch arrays plus the live count.
 *
 * Each scratch array is sized to hold up to `capacity` instances; only the
 * first `count` entries are valid.
 */
export interface ProjectileBucket {
  count: number;
  centerWorld: Float32Array; // vec2 per instance
  sizeOrLen: Float32Array;   // vec2 per instance
  rotation: Float32Array;    // float per instance
  kind: Float32Array;        // float per instance (constant within bucket, but stored for upload uniformity)
  color: Float32Array;       // vec4 per instance
}

export interface ProjectileInstanceBuckets {
  shadow: ProjectileBucket;
  ball: ProjectileBucket;
  musket: ProjectileBucket;
  streak: ProjectileBucket;
}

function makeBucket(capacity: number): ProjectileBucket {
  return {
    count: 0,
    centerWorld: new Float32Array(capacity * 2),
    sizeOrLen: new Float32Array(capacity * 2),
    rotation: new Float32Array(capacity),
    kind: new Float32Array(capacity),
    color: new Float32Array(capacity * 4),
  };
}

function pushShadow(b: ProjectileBucket, cx: number, cy: number): void {
  const i = b.count;
  b.centerWorld[i * 2 + 0] = cx;
  b.centerWorld[i * 2 + 1] = cy;
  b.sizeOrLen[i * 2 + 0] = 0.18;
  b.sizeOrLen[i * 2 + 1] = 0.10;
  b.rotation[i] = 0;
  b.kind[i] = 2;
  b.color[i * 4 + 0] = 0;
  b.color[i * 4 + 1] = 0;
  b.color[i * 4 + 2] = 0;
  b.color[i * 4 + 3] = 0.4;
  b.count = i + 1;
}

function pushBall(b: ProjectileBucket, cx: number, cy: number): void {
  const i = b.count;
  b.centerWorld[i * 2 + 0] = cx;
  b.centerWorld[i * 2 + 1] = cy;
  b.sizeOrLen[i * 2 + 0] = 0.18;
  b.sizeOrLen[i * 2 + 1] = 0.18;
  b.rotation[i] = 0;
  b.kind[i] = 1;
  b.color[i * 4 + 0] = 0.18;
  b.color[i * 4 + 1] = 0.18;
  b.color[i * 4 + 2] = 0.18;
  b.color[i * 4 + 3] = 1.0;
  b.count = i + 1;
}

// Sizes are tuned for the default zoom of 12 px / world unit.
const MUSKET_BALL_SIZE = 1 / 12;       // 1 px square
const MUSKET_STREAK_LEN = 24 / 12;     // 24 px trailing streak
const MUSKET_STREAK_WIDTH = 1 / 12;    // 1 px wide

function pushMusket(b: ProjectileBucket, cx: number, cy: number): void {
  const i = b.count;
  b.centerWorld[i * 2 + 0] = cx;
  b.centerWorld[i * 2 + 1] = cy;
  b.sizeOrLen[i * 2 + 0] = MUSKET_BALL_SIZE;
  b.sizeOrLen[i * 2 + 1] = MUSKET_BALL_SIZE;
  b.rotation[i] = 0;
  b.kind[i] = 0;
  b.color[i * 4 + 0] = 0.78;
  b.color[i * 4 + 1] = 0.78;
  b.color[i * 4 + 2] = 0.78;
  b.color[i * 4 + 3] = 1.0;
  b.count = i + 1;
}

function pushStreak(
  b: ProjectileBucket,
  cx: number, cy: number,
  vx: number, vy: number,
): void {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-3) return;
  const dirX = vx / speed;
  const dirY = vy / speed;
  const i = b.count;
  // Trail behind the ball: shift center back along velocity by half-length.
  b.centerWorld[i * 2 + 0] = cx - dirX * (MUSKET_STREAK_LEN * 0.5);
  b.centerWorld[i * 2 + 1] = cy - dirY * (MUSKET_STREAK_LEN * 0.5);
  b.sizeOrLen[i * 2 + 0] = MUSKET_STREAK_LEN;
  b.sizeOrLen[i * 2 + 1] = MUSKET_STREAK_WIDTH;
  b.rotation[i] = Math.atan2(dirY, dirX);
  b.kind[i] = 3;
  b.color[i * 4 + 0] = 1.0;
  b.color[i * 4 + 1] = 1.0;
  b.color[i * 4 + 2] = 1.0;
  b.color[i * 4 + 3] = 0.4;
  b.count = i + 1;
}

/**
 * Pure helper: walk the live projectile pool and emit instance data into
 * the three buckets. Exported (and called by `draw`) so tests can validate
 * the conversion logic without needing a GL context.
 *
 * The provided `buckets` are mutated in place; their `count` fields are
 * reset to 0 first.
 */
export function computeProjectileInstances(
  projectiles: Projectiles,
  buckets: ProjectileInstanceBuckets,
): void {
  buckets.shadow.count = 0;
  buckets.ball.count = 0;
  buckets.musket.count = 0;
  buckets.streak.count = 0;

  const p = projectiles;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const kind = p.kind[i]!;
    const px = p.posX[i]!;
    const py = p.posY[i]!;
    const pz = p.posZ[i]!;

    if (kind === ProjectileKind.SolidShot || kind === ProjectileKind.Shell) {
      // Shadow lives on the ground plane.
      pushShadow(buckets.shadow, px, py);
      // Ball is lifted by Z.
      pushBall(buckets.ball, px, py - pz);
    } else if (kind === ProjectileKind.Musket) {
      const cy = py - pz;
      pushStreak(buckets.streak, px, cy, p.velX[i]!, p.velY[i]!);
      pushMusket(buckets.musket, px, cy);
    }
  }
}

export function createProjectileInstanceBuckets(capacity: number): ProjectileInstanceBuckets {
  return {
    shadow: makeBucket(capacity),
    ball: makeBucket(capacity),
    musket: makeBucket(capacity),
    streak: makeBucket(capacity),
  };
}

export function createProjectilePass(
  gl: WebGL2RenderingContext,
  capacity: number,
): ProjectilePass {
  const prog = linkProgram(gl, PROJECTILE_VS, PROJECTILE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  // Quad corners (-0.5..0.5), shared with particle pass.
  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Per-instance VBOs. Each is sized for `capacity` instances; the same VBO
  // set is re-uploaded once per bucket per frame (shadow → ball → musket).
  const centerBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const sizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const rotBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  const kindBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  const colorBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(5, 1);

  gl.bindVertexArray(null);

  const buckets = createProjectileInstanceBuckets(capacity);

  function uploadAndDraw(b: ProjectileBucket): void {
    if (b.count === 0) return;
    const n = b.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, centerBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.centerWorld.subarray(0, n * 2));
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.sizeOrLen.subarray(0, n * 2));
    gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.rotation.subarray(0, n));
    gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.kind.subarray(0, n));
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.color.subarray(0, n * 4));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }

  return {
    draw(projectiles, cam) {
      computeProjectileInstances(projectiles, buckets);
      const total =
        buckets.shadow.count +
        buckets.ball.count +
        buckets.musket.count +
        buckets.streak.count;
      if (total === 0) return;

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));

      // Render order: shadows under everything; streaks behind balls; opaque balls on top.

      // Shadows + streaks: standard alpha blend.
      if (buckets.shadow.count > 0 || buckets.streak.count > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        uploadAndDraw(buckets.shadow);
        uploadAndDraw(buckets.streak);
      }

      // Cannonballs and musket balls: opaque hard-edged pixels.
      if (buckets.ball.count > 0 || buckets.musket.count > 0) {
        gl.disable(gl.BLEND);
        uploadAndDraw(buckets.ball);
        uploadAndDraw(buckets.musket);
      }

      gl.bindVertexArray(null);
    },
  };
}
