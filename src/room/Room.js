import * as THREE from "three";
import {
  CSS3DRenderer,
  CSS3DObject,
} from "three/addons/renderers/CSS3DRenderer.js";

/*
 * Room
 * ----
 * A black, square room. The camera sits in the centre and turns 90° per step.
 *
 * Rendering = two layers sharing ONE camera:
 *   1. CSS3DRenderer  -> your real HTML walls (fully interactive when at rest)
 *   2. WebGL canvas   -> a light-map of the 4 walls, blended over the HTML with
 *                        mix-blend-mode: multiply. Unlit = black, lit = tinted.
 *
 * Content cycling: there are always 4 physical walls. Going forward, step s shows
 * container (s mod N) on wall (s mod 4). With N = 3 the 4th wall shows container 1
 * again, with N = 5 the 5th container appears on wall 1 after one full turn, etc.
 */

const HALF_PI = Math.PI / 2;
const mod = (n, m) => ((n % m) + m) % m;
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const _rgb = { r: 0, g: 0, b: 0 };

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragSource = (max) => /* glsl */ `
  #define MAX_LIGHTS ${max}
  uniform vec3 uLightPos[MAX_LIGHTS];
  uniform vec3 uLightColor[MAX_LIGHTS];   // rgb * intensity
  uniform vec2 uLightParams[MAX_LIGHTS];  // x: radius (px), y: falloff exponent
  uniform vec3 uAmbient;
  uniform float uWrap;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 total = uAmbient;
    for (int i = 0; i < MAX_LIGHTS; i++) {
      float r = uLightParams[i].x;
      if (r <= 0.0) continue;
      vec3 toL = uLightPos[i] - vWorldPos;
      float d = max(length(toL), 0.001);
      float att = pow(clamp(1.0 - d / r, 0.0, 1.0), uLightParams[i].y);
      float ndl = dot(N, toL / d);
      float diff = clamp((ndl + uWrap) / (1.0 + uWrap), 0.0, 1.0);
      total += uLightColor[i] * att * diff;
    }
    total = min(total, vec3(1.0));
    total += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither, avoids banding in dark gradients
    gl_FragColor = vec4(total, 1.0);
  }
`;

