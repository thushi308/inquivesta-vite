/* Minimal gl-transitions runner (https://github.com/gl-transitions/gl-transitions).
   One canvas, any number of transitions. run(name, fromImg, toImg, opts) plays one.

   Video support: a uniform whose value is a STRING is treated as a video URL and
   bound as a sampler2D with that uniform's name, e.g.
     customVideo: { glsl, uniforms: { fireVideo: "images/fireVideo.mp4", mode: 1 } }
   and in the shader:  uniform sampler2D fireVideo;
   The video is stretched in time to match the transition duration and is
   cover-fitted to the canvas, exactly like the two images. */

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

function compile(gl, type, src, label = "") {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "";
    const n = Number(/\d+:(\d+)/.exec(log)?.[1]);
    const line = n ? src.split("\n")[n - 1] : "";
    // says WHICH transition failed and shows the exact offending line
    console.error(
      `[gl-transition] "${label}" failed to compile:\n${log}` +
        (line ? `\n--> line ${n}: ${line}` : ""),
    );
    return null;
  }
  return sh;
}

/* Hidden, muted <video>. Preloads so the first run starts instantly. */
function makeVideo(src) {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.setAttribute("playsinline", ""); // iOS Safari
  el.preload = "auto";
  el.crossOrigin = "anonymous"; // needed if the video is served from another domain
  el.src = src;
  el.load();
  return el;
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

  // unit 0 = from, 1 = to, 2+ = videos
  const textures = [];
  const ensureTexture = (unit, transparentSeed = false) => {
    if (textures[unit]) return;
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (transparentSeed) {
      // until the first video frame arrives the sampler returns "nothing"
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]),
      );
    }
    textures[unit] = t;
  };
  ensureTexture(0);
  ensureTexture(1);

  const programs = new Map();
  for (const [name, def] of Object.entries(defs)) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT, name);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment(def.glsl), name);
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

    const videos = [];
    for (const [n, v] of Object.entries(def.uniforms ?? {})) {
      if (typeof v === "string") {
        const unit = 2 + videos.length;
        ensureTexture(unit, true);
        gl.uniform1i(u(n), unit);
        videos.push({ unit, el: makeVideo(v) });
      } else if (typeof v === "number") gl.uniform1f(u(n), v);
      else if (v.length === 3) gl.uniform3fv(u(n), v);
      else if (v.length === 2) gl.uniform2fv(u(n), v);
    }
    programs.set(name, {
      prog,
      videos,
      position: gl.getAttribLocation(prog, "position"),
      progress: u("progress"),
      ratio: u("ratio"),
    });
  }

  // Rasterise an image or video frame with object-fit: cover so it matches what the card shows
  const scratch = document.createElement("canvas");
  const upload = (unit, src, w, h) => {
    const srcW = src.videoWidth || src.naturalWidth;
    const srcH = src.videoHeight || src.naturalHeight;
    if (scratch.width !== w) scratch.width = w;
    if (scratch.height !== h) scratch.height = h;
    const ctx = scratch.getContext("2d");
    ctx.clearRect(0, 0, w, h); // keeps video alpha correct
    const s = Math.max(w / srcW, h / srcH);
    const dw = srcW * s;
    const dh = srcH * s;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
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
      Videos always play forward in time.
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

    // Start the video(s), stretched/squeezed so the clip lasts exactly `duration`
    const stopVideos = () => p.videos.forEach(({ el }) => el.pause());
    for (const { el } of p.videos) {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {}
      const d = el.duration;
      el.playbackRate =
        Number.isFinite(d) && d > 0
          ? Math.min(16, Math.max(0.0625, d / (duration / 1000)))
          : 1;
      el.play().catch(() => {});
    }

    const draw = (t) => {
      const e = easeInOut(t);
      gl.uniform1f(p.progress, reverse ? 1 - e : e);
      for (const { unit, el } of p.videos) {
        if (el.readyState >= 2) upload(unit, el, w, h); // newest video frame
      }
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
        else {
          stopVideos();
          resolve(true);
        }
      };
      raf = requestAnimationFrame(tick);
      cancelCurrent = () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        stopVideos();
        resolve(false);
      };
    });
    return { done, cancel: () => cancelCurrent?.() };
  }

  return { run, has: (name) => programs.has(name) };
}
