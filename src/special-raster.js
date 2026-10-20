/* Draws the special-events section (blurred background, card, text, arrows) into a
   2D canvas so it can be used as a WebGL texture.

   rasterizeSpecial(section, { eventImg, artistImg, revealed }) -> <canvas>

   - The DOM must already show the state you want drawn. Positions, line breaks,
     fonts and colours are READ from the live DOM, so layout changes (breakpoints,
     new text, new font sizes) are followed automatically.
   - eventImg / artistImg are passed in (not read from the DOM) so you can draw a
     state whose images have not been applied to the page yet.
   - The canvas has the same pixel size the transition runner uses (pixelSize()).

   KEEP IN SYNC: if you add a NEW visual element to the section (a badge, a divider...),
   add a draw step for it in rasterizeSpecial(). */

import { pixelSize } from "./gl-transition.js";

/* ---------- small helpers ---------- */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) return ctx.roundRect(x, y, w, h, r);
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih);
  ctx.drawImage(
    img,
    x + (w - iw * s) / 2,
    y + (h - ih * s) / 2,
    iw * s,
    ih * s,
  );
}

function angle(v) {
  const n = parseFloat(v);
  if (v.endsWith("rad")) return n;
  if (v.endsWith("turn")) return n * Math.PI * 2;
  return (n * Math.PI) / 180; // deg
}

/* Moves ctx into the element's own space: its box top-left becomes (0,0).
   Follows transform-origin and the translate / rotate / scale / transform properties. */
function applyElementTransform(ctx, el, x, y) {
  const cs = getComputedStyle(el);
  const [ox, oy] = cs.transformOrigin.split(" ").map(parseFloat);
  ctx.translate(x + ox, y + oy);
  if (cs.translate && cs.translate !== "none") {
    const [tx = 0, ty = 0] = cs.translate.split(" ").map(parseFloat);
    ctx.translate(tx, ty);
  }
  if (cs.rotate && cs.rotate !== "none")
    ctx.rotate(angle(cs.rotate.split(" ").pop()));
  if (cs.scale && cs.scale !== "none") {
    const [sx, sy = sx] = cs.scale.split(" ").map(parseFloat);
    ctx.scale(sx, sy);
  }
  if (cs.transform && cs.transform !== "none") {
    const m = new DOMMatrix(cs.transform);
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  }
  ctx.translate(-ox, -oy);
}

function blurCanvas(src, px) {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const x = out.getContext("2d");
  if ("filter" in x) {
    x.filter = `blur(${px}px)`;
    x.drawImage(src, 0, 0);
    return out;
  }
  // Safari fallback (no ctx.filter): repeated halving + upscaling approximates a blur
  let cur = src;
  const steps = Math.max(1, Math.round(Math.log2(Math.max(2, px / 2))));
  for (let i = 0; i < steps; i++) {
    const n = document.createElement("canvas");
    n.width = Math.max(1, cur.width >> 1);
    n.height = Math.max(1, cur.height >> 1);
    const nx = n.getContext("2d");
    nx.imageSmoothingQuality = "high";
    nx.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  x.imageSmoothingQuality = "high";
  x.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

/* Text: reads each wrapped line (and its position) from the DOM, then draws it */
function drawText(ctx, el, local) {
  const node = [...el.childNodes].find(
    (n) => n.nodeType === 3 && n.textContent.trim(),
  );
  if (!node) return;
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.fillStyle = cs.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const text = node.textContent;
  const range = document.createRange();
  const lines = [];
  let cur = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    if (!r || /\s/.test(ch)) {
      if (cur) cur.text += ch;
      continue;
    }
    if (!cur || Math.abs(r.top - cur.top) > r.height * 0.5) {
      if (cur) lines.push(cur);
      cur = { text: "", top: r.top, left: r.left, h: r.height };
    }
    cur.text += ch;
  }
  if (cur) lines.push(cur);

  for (const l of lines) {
    const p = local({ left: l.left, top: l.top, width: 0, height: l.h });
    const m = ctx.measureText(l.text);
    const ascent = m.fontBoundingBoxAscent ?? p.h * 0.8;
    ctx.fillText(l.text.trimEnd(), p.x, p.y + ascent);
  }
}

/* ---------- blurred background (cached: it never changes between events) ---------- */
const bgCache = new WeakMap();
const BG_K = 0.25; // the backdrop is blurred, so it is drawn at quarter resolution

function backdrop(section, lw, lh) {
  const bg = section.querySelector(".special__bg");
  const shade = section.querySelector(".special__shade");
  if (!bg) return null;
  const bcs = getComputedStyle(bg);
  const scs = shade ? getComputedStyle(shade) : null;
  const blur = parseFloat(
    ((scs?.backdropFilter || scs?.webkitBackdropFilter || "").match(
      /blur\(([\d.]+)px\)/,
    ) || [])[1] || 0,
  );
  const imgs = [...bg.querySelectorAll("img")];
  const key = [
    lw,
    lh,
    blur,
    bcs.translate,
    bcs.rotate,
    bcs.scale,
    bcs.transform,
    bcs.transformOrigin,
    ...imgs.map((i) => i.currentSrc + i.complete),
  ].join("|");
  const hit = bgCache.get(section);
  if (hit?.key === key) return hit;

  const PAD = Math.ceil(blur * 3); // draw beyond the edges so the blur has content to sample
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round((lw + PAD * 2) * BG_K));
  c.height = Math.max(1, Math.round((lh + PAD * 2) * BG_K));
  const x = c.getContext("2d");
  x.scale(BG_K, BG_K);
  x.translate(PAD, PAD);
  x.save();
  applyElementTransform(x, bg, 0, 0);
  for (const img of imgs) {
    if (!img.complete || !img.naturalWidth) continue;
    x.save();
    applyElementTransform(x, img, img.offsetLeft, img.offsetTop);
    const rad = parseFloat(getComputedStyle(img).borderTopLeftRadius) || 0;
    if (rad) {
      roundRectPath(x, 0, 0, img.offsetWidth, img.offsetHeight, rad);
      x.clip();
    }
    drawCover(x, img, 0, 0, img.offsetWidth, img.offsetHeight);
    x.restore();
  }
  x.restore();

  const blurred = blur ? blurCanvas(c, blur * BG_K) : c;
  const entry = {
    key,
    canvas: blurred,
    pad: PAD,
    shadeColor: scs?.backgroundColor ?? "rgb(0,0,0)",
    shadeAlpha: parseFloat(scs?.opacity ?? "0"),
  };
  bgCache.set(section, entry);
  return entry;
}

