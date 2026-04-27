export function getGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 not supported in this browser');
  return gl;
}

export function resizeToDisplay(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): boolean {
  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  // Pin CSS size to the viewport. Without this, the canvas's intrinsic size
  // (canvas.width/height) leaks into layout, and on hi-DPI displays the canvas
  // ends up displayed at 2× the viewport — making "screen center" in the
  // rendering math line up with the visible bottom-right corner.
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }
  return false;
}