export class Room extends EventTarget {
  /**
   * @param {HTMLElement} root  the section that becomes the room
   * @param {object} opts
   * @param {string|Element[]} [opts.walls='[data-room-wall]']  selector (inside root) or elements
   * @param {RoomLight[]} [opts.lights]
   * @param {number} [opts.maxLights=4]
   * @param {number} [opts.ambient=0]    0 = pure black where no light reaches
   * @param {number} [opts.wrap=0.35]    how softly light wraps at grazing angles
   * @param {number} [opts.duration=1.1] seconds per turn
   * @param {number} [opts.startIndex=0]
   * @param {boolean} [opts.controls=true]  build prev/next buttons
   * @param {Element} [opts.prevButton]   use your own buttons instead
   * @param {Element} [opts.nextButton]
   * @param {boolean} [opts.swipe=true]   touch swipe
   */
  constructor(root, opts = {}) {
    super();
    const o = {
      walls: "[data-room-wall]",
      lights: [],
      maxLights: 4,
      ambient: 0,
      wrap: 0.35,
      duration: 1.1,
      startIndex: 0,
      controls: true,
      prevButton: null,
      nextButton: null,
      swipe: true,
      ...opts,
    };
    this.opts = o;
    this.root = root;
    this.walls =
      typeof o.walls === "string"
        ? [...root.querySelectorAll(o.walls)]
        : Array.from(o.walls);
    if (!this.walls.length) throw new Error("Room: no wall containers found");

    this.count = this.walls.length;
    this.step = o.startIndex;
    this.yaw = -this.step * HALF_PI;
    this.maxLights = o.maxLights;
    this.lights = [];
    this.W = 1;
    this.H = 1;
    this.R = 1;
    this._anim = null;
    this._raf = 0;
    this._last = performance.now() / 1000;
    this._slot = new Array(this.count).fill(0);
    this._reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    root.classList.add("room");

    // --- shared camera, two scenes ---
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
    this.cssScene = new THREE.Scene();
    this.glScene = new THREE.Scene();

    // --- HTML layer ---
    this.css = new CSS3DRenderer();
    this.css.domElement.classList.add("room__css");
    root.appendChild(this.css.domElement);

    this.objs = this.walls.map((el) => {
      const obj = new CSS3DObject(el);
      el.style.userSelect = ""; // CSS3DObject disables selection by default
      obj.visible = false;
      this.cssScene.add(obj);
      return obj;
    });

    // --- light layer ---
    this.gl = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.gl.setClearColor(0x000000, 1);
    this.gl.domElement.classList.add("room__gl");
    root.appendChild(this.gl.domElement);

    const M = this.maxLights;
    this.uniforms = {
      uLightPos: {
        value: Array.from({ length: M }, () => new THREE.Vector3()),
      },
      uLightColor: {
        value: Array.from({ length: M }, () => new THREE.Vector3()),
      },
      uLightParams: {
        value: Array.from({ length: M }, () => new THREE.Vector2(0, 2)),
      },
      uAmbient: { value: new THREE.Vector3(o.ambient, o.ambient, o.ambient) },
      uWrap: { value: o.wrap },
    };
    this._geo = new THREE.PlaneGeometry(1, 1);
    this._mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: fragSource(M),
    });
    this.glWalls = [0, 1, 2, 3].map(() => {
      const m = new THREE.Mesh(this._geo, this._mat);
      this.glScene.add(m);
      return m;
    });

    o.lights.forEach((l) => this.addLight(l));

    // --- initial state ---
    this._assign(this.step);
    this._resize();
    this._setInteractive(this.walls[mod(this.step, this.count)]);
    this._buildControls();
    this._bindSwipe();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(root);
    this._io = new IntersectionObserver(([e]) =>
      e.isIntersecting ? this.start() : this.stop(),
    );
    this._io.observe(root);

    this._renderFrame(this._last);
    root.classList.add("is-ready");
  }

  // ------------------------------------------------------------ public API
  get index() {
    return mod(this.step, this.count);
  }
  get isMoving() {
    return !!this._anim;
  }

  next() {
    this._move(1);
  }
  prev() {
    this._move(-1);
  }

  addLight(light) {
    if (this.lights.length >= this.maxLights) {
      console.warn(
        `Room: max ${this.maxLights} lights (raise the maxLights option)`,
      );
      return light;
    }
    this.lights.push(light);
    return light;
  }

  removeLight(light) {
    this.lights = this.lights.filter((l) => l !== light);
  }

  start() {
    if (this._raf) return;
    this._last = performance.now() / 1000;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  destroy() {
    this.stop();
    this._ro.disconnect();
    this._io.disconnect();
    this.root.removeEventListener("pointerdown", this._onDown);
    this.root.removeEventListener("pointerup", this._onUp);
    this.root.removeEventListener("pointercancel", this._onCancel);
    this._unbind?.forEach((fn) => fn());
    this.walls.forEach((el) => {
      el.inert = false;
      [
        "position",
        "width",
        "height",
        "transform",
        "display",
        "pointerEvents",
        "userSelect",
      ].forEach((p) => (el.style[p] = ""));
      this.root.appendChild(el);
    });
    this.css.domElement.remove();
    this.gl.domElement.remove();
    this.ui?.remove();
    this._geo.dispose();
    this._mat.dispose();
    this.gl.dispose();
    this.root.classList.remove("room", "is-ready", "is-moving");
  }

  // ------------------------------------------------------------ internals
  _assign(step) {
    const c = mod(step, this.count);
    this._slot[c] = mod(step, 4);
    this._place(c);
    this.objs[c].visible = true;
  }

  _place(c) {
    const a = this._slot[c] * HALF_PI;
    const half = this.R / 2;
    const obj = this.objs[c];
    obj.position.set(Math.sin(a) * half, 0, -Math.cos(a) * half);
    obj.rotation.y = -a;
  }

  _setInteractive(activeEl) {
    this.walls.forEach((el) => {
      el.inert = el !== activeEl;
    });
  }

  _move(dir) {
    if (this._anim || this.count < 2) return;
    const from = this.step;
    const to = from + dir;
    this._assign(to);
    this._setInteractive(null);
    this.root.classList.add("is-moving");
    this._anim = {
      from: this.yaw,
      to: -to * HALF_PI,
      target: to,
      t0: null,
      dur: this._reduced ? 0.01 : this.opts.duration,
    };
    this.dispatchEvent(
      new CustomEvent("movestart", {
        detail: { from, to, index: mod(to, this.count) },
      }),
    );
  }

  _finishMove() {
    const a = this._anim;
    this._anim = null;
    this.step = a.target;
    this.yaw = -a.target * HALF_PI;
    const active = mod(this.step, this.count);
    this.objs.forEach((obj, i) => (obj.visible = i === active));
    this._setInteractive(this.walls[active]);
    this.root.classList.remove("is-moving");
    this.dispatchEvent(
      new CustomEvent("moveend", {
        detail: { step: this.step, index: active },
      }),
    );
    this.dispatchEvent(
      new CustomEvent("change", { detail: { step: this.step, index: active } }),
    );
  }

  _resize() {
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    if (!W || !H) return;
    // Square room footprint with side R. Camera at the centre (distance R/2 to each wall);
    // vertical FOV is chosen so a wall of height H fills the view exactly: the wall's
    // content (W x H) fills the viewport at rest.
    const R = Math.max(W, H);
    this.W = W;
    this.H = H;
    this.R = R;

    this.camera.aspect = W / H;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(H / R));
    this.camera.near = 1;
    this.camera.far = R * 2;
    this.camera.updateProjectionMatrix();

    this.css.setSize(W, H);
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.setSize(W, H, false);

    this.root.style.setProperty("--room-w", `${W}px`);
    this.root.style.setProperty("--room-h", `${H}px`);
    this.walls.forEach((el) => {
      el.style.width = `${W}px`;
      el.style.height = `${H}px`;
    });

    this.glWalls.forEach((m, w) => {
      const a = w * HALF_PI;
      m.scale.set(R, H, 1);
      m.position.set((Math.sin(a) * R) / 2, 0, (-Math.cos(a) * R) / 2);
      m.rotation.y = -a;
    });
    this.objs.forEach((_, c) => this._place(c));
  }

  _updateLights(time, dt) {
    const { R, H } = this;
    const u = this.uniforms;
    for (let i = 0; i < this.maxLights; i++) {
      const light = this.lights[i];
      if (!light) {
        u.uLightParams.value[i].set(0, 2);
        continue;
      }
      light.update(time, dt);
      const out = light.output;
      u.uLightPos.value[i].set(
        (out.position.x * R) / 2,
        (out.position.y * H) / 2,
        (out.position.z * R) / 2,
      );
      out.color.getRGB(_rgb, THREE.SRGBColorSpace);
      u.uLightColor.value[i].set(
        _rgb.r * out.intensity,
        _rgb.g * out.intensity,
        _rgb.b * out.intensity,
      );
      u.uLightParams.value[i].set(out.radius * R, out.falloff);
    }
  }

  _renderFrame(t) {
    const dt = Math.min(t - this._last, 0.1);
    this._last = t;
    const a = this._anim;
    if (a) {
      if (a.t0 === null) a.t0 = t;
      const k = Math.min((t - a.t0) / a.dur, 1);
      this.yaw = a.from + (a.to - a.from) * easeInOutCubic(k);
      if (k >= 1) this._finishMove();
    }
    this._updateLights(t, dt);
    this.camera.rotation.y = this.yaw;
    this.css.render(this.cssScene, this.camera);
    this.gl.render(this.glScene, this.camera);
  }

  _tick = (now) => {
    this._raf = requestAnimationFrame(this._tick);
    this._renderFrame(now / 1000);
  };

  // ------------------------------------------------------------ controls
  _buildControls() {
    const { prevButton, nextButton, controls } = this.opts;
    this._unbind = [];
    const bind = (el, fn) => {
      el.addEventListener("click", fn);
      this._unbind.push(() => el.removeEventListener("click", fn));
    };
    let prev = prevButton;
    let next = nextButton;

    if (!prev && !next && controls) {
      const chevron = (d) =>
        `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
      const mk = (cls, label, d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `room__nav ${cls}`;
        b.setAttribute("aria-label", label);
        b.innerHTML = chevron(d);
        return b;
      };
      prev = mk("room__nav--prev", "Previous wall", "M15 5l-7 7 7 7");
      next = mk("room__nav--next", "Next wall", "M9 5l7 7-7 7");
      this.ui = document.createElement("div");
      this.ui.className = "room__ui";
      this.ui.append(prev, next);
      this.root.appendChild(this.ui);
    }
    if (prev) bind(prev, () => this.prev());
    if (next) bind(next, () => this.next());
    if (this.count < 2) [prev, next].forEach((b) => b && (b.disabled = true));
  }

  _bindSwipe() {
    if (!this.opts.swipe) return;
    this._swipe = null;
    this._onDown = (e) => {
      if (e.pointerType !== "touch" || e.target.closest("[data-room-no-swipe]"))
        return;
      this._swipe = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    this._onUp = (e) => {
      const s = this._swipe;
      this._swipe = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (
        Math.abs(dx) > 50 &&
        Math.abs(dx) > Math.abs(dy) * 1.5 &&
        performance.now() - s.t < 800
      ) {
        if (dx < 0) this.next();
        else this.prev();
      }
    };
    this._onCancel = () => (this._swipe = null);
    this.root.addEventListener("pointerdown", this._onDown);
    this.root.addEventListener("pointerup", this._onUp);
    this.root.addEventListener("pointercancel", this._onCancel);
  }
}
