import "./kites.css";
import { kiteOptions, kites as defaultKites } from "./kites-data.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STEP = 1 / 60; // fixed physics step for the tails
const TAIL_POINTS = 14;
const BOW_EVERY = 2;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const rand = (a, b) => a + Math.random() * (b - a);
const r1 = (n) => Math.round(n * 10) / 10;

function svgEl(name, attrs, parent) {
  const el = document.createElementNS(SVG_NS, name);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  parent?.appendChild(el);
  return el;
}

/* Kite body: diamond sail, cross spars, four shaded panels. Drawn in a 100 x 125 box. */
function kiteSvg(color) {
  return `
  <svg class="kite__body" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="50,1 99,45 50,124 1,45" fill="${color}"/>
    <polygon points="50,1 99,45 50,45" fill="#fff" fill-opacity=".16"/>
    <polygon points="1,45 50,124 50,45" fill="#000" fill-opacity=".10"/>
    <polygon points="99,45 50,124 50,45" fill="#000" fill-opacity=".20"/>
    <path d="M50 1V124M1 45H99" stroke="#171932" stroke-opacity=".45" stroke-width="1.2" fill="none"/>
    <polygon points="50,1 99,45 50,124 1,45" fill="none" stroke="#171932" stroke-opacity=".6" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

export function createKites(root, items = defaultKites, userOptions = {}) {
  const options = { ...kiteOptions, ...userOptions }; // mutable at runtime: api.options.drift = true
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // tails live in one overlay SVG under the kites
  const tailLayer = svgEl("svg", {
    class: "kites__tails",
    "aria-hidden": "true",
  });
  const list = document.createElement("ul");
  list.className = "kites__list";
  root.prepend(tailLayer, list);

  let W = root.offsetWidth;
  let H = root.offsetHeight;

  /* ---------- build ---------- */
  const state = items.map((item) => {
    const color = item.color || options.color;
    const li = document.createElement("li");
    li.className = "kite";
    li.innerHTML = `${kiteSvg(color)}<div class="kite__text"><span class="kite__value"></span><span class="kite__label"></span></div>`;
    li.querySelector(".kite__value").textContent = item.value;
    li.querySelector(".kite__label").textContent = item.label;
    list.appendChild(li);

    const tailPath = svgEl(
      "path",
      {
        fill: "none",
        stroke: color,
        "stroke-width": 2.5,
        "stroke-linecap": "round",
      },
      tailLayer,
    );
    const bows = [];
    for (let i = BOW_EVERY; i < TAIL_POINTS; i += BOW_EVERY) {
      bows.push({ i, el: svgEl("path", { fill: color }, tailLayer) });
    }

    const ph = () => rand(0, Math.PI * 2);
    return {
      item,
      li,
      tailPath,
      bows,
      w: 0,
      h: 0,
      hx: 0,
      hy: 0,
      seg: 0,
      cx: 0,
      cy: 0,
      ax: 0,
      ay: 0,
      hasPos: false,
      ox: 0,
      oy: 0,
      vx: 0,
      vy: 0, // pointer offset + velocity (spring)
      lean: 0,
      spin: 0,
      spinV: 0,
      acc: 0,
      tail: [],
      // each kite gets its own rhythm so they never move in sync
      f: {
        sx: rand(0.7, 1.0),
        sx2: rand(1.5, 2.1),
        by: rand(1.0, 1.4),
        by2: rand(2.0, 2.8),
        dx: rand(0.12, 0.22),
        dy: rand(0.1, 0.2),
      },
      p: {
        sx: ph(),
        sx2: ph(),
        by: ph(),
        by2: ph(),
        dx: ph(),
        dy: ph(),
        tail: ph(),
      },
    };
  });

  /* ---------- layout (runs on resize) ---------- */
  function layout() {
    W = root.offsetWidth;
    H = root.offsetHeight;
    const compact = W < options.compactBelow;
    const scale = options.responsive ? clamp(W / 1000, 0.5, 1) : 1;

    for (const k of state) {
      const it = k.item;
      k.w = it.size * scale;
      k.h = k.w * 1.25;
      k.hx = (compact && it.compactX != null ? it.compactX : it.x) * W;
      k.hy = (compact && it.compactY != null ? it.compactY : it.y) * H;
      k.seg = k.w * 0.11 * options.tailLength;
      k.li.style.width = `${k.w}px`;
      k.li.style.height = `${k.h}px`;
      k.li.style.setProperty("--s", `${k.w}px`);
      k.tailPath.setAttribute("stroke-width", r1(Math.max(1.5, k.w * 0.014)));

      // reset tail hanging straight down from the kite
      k.cx = k.hx;
      k.cy = k.hy;
      k.ax = k.cx;
      k.ay = k.cy + k.h / 2;
      k.tail = Array.from({ length: TAIL_POINTS }, (_, i) => {
        const y = k.ay + i * k.seg;
        return { x: k.ax, y, px: k.ax, py: y };
      });
      k.hasPos = false;
    }
    if (reduceMotion.matches) renderStill();
  }

  /* ---------- pointer ---------- */
  const pointer = { x: 0, y: 0, active: false };
  function toLocal(e) {
    const r = root.getBoundingClientRect();
    const s = r.width / root.offsetWidth || 1; // root may be scaled by the panel stack effect
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }
  const onMove = (e) => {
    if (!options.interact) return;
    Object.assign(pointer, toLocal(e));
    pointer.active = true;
  };
  const onLeave = () => (pointer.active = false);
  const onDown = (e) => {
    if (!options.interact) return;
    const pt = toLocal(e);
    Object.assign(pointer, pt);
    pointer.active = e.pointerType === "mouse";
    for (const k of state) {
      if (Math.hypot(k.cx - pt.x, k.cy - pt.y) < k.w * 0.65) {
        // tug: kite jumps up and flips a little
        k.vy -= 620;
        k.vx += rand(-320, 320);
        k.spinV += rand(-280, 280);
      }
    }
  };
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerleave", onLeave);
  root.addEventListener("pointerup", onLeave);
  root.addEventListener("pointercancel", onLeave);

  /* ---------- simulation ---------- */
  function updateKite(k, t, dt) {
    const wind = options.windStrength;

    // home position, optionally wandering around the section
    let bx = k.hx;
    let by = k.hy;
    if (options.drift) {
      const a = options.driftAmount;
      bx += Math.sin(t * k.f.dx + k.p.dx) * W * 0.14 * a;
      by += Math.sin(t * k.f.dy + k.p.dy) * H * 0.1 * a;
    }

    // sway (side to side) and bob (up and down), two layered sines each
    const sway =
      Math.sin(t * k.f.sx + k.p.sx) * 0.5 +
      Math.sin(t * k.f.sx2 + k.p.sx2) * 0.2;
    const bob =
      Math.sin(t * k.f.by + k.p.by) * 0.5 +
      Math.sin(t * k.f.by2 + k.p.by2) * 0.2;

    // pointer: push away + spring back
    if (options.interact && pointer.active) {
      const dx = k.cx - pointer.x;
      const dy = k.cy - pointer.y;
      const dist = Math.hypot(dx, dy) || 1;
      const R = k.w * 0.9 + 90;
      if (dist < R) {
        const f = (1 - dist / R) ** 2 * 2600;
        k.vx += (dx / dist) * f * dt;
        k.vy += (dy / dist) * f * dt;
        k.spinV += (dx / dist) * f * dt * 0.08;
      }
    }
    k.vx += (-k.ox * 14 - k.vx * 3.2) * dt;
    k.vy += (-k.oy * 14 - k.vy * 3.2) * dt;
    k.ox += k.vx * dt;
    k.oy += k.vy * dt;
    k.spinV += (-k.spin * 40 - k.spinV * 4) * dt;
    k.spin += k.spinV * dt;

    let x = bx + sway * k.w * 0.22 * wind + k.ox;
    let y = by + bob * k.w * 0.15 * wind + k.oy;
    const mx = Math.min(k.w / 2 + 8, W / 2);
    const my = Math.min(k.h / 2 + 8, H / 2);
    x = clamp(x, mx, W - mx);
    y = clamp(y, my, H - my);

    // lean into the direction of travel, like a kite pulled by the wind
    const velX = k.hasPos ? (x - k.cx) / dt : 0;
    const targetLean = sway * 10 * wind + clamp(velX * 0.03, -14, 14);
    k.lean += (targetLean - k.lean) * (1 - Math.exp(-dt * 5));
    k.cx = x;
    k.cy = y;
    k.hasPos = true;

    const angle = k.lean + k.spin;
    k.li.style.transform = `translate3d(${r1(x - k.w / 2)}px,${r1(y - k.h / 2)}px,0) rotate(${r1(angle)}deg)`;

    // tail anchor = bottom tip of the kite (rotated with it)
    const a = (angle * Math.PI) / 180;
    k.ax = x - (k.h / 2) * Math.sin(a);
    k.ay = y + (k.h / 2) * Math.cos(a);
  }

  function stepTail(k, t) {
    const pts = k.tail;
    pts[0].x = k.ax;
    pts[0].y = k.ay;
    pts[0].px = k.ax;
    pts[0].py = k.ay;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const f = i / (pts.length - 1);
      const vx = (p.x - p.px) * 0.95;
      const vy = (p.y - p.py) * 0.95;
      p.px = p.x;
      p.py = p.y;
      const gust =
        Math.sin(t * 2.4 - i * 0.55 + k.p.tail) *
        900 *
        f ** 1.5 *
        options.windStrength;
      p.x += vx + gust * STEP * STEP;
      p.y += vy + 520 * STEP * STEP;
      // keep a fixed distance from the previous point
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.hypot(dx, dy) || 1;
      p.x = q.x + (dx / d) * k.seg;
      p.y = q.y + (dy / d) * k.seg;
    }
  }

  function drawTail(k) {
    const pts = k.tail;
    let d = `M${r1(pts[0].x)} ${r1(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += `Q${r1(pts[i].x)} ${r1(pts[i].y)} ${r1(mx)} ${r1(my)}`;
    }
    const last = pts[pts.length - 1];
    d += `L${r1(last.x)} ${r1(last.y)}`;
    k.tailPath.setAttribute("d", d);

    const s = Math.max(5, k.w * 0.05); // bow size
    const wing = `M0 0L${-s} ${-s * 0.6}L${-s} ${s * 0.6}ZM0 0L${s} ${-s * 0.6}L${s} ${s * 0.6}Z`;
    for (const b of k.bows) {
      const p = pts[b.i];
      const n = pts[Math.min(b.i + 1, pts.length - 1)];
      const pr = pts[b.i - 1];
      const ang = (Math.atan2(-(n.x - pr.x), n.y - pr.y) * 180) / Math.PI;
      b.el.setAttribute("d", wing);
      b.el.setAttribute(
        "transform",
        `translate(${r1(p.x)} ${r1(p.y)}) rotate(${r1(ang)})`,
      );
    }
  }

  /* ---------- loop ---------- */
  let raf = 0;
  let last = 0;
  let t = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05) || STEP;
    last = now;
    t += dt;
    for (const k of state) {
      updateKite(k, t, dt);
      k.acc += dt;
      let steps = 0;
      while (k.acc >= STEP && steps < 4) {
        stepTail(k, t);
        k.acc -= STEP;
        steps++;
      }
      k.acc = Math.min(k.acc, STEP);
      drawTail(k);
    }
  }
  function start() {
    if (raf || reduceMotion.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // reduced motion: kites sit still with their tails hanging
  function renderStill() {
    for (const k of state) {
      updateKite(k, 0, STEP);
      for (let i = 0; i < 120; i++) stepTail(k, 0);
      drawTail(k);
    }
  }

  const ro = new ResizeObserver(layout);
  ro.observe(root);
  const io = new IntersectionObserver(([e]) =>
    e.isIntersecting ? start() : stop(),
  ); // only animate while visible
  io.observe(root);
  layout();

  return {
    options,
    relayout: layout,
    destroy() {
      stop();
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("pointerup", onLeave);
      root.removeEventListener("pointercancel", onLeave);
      tailLayer.remove();
      list.remove();
    },
  };
}
