// Easing functions: map t (0..1) to 0..1. Pass any of these (or your own) as the `ease` option.
export const linear = (t) => t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
