/* ---------- Kite settings (change these) ---------- */
export const kiteOptions = {
  drift: true, // true = kites also wander slowly across the whole section
  driftAmount: 1, // how far they wander (1 = default, 2 = twice as far)
  interact: true, // true = kites move away from the mouse/finger, click/tap gives a tug
  windStrength: 1, // overall sway/bob/tail-flutter intensity (0 = still, 2 = windy)
  tailLength: 1, // multiplier for all tail lengths
  color: "#5ec8f2", // default kite colour (sky blue); a kite can override with its own `color`
  responsive: true, // shrink all kites on narrow screens (sizes below are for a 1000px+ wide section)
  compactBelow: 640, // below this section width, use compactX / compactY positions
};

/* ---------- One entry per kite ----------
   value, label : text printed on the kite
   size         : kite width in px (height is 1.25 x width)
   x, y         : home position as a fraction of the section (0..1), centre of the kite
   compactX/Y   : home position on narrow screens (optional, falls back to x / y)
   color        : optional, overrides kiteOptions.color */
export const kites = [
  {
    value: "5+",
    label: "Colleges",
    size: 170,
    x: 0.18,
    y: 0.36,
    compactX: 0.28,
    compactY: 0.22,
  },
  {
    value: "20+",
    label: "Events",
    size: 210,
    x: 0.4,
    y: 0.62,
    compactX: 0.72,
    compactY: 0.36,
  },
  {
    value: "3+",
    label: "Artists",
    size: 160,
    x: 0.62,
    y: 0.32,
    compactX: 0.28,
    compactY: 0.62,
  },
  {
    value: "1 Lakh+",
    label: "Prize Pool",
    size: 240,
    x: 0.82,
    y: 0.6,
    compactX: 0.72,
    compactY: 0.8,
  },
];
