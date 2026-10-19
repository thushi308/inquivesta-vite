/**
 * river.js: a clip-art style WebGL river that follows ANY SVG path,
 * plus a boat (normal DOM element) positioned along it.
 *
 * How it works
 *  1. The SVG path is sampled into points (getPointAtLength).
 *  2. Points are mapped into the container (stretched to fill it).
 *     On desktop the same path is rotated 90° (top -> left), or you can
 *     pass a separate `landscape` path.
 *  3. A triangle-strip "ribbon" is built along the points. Each vertex carries
 *     (distance along the river, distance across it) in CSS px.
 *  4. The fragment shader paints bank, outline, two-tone water and flowing
 *     foam dashes from those two numbers. Nothing in it depends on the
 *     shape of the curve, so changing the path needs no other change.
 *
 * Width and colours come from CSS custom properties on the root element
 * (see style.css): --river-width, --river-bank-width, --river-water,
 * --river-deep, --river-foam, --river-sand, --river-outline.
 */

const NS = "http://www.w3.org/2000/svg";
const FEATHER = 2; // extra px around the bank for anti-aliasing
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/* ---------------- shaders ---------------- */
const VERT = `
attribute vec2 aPos;   // CSS px
attribute vec2 aUV;    // x: px along the river, y: px across (signed)
uniform vec2 uSize;    // container size in CSS px
varying vec2 vUV;
void main() {
  vec2 ndc = vec2(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUV;
uniform float uTime;
uniform float uLen;     // river length in px
uniform float uWater;   // half width of the water in px
uniform float uBank;    // bank thickness in px
uniform vec3 uWaterCol;
uniform vec3 uDeepCol;
uniform vec3 uFoamCol;
uniform vec3 uSandCol;
uniform vec3 uLineCol;

// a dash with round ends: a = position along the dash, c = offset across it
float dash(float a, float c, float halfLen, float r) {
  float d = length(vec2(max(abs(a) - halfLen, 0.0), c));
  return 1.0 - smoothstep(r - 1.0, r, d);
}

void main() {
  float u = vUV.x;
  float y = vUV.y;
  // beyond either end the distance becomes radial, which makes round caps
  float along = max(max(-u, 0.0), max(u - uLen, 0.0));
  float d = length(vec2(along, y));

  float H = uWater + uBank;
  float alpha = 1.0 - smoothstep(H - 1.0, H, d);
  if (alpha <= 0.0) discard;

  // bank + outline
  float outlineMask = 1.0 - smoothstep(uWater + 2.5 - 1.0, uWater + 2.5, d);
  vec3 col = mix(uSandCol, uLineCol, outlineMask);

  // water: flat two-tone, deeper towards the banks
  float waterMask = 1.0 - smoothstep(uWater - 1.0, uWater, d);
  float deep = smoothstep(uWater * 0.62 - 1.0, uWater * 0.62, d);
  vec3 water = mix(uWaterCol, uDeepCol, deep);
  col = mix(col, water, waterMask);

  // flowing foam dashes (they travel in the direction of increasing u)
  float foam = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float lane = (fi - 1.0) * 0.42 * uWater;
    float period = 90.0 + fi * 23.0;
    float speed = 26.0 + fi * 9.0;
    float wob = sin(u * 0.035 + fi * 2.1 + uTime * 0.6) * 0.10 * uWater;
    float a = mod(u - uTime * speed + fi * 37.0, period) - period * 0.5;
    foam = max(foam, dash(a, y - lane - wob, 14.0 + fi * 4.0, 1.6));
  }
  col = mix(col, uFoamCol, foam * waterMask * 0.9);

  gl_FragColor = vec4(col * alpha, alpha); // premultiplied
}`;

/* ---------------- helpers ---------------- */
const sampleCache = new Map();

/** Sample the path once, in its own viewBox units. */
function samplePath(d) {
  if (sampleCache.has(d)) return sampleCache.get(d);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;visibility:hidden";
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  document.body.appendChild(svg); // attached, so every browser can measure it
  const len = path.getTotalLength();
  const n = clamp(Math.ceil(len / 2), 100, 1500);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = path.getPointAtLength((len * i) / n);
    pts.push([p.x, p.y]);
  }
  svg.remove();
  sampleCache.set(d, pts);
  return pts;
}

