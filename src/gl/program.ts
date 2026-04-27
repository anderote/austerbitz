export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '<no log>';
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed:\n${log}\n--- source ---\n${src}`);
  }
  return sh;
}

export function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram returned null');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? '<no log>';
    gl.deleteProgram(prog);
    throw new Error(`Program link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export function getUniforms<K extends string>(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  names: readonly K[],
): Record<K, WebGLUniformLocation> {
  const out = {} as Record<K, WebGLUniformLocation>;
  for (const n of names) {
    const loc = gl.getUniformLocation(prog, n);
    if (!loc) throw new Error(`Uniform "${n}" not found`);
    out[n] = loc;
  }
  return out;
}
