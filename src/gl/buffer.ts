export function createBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  data: ArrayBufferView | null,
  usage: number,
): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error('createBuffer returned null');
  gl.bindBuffer(target, buf);
  if (data) gl.bufferData(target, data, usage);
  return buf;
}

export function updateBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  buf: WebGLBuffer,
  data: ArrayBufferView,
  usage: number,
): void {
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, usage);
}

export function createVertexArray(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray returned null');
  return vao;
}
