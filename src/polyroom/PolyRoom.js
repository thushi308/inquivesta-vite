import * as THREE from "three";
import {
  CSS3DRenderer,
  CSS3DObject,
} from "three/addons/renderers/CSS3DRenderer.js";
import { easeInOutCubic } from "../room/ease.js";

/*
 * PolyRoom
 * --------
 * A black room shaped like a regular polygon with one wall per content container.
 * Each wall is exactly the room's width x height (viewport size). The camera sits in
 * the centre; the whole room (walls, floor, ceiling) is always drawn, so any camera
 * angle works.
 *
 * Layers (one shared camera):
 *   .polyroom__shell  WebGL  lit floor + ceiling                     (bottom)
 *   .polyroom__css    CSS3D  your live HTML walls                    (middle)
 *   .polyroom__gl     WebGL  wall light-map, mix-blend-mode:multiply (top)
 *
 * Units for lights and camera offsets are "room units":
 *   x, z : -1..1  (±1 = the distance to the walls, the apothem)
 *   y    : -1..1  (-1 floor, +1 ceiling)
 */

const TAU = Math.PI * 2;
const mod = (n, m) => ((n % m) + m) % m;
const rad = THREE.MathUtils.degToRad;
const deg = THREE.MathUtils.radToDeg;
const CAM_KEYS = ["x", "y", "z", "pitch", "yaw", "roll", "zoom"];
const CAM_HOME = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, zoom: 1 };
const ROT_KEYS = ["yaw", "pitch", "roll"];
const _rgb = { r: 0, g: 0, b: 0 };

// ---------------------------------------------------------------- shaders
const lightGLSL = (max) => /* glsl */ `
  #define MAX_LIGHTS ${max}
  uniform vec3 uLightPos[MAX_LIGHTS];
  uniform vec3 uLightColor[MAX_LIGHTS];   // rgb * intensity
  uniform vec2 uLightParams[MAX_LIGHTS];  // x: radius (px), y: falloff exponent
  uniform vec3 uAmbient;
  uniform float uWrap;

  vec3 computeLight(vec3 P, vec3 N) {
    vec3 total = uAmbient;
    for (int i = 0; i < MAX_LIGHTS; i++) {
      float r = uLightParams[i].x;
      if (r <= 0.0) continue;
      vec3 toL = uLightPos[i] - P;
      float d = max(length(toL), 0.001);
      float att = pow(clamp(1.0 - d / r, 0.0, 1.0), uLightParams[i].y);
      float ndl = dot(N, toL / d);
      float diff = clamp((ndl + uWrap) / (1.0 + uWrap), 0.0, 1.0);
      total += uLightColor[i] * att * diff;
    }
    return total;
  }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const WALL_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const wallFrag = (max) => /* glsl */ `
  ${lightGLSL(max)}
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec3 total = min(computeLight(vWorldPos, normalize(vNormal)), vec3(1.0));
    total += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(total, 1.0);
  }