/* ---------- main ---------- */
export function rasterizeSpecial(section, { eventImg, artistImg, revealed }) {
  const lw = section.offsetWidth;
  const lh = section.offsetHeight;
  const { w: W, h: H } = pixelSize(section);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  ctx.scale(W / lw, H / lh); // from here on, everything is in CSS pixels
  ctx.imageSmoothingQuality = "high";

  // Elements report screen rects; the stacking effect scales the panel, so convert back
  const sr = section.getBoundingClientRect();
  const s = sr.width / lw || 1;
  const local = (r) => ({
    x: (r.left - sr.left) / s,
    y: (r.top - sr.top) / s,
    w: r.width / s,
    h: r.height / s,
  });

  // 1. section background colour, blurred backdrop, shade
  ctx.fillStyle = getComputedStyle(section).backgroundColor;
  ctx.fillRect(0, 0, lw, lh);
  const bd = backdrop(section, lw, lh);
  if (bd) {
    ctx.drawImage(
      bd.canvas,
      bd.pad * BG_K,
      bd.pad * BG_K,
      lw * BG_K,
      lh * BG_K,
      0,
      0,
      lw,
      lh,
    );
    ctx.globalAlpha = bd.shadeAlpha;
    ctx.fillStyle = bd.shadeColor;
    ctx.fillRect(0, 0, lw, lh);
    ctx.globalAlpha = 1;
  }

  // 2. text
  for (const sel of [".special__title", ".special__desc", ".special__name"]) {
    const el = section.querySelector(sel);
    if (el) drawText(ctx, el, local);
  }

  // 3. arrows (keeps the flip and the disabled opacity)
  for (const btn of section.querySelectorAll(".special__arrow")) {
    const img = btn.querySelector("img");
    if (!img || !img.complete) continue;
    const p = local(img.getBoundingClientRect());
    const m = new DOMMatrix(getComputedStyle(img).transform);
    ctx.save();
    ctx.globalAlpha = parseFloat(getComputedStyle(btn).opacity);
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.transform(m.a, m.b, m.c, m.d, 0, 0);
    ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }

  // 4. card: event image or artist photo (+ caption overlay)
  const card = section.querySelector(".special__card");
  if (card) {
    const c = local(card.getBoundingClientRect());
    ctx.save();
    roundRectPath(
      ctx,
      c.x,
      c.y,
      c.w,
      c.h,
      parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0,
    );
    ctx.clip();
    drawCover(ctx, revealed ? artistImg : eventImg, c.x, c.y, c.w, c.h);
    const cap = card.querySelector(".special__caption");
    if (revealed && cap) {
      const r = local(cap.getBoundingClientRect());
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.75)");
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      drawText(ctx, cap, local);
    }
    ctx.restore();
  }

  return out;
}
