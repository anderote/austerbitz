export function createTextureRGBA(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  pixels: Uint8Array | null,
  opts: { mag?: number; min?: number; wrap?: number } = {},
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.mag ?? gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.min ?? gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ?? gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap ?? gl.REPEAT);
  return tex;
}