/** Map viewBox-space samples into container px. */
function layoutPath(samples, viewBox, rotate, W, H, inset) {
  const [vx, vy, vw, vh] = viewBox;
  const aw = Math.max(W - 2 * inset, 1);
  const ah = Math.max(H - 2 * inset, 1);
  const pts = samples.map(([x, y]) => {
    let fx = (x - vx) / vw;
    let fy = (y - vy) / vh;
    if (rotate) [fx, fy] = [fy, 1 - fx]; // 90° counter-clockwise: top -> left
    return [inset + fx * aw, inset + fy * ah];
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
    );
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

/** Triangle strip: [x, y, u, v] per vertex, with an extra pair at each end for the caps. */
function buildMesh({ pts }, cumLenFn, half) {
  const n = pts.length;
  const out = new Float32Array((n + 2) * 2 * 4);
  let o = 0;
  const push = (x, y, u, v) => {
    out[o++] = x;
    out[o++] = y;
    out[o++] = u;
    out[o++] = v;
  };
  const tangent = (i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n - 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const pair = (x, y, tx, ty, u) => {
    const nx = -ty;
    const ny = tx;
    push(x + nx * half, y + ny * half, u, half);
    push(x - nx * half, y - ny * half, u, -half);
  };
  let [tx, ty] = tangent(0);
  pair(pts[0][0] - tx * half, pts[0][1] - ty * half, tx, ty, -half);
  for (let i = 0; i < n; i++) {
    [tx, ty] = tangent(i);
    pair(pts[i][0], pts[i][1], tx, ty, cumLenFn(i));
  }
  [tx, ty] = tangent(n - 1);
  pair(
    pts[n - 1][0] + tx * half,
    pts[n - 1][1] + ty * half,
    tx,
    ty,
    cumLenFn(n - 1) + half,
  );
  return out;
}

const colorCtx = document
  .createElement("canvas")
  .getContext("2d", { willReadFrequently: true });
/** Any CSS colour -> { css, rgb:[0..1] } */
function readColor(style, name, fallback) {
  const css = style.getPropertyValue(name).trim() || fallback;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = css;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  return { css, rgb: [d[0] / 255, d[1] / 255, d[2] / 255] };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}

/* ---------------- main ---------------- */
/**
 * @param {HTMLElement} root  element containing .river__canvas and .river__boat
 * @param {object} opts
 *   portrait   { d, viewBox:[x,y,w,h] }  path used on small screens
 *   landscape  { d, viewBox } | null     null = rotate `portrait` 90° on desktop
 *   landscapeQuery  media query that switches to landscape (default "(min-width: 900px)")
 *   margin     px between the bank and the container edge (default 16)
 *   start, end ISO date strings; the boat's position = how far "now" is between them
 *   progress   number 0..1; if given, overrides the dates (handy for testing)
 *   boatFacing degrees: where the boat artwork points (0 = right, 90 = down). Default 0
 *   onLayout   called after every (re)layout, so event markers can be repositioned
 */
export function createRiver(root, opts) {
  const o = {
    landscape: null,
    landscapeQuery: "(min-width: 900px)",
    margin: 16,
    boatFacing: 0,
    ...opts,
  };
  let canvas = root.querySelector(".river__canvas");
  const boat = root.querySelector(".river__boat");
  const boatImg = boat && boat.querySelector("img");
  const mq = window.matchMedia(o.landscapeQuery);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let gl = null;
  let prog = null;
  let buf = null;
  let loc = {};
  let vertCount = 0;
  let poly = null;
  let progress = 0;
  let visible = true;
  let raf = 0;
  let lastW = 0;
  let lastH = 0;

  /* ----- WebGL setup ----- */
  function initGL() {
    try {
      gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
      });
      if (!gl) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      loc = {
        aPos: gl.getAttribLocation(prog, "aPos"),
        aUV: gl.getAttribLocation(prog, "aUV"),
      };
      for (const n of [
        "uSize",
        "uTime",
        "uLen",
        "uWater",
        "uBank",
        "uWaterCol",
        "uDeepCol",
        "uFoamCol",
        "uSandCol",
        "uLineCol",
      ]) {
        loc[n] = gl.getUniformLocation(prog, n);
      }
      buf = gl.createBuffer();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return true;
    } catch (err) {
      console.error("[river] WebGL failed, using 2D fallback:", err);
      const fresh = canvas.cloneNode(false); // a canvas that has a WebGL context can't become 2D
      canvas.replaceWith(fresh);
      canvas = fresh;
      gl = null;
      return false;
    }
  }

  /* ----- layout + upload ----- */
  function rebuild() {
    const W = root.clientWidth;
    const H = root.clientHeight;
    if (!W || !H) return;
    lastW = W;
    lastH = H;

    const style = getComputedStyle(root);
    const water =
      (parseFloat(style.getPropertyValue("--river-width")) || 56) / 2;
    const bank = parseFloat(style.getPropertyValue("--river-bank-width")) || 10;
    const half = water + bank;
    const colors = {
      water: readColor(style, "--river-water", "#2f86c9"),
      deep: readColor(style, "--river-deep", "#2570ad"),
      foam: readColor(style, "--river-foam", "#d8f1ff"),
      sand: readColor(style, "--river-sand", "#f0c36a"),
      line: readColor(style, "--river-outline", "#14405f"),
    };

    const landscape = mq.matches;
    const cfg = landscape && o.landscape ? o.landscape : o.portrait;
    const rotate = landscape && !o.landscape;
    poly = layoutPath(
      samplePath(cfg.d),
      cfg.viewBox,
      rotate,
      W,
      H,
      half + o.margin,
    );

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    if (gl && !gl.isContextLost()) {
      const mesh = buildMesh(poly, (i) => poly.cum[i], half + FEATHER);
      vertCount = mesh.length / 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc.aPos);
      gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(loc.aUV);
      gl.vertexAttribPointer(loc.aUV, 2, gl.FLOAT, false, 16, 8);
      gl.uniform2f(loc.uSize, W, H);
      gl.uniform1f(loc.uLen, poly.len);
      gl.uniform1f(loc.uWater, water);
      gl.uniform1f(loc.uBank, bank);
      gl.uniform3fv(loc.uWaterCol, colors.water.rgb);
      gl.uniform3fv(loc.uDeepCol, colors.deep.rgb);
      gl.uniform3fv(loc.uFoamCol, colors.foam.rgb);
      gl.uniform3fv(loc.uSandCol, colors.sand.rgb);
      gl.uniform3fv(loc.uLineCol, colors.line.rgb);
      draw(performance.now() / 1000);
    } else if (!gl) {
      drawFallback(W, H, dpr, water, bank, colors);
    }

    placeBoat();
    if (o.onLayout) o.onLayout(api);
  }

  function draw(t) {
    if (!gl || gl.isContextLost()) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(loc.uTime, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertCount);
  }

  /** Static 2D version, used only when WebGL is unavailable. */
  function drawFallback(W, H, dpr, water, bank, colors) {
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.lineCap = c.lineJoin = "round";
    const stroke = (w, col) => {
      c.lineWidth = w;
      c.strokeStyle = col;
      c.beginPath();
      poly.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    };
    stroke(2 * (water + bank), colors.sand.css);
    stroke(2 * water + 5, colors.line.css);
    stroke(2 * water, colors.water.css);
  }

  /* ----- animation loop (paused when hidden / reduced motion) ----- */
  function frame(now) {
    draw(now / 1000);
    raf = requestAnimationFrame(frame);
  }
  function updateLoop() {
    const should = !!gl && visible && !document.hidden && !reduceMotion.matches;
    if (should && !raf) raf = requestAnimationFrame(frame);
    if (!should && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  /* ----- boat ----- */
  function at(s) {
    const { pts, cum, len } = poly;
    s = clamp(s, 0, len);
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const a = pts[lo];
    const b = pts[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  /** Position (px, relative to the container) and heading (radians) at progress p (0..1). */
  function pointAt(p) {
    if (!poly) return { x: 0, y: 0, angle: 0 };
    const s = clamp(p, 0, 1) * poly.len;
    const [x, y] = at(s);
    const [x0, y0] = at(s - 20); // look 20px behind and ahead for a smooth heading
    const [x1, y1] = at(s + 20);
    return { x, y, angle: Math.atan2(y1 - y0, x1 - x0) };
  }

  function placeBoat() {
    if (!boat || !poly) return;
    const { x, y, angle } = pointAt(progress);
    const deg = (angle * 180) / Math.PI - o.boatFacing;
    boat.style.transform = `translate(${x - boat.offsetWidth / 2}px, ${y - boat.offsetHeight / 2}px) rotate(${deg}deg)`;
  }

  function timeProgress() {
    const s = Date.parse(o.start);
    const e = Date.parse(o.end);
    if (!(e > s)) return 0;
    return clamp((Date.now() - s) / (e - s), 0, 1);
  }

  function setProgress(p) {
    progress = clamp(p, 0, 1);
    placeBoat();
  }

  /* ----- wiring ----- */
  const api = {
    setProgress,
    pointAt,
    refresh: rebuild,
    get progress() {
      return progress;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      ro.disconnect();
      io.disconnect();
      mq.removeEventListener("change", rebuild);
      reduceMotion.removeEventListener("change", updateLoop);
      document.removeEventListener("visibilitychange", updateLoop);
    },
  };

  initGL();
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    updateLoop();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    initGL();
    rebuild();
    updateLoop();
  });

  const ro = new ResizeObserver(() => {
    if (root.clientWidth !== lastW || root.clientHeight !== lastH) rebuild();
  });
  ro.observe(root);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateLoop();
  });
  io.observe(root);
  mq.addEventListener("change", rebuild);
  reduceMotion.addEventListener("change", updateLoop);
  document.addEventListener("visibilitychange", updateLoop);
  if (boatImg && !boatImg.complete) boatImg.addEventListener("load", placeBoat);

  progress =
    typeof o.progress === "number" ? clamp(o.progress, 0, 1) : timeProgress();
  rebuild();
  updateLoop();

  // the boat moves ~1px every few hours, so a slow tick is plenty
  const timer = setInterval(() => {
    if (typeof o.progress !== "number") setProgress(timeProgress());
  }, 60000);

  return api;
}
