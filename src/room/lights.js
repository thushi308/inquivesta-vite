import { Color, Vector3 } from 'three';

/*
 * Room light sources.
 *
 * Coordinates are NORMALISED room units:
 *   x, z : -1 .. 1  (±1 = the walls)
 *   y    : -1 .. 1  (-1 = floor, +1 = ceiling)
 * `radius` is a fraction of the room side (1 = reaches across the whole room).
 *
 * To build your own light source, either:
 *   1. pass an `animate(out, time, dt, light)` callback to RoomLight, or
 *   2. extend RoomLight and override `modulate(out, time, dt)`.
 * Both receive `out`: { position: Vector3, color: Color, intensity, radius, falloff }.
 * Mutate `out` – the Room reads it every frame.
 */

const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

// smooth 1D value noise, 0..1
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

export class RoomLight {
  constructor({
    position = [0, 0, 0],
    color = '#ffffff',
    intensity = 1,
    radius = 1,
    falloff = 2,
    animate = null,
  } = {}) {
    this.position = new Vector3(...position);
    this.color = new Color(color);
    this.intensity = intensity;
    this.radius = radius;
    this.falloff = falloff;
    this.enabled = true;
    this.animate = animate;
    this.output = {
      position: new Vector3(),
      color: new Color(),
      intensity: 0,
      radius,
      falloff,
    };
  }

  /** Called by the Room every frame. */
  update(time, dt) {
    const o = this.output;
    o.position.copy(this.position);
    o.color.copy(this.color);
    o.intensity = this.enabled ? this.intensity : 0;
    o.radius = this.radius;
    o.falloff = this.falloff;
    this.modulate(o, time, dt);
    if (this.animate) this.animate(o, time, dt, this);
  }

  /** Override in subclasses. */
  // eslint-disable-next-line no-unused-vars
  modulate(out, time, dt) {}
}

/** Fire / candle / torch style light: noisy intensity, colour shift, tiny movement. */
export class FlickerLight extends RoomLight {
  constructor({
    colorHigh = null, // colour when the flame is at its brightest (defaults to `color`)
    flicker = 0.35,   // 0..1 intensity variation
    speed = 6,        // flicker speed
    jitter = 0.02,    // positional wobble (normalised units)
    seed = Math.random() * 100,
    ...rest
  } = {}) {
    super(rest);
    this.colorHigh = new Color(colorHigh ?? rest.color ?? '#ffffff');
    this.flicker = flicker;
    this.speed = speed;
    this.jitter = jitter;
    this.seed = seed;
  }

  modulate(o, time) {
    const t = time * this.speed + this.seed;
    const n = noise1(t) * 0.6 + noise1(t * 2.3 + 17.3) * 0.3 + noise1(t * 5.1 + 41.7) * 0.1;
    const k = Math.max(-1, Math.min(1, (n - 0.5) * 3));
    o.intensity *= Math.max(0, 1 + this.flicker * k);
    o.radius *= 1 + 0.05 * k * this.flicker;
    o.color.lerpColors(this.color, this.colorHigh, n);
    o.position.x += (noise1(t * 0.7 + 3.1) - 0.5) * 2 * this.jitter;
    o.position.y += (noise1(t * 0.9 + 9.7) - 0.5) * 2 * this.jitter;
  }
}

/** Slow breathing light. */
export class PulseLight extends RoomLight {
  constructor({ amount = 0.3, speed = 0.5, ...rest } = {}) {
    super(rest);
    this.amount = amount;
    this.speed = speed;
  }

  modulate(o, time) {
    o.intensity *= 1 + this.amount * Math.sin(time * this.speed * Math.PI * 2);
  }
}
