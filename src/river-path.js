/**
 * The river curve. This is the ONLY file you edit to change the river's shape.
 *
 * NOTE: this `d` is a placeholder I traced from your screenshot. Replace it
 * with your real SVG path, and set viewBox to your SVG's viewBox: [minX, minY, width, height].
 */
export const portrait = {
  d: "M105 60 C108.3 64.2 120.0 75.3 125 85 C130.0 94.7 134.5 107.2 135 118 C135.5 128.8 132.2 141.0 128 150 C123.8 159.0 116.3 164.5 110 172 C103.7 179.5 93.7 186.2 90 195 C86.3 203.8 86.3 215.8 88 225 C89.7 234.2 93.3 243.5 100 250 C106.7 256.5 121.3 259.3 128 264 C134.7 268.7 135.2 272.5 140 278 C144.8 283.5 155.3 290.3 157 297 C158.7 303.7 153.5 311.7 150 318 C146.5 324.3 140.0 327.7 136 335 C132.0 342.3 130.7 354.2 126 362 C121.3 369.8 114.3 375.3 108 382 C101.7 388.7 92.2 394.0 88 402 C83.8 410.0 83.7 420.3 83 430 C82.3 439.7 82.0 451.2 84 460 C86.0 468.8 89.8 477.2 95 483 C100.2 488.8 108.3 489.2 115 495 C121.7 500.8 127.8 510.5 135 518 C142.2 525.5 153.7 532.7 158 540 C162.3 547.3 162.7 554.5 161 562 C159.3 569.5 159.0 577.5 148 585 C137.0 592.5 103.8 603.3 95 607",
  viewBox: [0, 0, 274, 615],
};

// Desktop: null = rotate the portrait curve 90° (top -> left).
// Later, put a separate { d, viewBox } here to draw a different desktop curve.
export const landscape = null;
