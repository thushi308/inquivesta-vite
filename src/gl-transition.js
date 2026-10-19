/* Minimal gl-transitions runner (https://github.com/gl-transitions/gl-transitions).
   One canvas, any number of transitions. run(name, fromImg, toImg, opts) plays one. */

const VERT = `
attribute vec2 position;
varying vec2 _uv;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  _uv = vec2(0.5, 0.5) * (position + vec2(1.0, 1.0));
}`;

const fragment = (glsl) => `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 _uv;
uniform sampler2D from, to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv) { return texture2D(from, vec2(uv.x, 1.0 - uv.y)); }
vec4 getToColor(vec2 uv) { return texture2D(to, vec2(uv.x, 1.0 - uv.y)); }
${glsl}
void main() { gl_FragColor = transition(_uv); }`;

const easeInOut = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

/** defs: { name: { glsl, uniforms? } }. Returns null when WebGL is unavailable. */
export function createGLTransitions(canvas, defs) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false });
  if (!gl) return null;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const textures = [0, 1].map((unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  });

  const programs = new Map();
  for (const [name, def] of Object.entries(defs)) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment(def.glsl));
    if (!vs || !fs) continue;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(`gl-transition "${name}" failed to link`);
      continue;
    }
    gl.useProgram(prog);
    const u = (n) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u("from"), 0);
    gl.uniform1i(u("to"), 1);
    for (const [n, v] of Object.entries(def.uniforms ?? {})) {
      if (typeof v === "number") gl.uniform1f(u(n), v);
      else if (v.length === 3) gl.uniform3fv(u(n), v);
      else if (v.length === 2) gl.uniform2fv(u(n), v);
    }
    programs.set(name, {
      prog,
      position: gl.getAttribLocation(prog, "position"),
      progress: u("progress"),
      ratio: u("ratio"),
    });
  }

  // Rasterise an image with object-fit: cover so it matches what the card shows
  const scratch = document.createElement("canvas");
  const upload = (unit, img, w, h) => {
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext("2d");
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      scratch,
    );
  };

  let cancelCurrent = null;

  /** Plays a transition from fromImg to toImg.
      opts.reverse plays the same transition backwards (progress 1 -> 0, images swapped).
      `done` resolves true when finished, false if cancelled. */
  function run(
    name,
    fromImg,
    toImg,
    { duration = 1400, reverse = false } = {},
  ) {
    const p = programs.get(name);
    if (!p) throw new Error(`Unknown gl-transition "${name}"`);
    cancelCurrent?.();

    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(box.height * dpr));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);

    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(p.position);
    gl.vertexAttribPointer(p.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(p.ratio, w / h);

    // Reversed: B -> A with progress running 1 -> 0 looks like A -> B played backwards
    const [a, b] = reverse ? [toImg, fromImg] : [fromImg, toImg];
    upload(0, a, w, h);
    upload(1, b, w, h);

    const draw = (t) => {
      const e = easeInOut(t);
      gl.uniform1f(p.progress, reverse ? 1 - e : e);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    draw(0); // first frame matches what was on screen: no flash

    let cancelled = false;
    let raf = 0;
    const done = new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now) => {
        if (cancelled) return resolve(false);
        const t = Math.min((now - t0) / duration, 1);
        draw(t);
        if (t < 1) raf = requestAnimationFrame(tick);
        else resolve(true);
      };
      raf = requestAnimationFrame(tick);
      cancelCurrent = () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        resolve(false);
      };
    });
    return { done, cancel: () => cancelCurrent?.() };
  }

  return { run, has: (name) => programs.has(name) };
}