`;

const SHELL_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vUv = position.xz; // room-space, so the texture turns with the room
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const shellFrag = (max) => /* glsl */ `
  ${lightGLSL(max)}
  uniform vec3 uColor;
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform float uTile;
  uniform vec3 uNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vec3 albedo = uColor;
    if (uHasMap > 0.5) albedo *= texture2D(uMap, vUv / uTile).rgb;
    vec3 lit = min(computeLight(vWorldPos, uNormal), vec3(1.0));
    vec3 c = albedo * lit + (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const toElements = (spec) => {
  if (!spec) return [];
  if (typeof spec === "string") return [...document.querySelectorAll(spec)];
  if (spec instanceof Element) return [spec];
  return Array.from(spec);
};

export class PolyRoom extends EventTarget {
  /**
   * @param {HTMLElement} root
   * @param {object} opts
   * @param {string|Element[]} [opts.walls='[data-room-wall]']  one container per wall (min 3)
   * @param {RoomLight[]} [opts.lights]
   * @param {number} [opts.maxLights=4]
   * @param {number} [opts.ambient=0]       light everywhere (0 = pure black unlit)
   * @param {number} [opts.wrap=0.35]       softness of light at grazing angles
   * @param {number} [opts.duration=1.1]    seconds per wall turn
   * @param {number} [opts.maxFov=100]      widest vertical FOV allowed (degrees)
   * @param {number} [opts.startIndex=0]
   * @param {object} [opts.camera]          initial view { x, y, z, pitch, yaw, roll, zoom }
   * @param {object} [opts.rotation]        initial room rotation { yaw, pitch, roll } in degrees
   * @param {string[]} [opts.resetOnNavigate=['yaw','pitch']]  camera keys eased back to home on next/prev
   * @param {Element|Element[]|string} [opts.prevButton]  any element(s) / selector
   * @param {Element|Element[]|string} [opts.nextButton]
   * @param {object|false} [opts.floor]    { color:'#141414', texture:url|THREE.Texture, tile:512 } or false
   * @param {object|false} [opts.ceiling]  same shape as floor
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
      maxFov: 100,
      startIndex: 0,
      camera: {},
      rotation: {},
      resetOnNavigate: ["yaw", "pitch"],
      prevButton: null,
      nextButton: null,
      floor: {},
      ceiling: {},
      ...opts,
    };
    this.opts = o;
    this.root = root;
    this.walls =
      typeof o.walls === "string"
        ? [...root.querySelectorAll(o.walls)]
        : Array.from(o.walls);
    this.count = this.walls.length;
    if (this.count < 3) {
      throw new Error(
        `PolyRoom needs at least 3 walls to form a room (got ${this.count}).`,
      );
    }

    this.theta = TAU / this.count; // angle between neighbouring walls
    this.step = o.startIndex;
    this.rot = { yaw: 0, pitch: 0, roll: 0, ...o.rotation }; // the room's own rotation (degrees)
    this._rotTween = null;
    this.yaw = -this.step * this.theta + rad(this.rot.yaw);
    this.view = { ...CAM_HOME, ...o.camera };
    this.maxLights = o.maxLights;
    this.lights = [];
    this.W = 1;
    this.H = 1;
    this.Wp = 1;
    this.a = 1;
    this.rho = 1;
    this._anim = null;
    this._camTween = null;
    this._locks = 0;
    this._raf = 0;
    this._last = performance.now() / 1000;
    this._reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this._unbind = [];
    this._raycaster = new THREE.Raycaster();

    root.classList.add("polyroom");

    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
    this.camera.rotation.order = "YXZ";
    this.cssScene = new THREE.Scene();
    this.glScene = new THREE.Scene();
    this.shellScene = new THREE.Scene();
    // Everything that belongs to the room lives in a group per layer; rotating the groups
    // spins the room while the camera and the lights (world space) stay where they are.
    this.cssRoom = new THREE.Group();
    this.glRoom = new THREE.Group();
    this.shellRoom = new THREE.Group();
    [this.cssRoom, this.glRoom, this.shellRoom].forEach((g) => {
      g.rotation.order = "YXZ";
    });
    this.cssScene.add(this.cssRoom);
    this.glScene.add(this.glRoom);
    this.shellScene.add(this.shellRoom);

    const M = this.maxLights;
    this.lightUniforms = {
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

    // --- layer 0: lit floor + ceiling ---
    this.shell = null;
    this.surfaces = [];
    if (o.floor || o.ceiling) {
      this.shell = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      this.shell.setClearColor(0x000000, 1);
      this.shell.domElement.classList.add("polyroom__shell");
      root.appendChild(this.shell.domElement);
      this._white = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
      );
      this._white.needsUpdate = true;
      this._shellGeo = new THREE.BufferGeometry();
      if (o.floor) this._addSurface(o.floor, +1, -1); // normal up, sits at the bottom
      if (o.ceiling) this._addSurface(o.ceiling, -1, +1); // normal down, sits at the top
    }

    // --- layer 1: HTML walls ---
    this.css = new CSS3DRenderer();
    this.css.domElement.classList.add("polyroom__css");
    root.appendChild(this.css.domElement);
    this.objs = this.walls.map((el) => {
      const obj = new CSS3DObject(el);
      el.style.userSelect = "";
      this.cssRoom.add(obj);
      return obj;
    });

    // --- layer 2: wall light-map (multiplied over the HTML) ---
    this.gl = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.gl.setClearColor(0xffffff, 1); // white = "no change" where there is no wall
    this.gl.domElement.classList.add("polyroom__gl");
    root.appendChild(this.gl.domElement);
    this._wallGeo = new THREE.PlaneGeometry(1, 1);
    this._wallMat = new THREE.ShaderMaterial({
      uniforms: this.lightUniforms,
      vertexShader: WALL_VERT,
      fragmentShader: wallFrag(M),
    });
    this.glWalls = this.walls.map(() => {
      const m = new THREE.Mesh(this._wallGeo, this._wallMat);
      this.glRoom.add(m);
      return m;
    });

    o.lights.forEach((l) => this.addLight(l));

    this._bindButtons(o.prevButton, () => this.prev());
    this._bindButtons(o.nextButton, () => this.next());

    this._resize();
    this._refreshInteractive();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(root);
    this._io = new IntersectionObserver(([e]) =>
      e.isIntersecting ? this.start() : this.stop(),
    );
    this._io.observe(root);

    this._renderFrame(this._last);
    root.classList.add("is-ready");
  }

  // ================================================================ public API
  get index() {
    return mod(this.step, this.count);
  }
  get isMoving() {
    return !!this._anim || !!this._rotTween;
  }
  /** Direction the camera is looking in ROOM space (radians): wall k is dead ahead at -k*theta. */
  get heading() {
    return this.yaw + rad(this.view.yaw) - rad(this.rot.yaw);
  }

  next() {
    this._move(1);
  }
  prev() {
    this._move(-1);
  }

  /** Turn to wall `index` by the shortest way round. */
  goTo(index) {
    let d = mod(index - this.index, this.count);
    if (d > this.count / 2) d -= this.count;
    this._move(d);
  }

  /**
   * Change the camera view. Any subset of keys; duration 0 = instant. Returns a Promise.
   *   x, y, z : position offset from the room centre (room units)
   *   pitch   : degrees, + looks up        yaw : degrees, + looks left (offset from the current wall)
   *   roll    : degrees                    zoom: 1 = wall fills the screen
   */
  setCamera(values = {}, { duration = 0.8, ease = easeInOutCubic } = {}) {
    this._camTween?.resolve();
    const to = {};
    for (const k of CAM_KEYS)
      if (typeof values[k] === "number") to[k] = values[k];
    if (duration <= 0) {
      Object.assign(this.view, to);
      this._camTween = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._camTween = {
        from: { ...this.view },
        to,
        t0: null,
        duration,
        ease,
        resolve,
      };
    });
  }

  getCamera() {
    return { ...this.view };
  }
  resetCamera(opts) {
    return this.setCamera(CAM_HOME, opts);
  }

  /**
   * Rotate the ROOM itself (walls, floor, ceiling) around its centre. The camera and the
   * lights do not move. Any subset of { yaw, pitch, roll } in degrees; duration 0 = instant.
   *   yaw   : positive slides what is on your right towards the left
   *   pitch : positive lifts the wall in front of you
   * When it finishes, the wall nearest to the camera becomes the current (interactive) wall.
   * Pass { sync: false } to skip that (used while dragging). Returns a Promise.
   */
  setRoomRotation(
    values = {},
    { duration = 0.8, ease = easeInOutCubic, sync = true } = {},
  ) {
    const hadTween = !!this._rotTween;
    this._rotTween?.resolve();
    const to = {};
    for (const k of ROT_KEYS)
      if (typeof values[k] === "number") to[k] = values[k];
    if (duration <= 0) {
      Object.assign(this.rot, to);
      this._rotTween = null;
      if (sync) this._syncStep();
      if (hadTween) this._refreshInteractive();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._rotTween = {
        from: { ...this.rot },
        to,
        t0: null,
        duration,
        ease,
        resolve,
        sync,
      };
      this._refreshInteractive();
    });
  }

  getRoomRotation() {
    return { ...this.rot };
  }
  resetRoomRotation(opts) {
    return this.setRoomRotation({ yaw: 0, pitch: 0, roll: 0 }, opts);
  }

  /**
   * Spin the room (not the camera) so that wall `step` ends up dead ahead, and make it the
   * current wall. Pitch eases back to 0 unless resetPitch is false.
   */
  snapRoomTo(
    step,
    { duration = 0.7, ease = easeInOutCubic, resetPitch = true } = {},
  ) {
    if (this._anim) return Promise.resolve();
    this._camTween?.resolve();
    this._camTween = null;
    const camYaw = this.yaw + rad(this.view.yaw);
    const before = this.index;
    this.step = step;
    this.yaw = camYaw; // camera keeps pointing exactly where it points
    this.view.yaw = 0;
    const to = { yaw: deg(camYaw + step * this.theta) };
    if (resetPitch) to.pitch = 0;
    if (this.index !== before) {
      this.dispatchEvent(
        new CustomEvent("change", { detail: { step, index: this.index } }),
      );
    }
    return this.setRoomRotation(to, { duration, ease, sync: false });
  }

  /** Step index of the wall closest to where the camera is looking. */
  nearestStep() {
    return Math.round(-this.heading / this.theta);
  }

  /**
   * Make `step` the current wall WITHOUT moving the camera (the yaw offset absorbs the
   * difference). Used by drag controls after a release.
   */
  commitStep(step) {
    if (this._anim) return;
    this._camTween?.resolve();
    this._camTween = null;
    const world = this.yaw + rad(this.view.yaw); // where the camera really points
    const before = this.index;
    this.step = step;
    this.yaw = -step * this.theta + rad(this.rot.yaw);
    this.view.yaw = deg(world - this.yaw);
    this._refreshInteractive();
    if (this.index !== before) {
      this.dispatchEvent(
        new CustomEvent("change", { detail: { step, index: this.index } }),
      );
    }
  }

  /** Block / unblock interaction with wall content (used while dragging). Calls nest. */
  lockInteraction(on) {
    this._locks = Math.max(0, this._locks + (on ? 1 : -1));
    this._refreshInteractive();
  }

  // ---- lights
  addLight(light) {
    if (this.lights.length >= this.maxLights) {
      console.warn(
        `PolyRoom: max ${this.maxLights} lights (raise the maxLights option)`,
      );
      return light;
    }
    this.lights.push(light);
    return light;
  }

  removeLight(light) {
    this.lights = this.lights.filter((l) => l !== light);
  }

  /** Light (or null) whose position is within `radius` px of the pointer on screen. */
  pickLight(clientX, clientY, radius = 48) {
    const rect = this.root.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    let best = null;
    let bestD = radius;
    for (const light of this.lights) {
      v.copy(this._lightWorld(light.position)).project(this.camera);
      if (v.z > 1) continue; // behind the camera
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = light;
      }
    }
    return best;
  }

  /**
   * Move a light to the pointer, keeping its distance from the camera
   * (it slides on a plane facing the camera). duration 0 = follows instantly.
   */
  moveLightToPointer(
    light,
    clientX,
    clientY,
    { duration = 0, clamp = true } = {},
  ) {
    const rect = this.root.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.camera.updateMatrixWorld();
    this._raycaster.setFromCamera(ndc, this.camera);
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      dir,
      this._lightWorld(light.position),
    );
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(plane, hit))
      return Promise.resolve();
    let nx = hit.x / this.a;
    let ny = hit.y / (this.H / 2);
    let nz = hit.z / this.a;
    if (clamp) {
      const r = Math.hypot(nx, nz);
      if (r > 0.97) {
        nx *= 0.97 / r;
        nz *= 0.97 / r;
      }
      ny = Math.max(-0.97, Math.min(0.97, ny));
    }
    return light.moveTo([nx, ny, nz], { duration });
  }

  // ---- lifecycle
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
    this._unbind.forEach((fn) => fn());
    this.walls.forEach((el) => {
      el.inert = false;
      el.removeAttribute("data-room-active");
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
    this.shell?.domElement.remove();
    this._wallGeo.dispose();
    this._wallMat.dispose();
    this.gl.dispose();
    if (this.shell) {
      this._shellGeo.dispose();
      this.surfaces.forEach((s) => s.material.dispose());
      this.shell.dispose();
    }
    this.root.classList.remove("polyroom", "is-ready");
  }

  // ================================================================ internals
  _bindButtons(spec, fn) {
    toElements(spec).forEach((el) => {
      el.addEventListener("click", fn);
      this._unbind.push(() => el.removeEventListener("click", fn));
    });
  }

  _addSurface(spec, normalY, side) {
    const s = {
      color: "#141414",
      texture: null,
      tile: 512,
      ...(spec === true ? {} : spec),
    };
    let map = this._white;
    if (s.texture) {
      map =
        typeof s.texture === "string"
          ? new THREE.TextureLoader().load(s.texture)
          : s.texture;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.colorSpace = THREE.NoColorSpace; // keep raw sRGB values, same math as the walls
    }
    new THREE.Color(s.color).getRGB(_rgb, THREE.SRGBColorSpace);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.lightUniforms,
        uColor: { value: new THREE.Vector3(_rgb.r, _rgb.g, _rgb.b) },
        uMap: { value: map },
        uHasMap: { value: s.texture ? 1 : 0 },
        uTile: { value: s.tile },
        uNormal: { value: new THREE.Vector3(0, normalY, 0) },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: shellFrag(this.maxLights),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this._shellGeo, material);
    mesh.frustumCulled = false;
    mesh.userData.side = side;
    this.shellRoom.add(mesh);
    this.surfaces.push(mesh);
    mesh.material = material;
  }

  _wallPose(i) {
    const t = i * this.theta;
    return { x: Math.sin(t) * this.a, z: -Math.cos(t) * this.a, ry: -t };
  }

  _lightWorld(p) {
    return new THREE.Vector3(p.x * this.a, p.y * (this.H / 2), p.z * this.a);
  }

  _refreshInteractive() {
    const ok = !this._anim && !this._rotTween && this._locks === 0;
    this.walls.forEach((el, i) => {
      const active = i === this.index;
      el.inert = !(ok && active);
      el.toggleAttribute("data-room-active", active);
    });
  }

  _move(d) {
    if (this._anim || this._rotTween || this._locks || !d) return;
    const from = this.step;
    const to = from + d;
    this._refreshInteractiveMoving();
    const dur = this._reduced
      ? 0.01
      : this.opts.duration * (1 + 0.35 * (Math.abs(d) - 1));
    this._anim = {
      from: this.yaw,
      to: -to * this.theta + rad(this.rot.yaw),
      target: to,
      t0: null,
      dur,
    };

    const reset = {};
    for (const k of this.opts.resetOnNavigate)
      if (k in CAM_HOME) reset[k] = CAM_HOME[k];
    if (Object.keys(reset).length) this.setCamera(reset, { duration: dur });

    this.dispatchEvent(
      new CustomEvent("movestart", {
        detail: { from, to, index: mod(to, this.count) },
      }),
    );
  }

  _refreshInteractiveMoving() {
    this.walls.forEach((el) => {
      el.inert = true;
    });
  }

  _finishMove() {
    const a = this._anim;
    this._anim = null;
    this.step = a.target;
    this.yaw = a.to;
    this._refreshInteractive();
    this.dispatchEvent(
      new CustomEvent("moveend", {
        detail: { step: this.step, index: this.index },
      }),
    );
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { step: this.step, index: this.index },
      }),
    );
  }

  _resize() {
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    if (!W || !H) return;
    const N = this.count;
    const tanHalf = Math.tan(Math.PI / N);
    // Walls are W x H. If the polygon is so small that the camera would need a crazy-wide
    // FOV (portrait screens, few walls), the wall *planes* grow wider than W; content stays
    // W x H and centred, so at rest it still fills the screen exactly.
    const Wp = Math.max(W, (H * tanHalf) / Math.tan(rad(this.opts.maxFov) / 2));
    const a = Wp / (2 * tanHalf); // apothem: centre -> wall
    const rho = Wp / (2 * Math.sin(Math.PI / N)); // circumradius: centre -> corner
    Object.assign(this, { W, H, Wp, a, rho });

    this.camera.aspect = W / H;
    this.camera.fov = deg(2 * Math.atan(H / (2 * a)));
    this.camera.near = 1;
    this.camera.far = rho * 2 + H;
    this.camera.updateProjectionMatrix();

    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.css.setSize(W, H);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(W, H, false);
    if (this.shell) {
      this.shell.setPixelRatio(pr);
      this.shell.setSize(W, H, false);
      this._buildShellGeometry();
    }

    this.root.style.setProperty("--room-w", `${W}px`);
    this.root.style.setProperty("--room-h", `${H}px`);
    this.walls.forEach((el) => {
      el.style.width = `${W}px`;
      el.style.height = `${H}px`;
    });
    this.objs.forEach((obj, i) => {
      const p = this._wallPose(i);
      obj.position.set(p.x, 0, p.z);
      obj.rotation.y = p.ry;
    });
    this.glWalls.forEach((m, i) => {
      const p = this._wallPose(i);
      m.scale.set(Wp, H, 1);
      m.position.set(p.x, 0, p.z);
      m.rotation.y = p.ry;
    });
    this.surfaces.forEach((m) => {
      m.position.y = m.userData.side * (H / 2);
    });
  }

  // polygon fan for floor/ceiling, corners match the wall corners
  _buildShellGeometry() {
    const N = this.count;
    const pos = new Float32Array((N + 1) * 3);
    for (let i = 0; i < N; i++) {
      const phi = (i - 0.5) * this.theta;
      pos[(i + 1) * 3] = Math.sin(phi) * this.rho;
      pos[(i + 1) * 3 + 2] = -Math.cos(phi) * this.rho;
    }
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(0, i + 1, ((i + 1) % N) + 1);
    this._shellGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this._shellGeo.setIndex(idx);
    this._shellGeo.attributes.position.needsUpdate = true;
  }

  _syncStep() {
    if (!this._anim) this.commitStep(this.nearestStep());
  }

  _stepRotation(t) {
    const c = this._rotTween;
    if (!c) return;
    if (c.t0 === null) c.t0 = t;
    const k = Math.min((t - c.t0) / c.duration, 1);
    const e = c.ease(k);
    for (const key in c.to)
      this.rot[key] = c.from[key] + (c.to[key] - c.from[key]) * e;
    if (k >= 1) {
      this._rotTween = null;
      c.resolve();
      this._refreshInteractive();
      if (c.sync) this._syncStep();
    }
  }

  _stepCamera(t) {
    const c = this._camTween;
    if (!c) return;
    if (c.t0 === null) c.t0 = t;
    const k = Math.min((t - c.t0) / c.duration, 1);
    const e = c.ease(k);
    for (const key in c.to)
      this.view[key] = c.from[key] + (c.to[key] - c.from[key]) * e;
    if (k >= 1) {
      this._camTween = null;
      c.resolve();
    }
  }

  _applyView() {
    const v = this.view;
    const cam = this.camera;
    cam.position.set(v.x * this.a, (v.y * this.H) / 2, v.z * this.a);
    cam.rotation.set(rad(v.pitch), this.yaw + rad(v.yaw), rad(v.roll));
    const r = this.rot;
    for (const g of [this.cssRoom, this.glRoom, this.shellRoom])
      g.rotation.set(rad(r.pitch), rad(r.yaw), rad(r.roll));
    const zoom = Math.max(0.01, v.zoom);
    if (cam.zoom !== zoom) {
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
    }
  }

  _updateLights(time, dt) {
    const { a, H } = this;
    const u = this.lightUniforms;
    for (let i = 0; i < this.maxLights; i++) {
      const light = this.lights[i];
      if (!light) {
        u.uLightParams.value[i].set(0, 2);
        continue;
      }
      light.update(time, dt);
      const out = light.output;
      u.uLightPos.value[i].set(
        out.position.x * a,
        out.position.y * (H / 2),
        out.position.z * a,
      );
      out.color.getRGB(_rgb, THREE.SRGBColorSpace);
      u.uLightColor.value[i].set(
        _rgb.r * out.intensity,
        _rgb.g * out.intensity,
        _rgb.b * out.intensity,
      );
      u.uLightParams.value[i].set(out.radius * a * 2, out.falloff);
    }
  }

  _renderFrame(t) {
    const dt = Math.min(t - this._last, 0.1);
    this._last = t;
    const an = this._anim;
    if (an) {
      if (an.t0 === null) an.t0 = t;
      const k = Math.min((t - an.t0) / an.dur, 1);
      this.yaw = an.from + (an.to - an.from) * easeInOutCubic(k);
      if (k >= 1) this._finishMove();
    }
    this._stepCamera(t);
    this._stepRotation(t);
    this._updateLights(t, dt);
    this._applyView();
    this.shell?.render(this.shellScene, this.camera);
    this.css.render(this.cssScene, this.camera);
    this.gl.render(this.glScene, this.camera);
  }

  _tick = (now) => {
    this._raf = requestAnimationFrame(this._tick);
    this._renderFrame(now / 1000);
  };
}
