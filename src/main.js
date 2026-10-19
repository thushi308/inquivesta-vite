import "./style.css";
import burn0 from "./transitions/burn0.glsl?raw";
import { createGLTransition } from "./gl-transition.js";

const base = import.meta.env.BASE_URL; // "/" in dev, "/static/" in the Django build

/* ---------- Menu (sweep reveal is pure CSS; JS only flips state) ---------- */
const menu = document.getElementById("site-menu");
const menuBtn = document.getElementById("menu-btn");
const menuClose = document.getElementById("menu-close");

function setMenu(open) {
  menu.dataset.open = String(open);
  menu.inert = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  document.body.style.overflow = open ? "hidden" : ""; // lock page scroll while open
}
menuBtn.addEventListener("click", () => setMenu(menu.dataset.open !== "true"));
menuClose.addEventListener("click", () => setMenu(false));
document
  .querySelector(".header__logo")
  .addEventListener("click", () => setMenu(false));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.dataset.open === "true") setMenu(false);
});

/* ---------- Special events carousel ----------
   Arrows move between events. Clicking the card crossfades between the
   event image and that event's artist photo (click again to go back).
   Image paths are relative to /public. */

import { specialEvents } from "./special-events-data.js";

const titleEl = document.getElementById("special-title");
const descEl = document.getElementById("special-desc");
const nameEl = document.getElementById("special-name");
const cardEl = document.getElementById("special-card");
const eventImg = document.getElementById("special-event-img");
const artistImg = document.getElementById("special-artist-img");
const captionEl = document.getElementById("special-caption");
const prev = document.getElementById("special-prev");
const next = document.getElementById("special-next");
let index = 0;
let revealed = false;

/* Transition between the two faces.
   - burn: gl-transitions "burn0" (author: liubailin2020), drawn on a canvas
     over the card, used when WebGL is available and motion is allowed.
   - crossfade: pure CSS fallback, driven by data-revealed.
   To try another gl-transition, drop its .glsl in src/transitions/ and swap the import. */
const glCanvas = document.createElement("canvas");
glCanvas.className = "special__gl";
glCanvas.setAttribute("aria-hidden", "true");
cardEl.insertBefore(glCanvas, captionEl); // above the photos, below the caption

const gl = createGLTransition(glCanvas, burn0, { burnColor: [1.0, 0.5, 0.0] });
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let running = null;

function cancelRunning() {
  running?.cancel();
  running = null;
  delete cardEl.dataset.animating;
}
const ready = (img) => img.complete && img.naturalWidth > 0;

const transitions = {
  crossfade(card, showArtist) {
    cancelRunning();
    card.dataset.revealed = String(showArtist);
  },
  burn(card, showArtist) {
    const [fromImg, toImg] = showArtist
      ? [eventImg, artistImg]
      : [artistImg, eventImg];
    if (!gl || reduceMotion.matches || !ready(fromImg) || !ready(toImg)) {
      return transitions.crossfade(card, showArtist);
    }
    cancelRunning();
    card.dataset.animating = "true"; // shows the canvas
    const job = gl.run(fromImg, toImg, { duration: 1200 });
    running = job;
    // faces swap underneath the canvas; the caption fades in on top of it
    card.dataset.revealed = String(showArtist);
    job.done.then(() => {
      if (running === job) cancelRunning();
    });
  },
};

function setRevealed(value, animate = true) {
  revealed = value;
  const s = specialEvents[index];
  (animate ? transitions.burn : transitions.crossfade)(cardEl, revealed);
  cardEl.setAttribute("aria-pressed", String(revealed));
  cardEl.setAttribute(
    "aria-label",
    revealed
      ? `Showing artist ${s.artist.name}. Show ${s.title} image`
      : `Show artist for ${s.title}`,
  );
  nameEl.textContent = revealed ? s.artist.name : ""; // name under the description
}

function renderSlide() {
  const s = specialEvents[index];
  titleEl.textContent = s.title;
  descEl.textContent = s.description;
  eventImg.src = base + s.image;
  eventImg.alt = `${s.title}`;
  artistImg.src = base + s.artist.image;
  artistImg.alt = `${s.artist.name}, artist at ${s.title}`;
  captionEl.textContent = s.artist.name; // name overlaid on the photo
  setRevealed(false, false); // each event starts on its event image, no burn
}
function go(d) {
  index = (index + d + specialEvents.length) % specialEvents.length;
  renderSlide();
}
prev.addEventListener("click", () => go(-1));
next.addEventListener("click", () => go(1));
cardEl.addEventListener("click", () => setRevealed(!revealed));
prev.disabled = next.disabled = specialEvents.length < 2;
renderSlide();

/* ---------- Card stacking depth effect (window scroll) ---------- */
const panels = [...document.querySelectorAll(".panel")];
let ticking = false;

function updateStack() {
  const h = panels[0].offsetHeight; // stable because panels use lvh
  panels.forEach((panel, i) => {
    if (i === panels.length - 1) return;
    const t = Math.min(Math.max((window.scrollY - i * h) / h, 0), 1);
    panel.style.transform = `scale(${1 - 0.06 * t})`;
    panel.style.filter = `brightness(${1 - 0.5 * t})`;
  });
  ticking = false;
}

window.addEventListener(
  "scroll",
  () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateStack);
    }
  },
  { passive: true },
);
window.addEventListener("resize", updateStack);
updateStack();

/* ----------- timeline ----------------------------------------------*/
import { createRiver } from "./river.js";
import { createEvents } from "./river-events.js";
import { portrait, landscape } from "./river-path.js";
import { START, END, events } from "./timeline-data.js";

const debug = parseFloat(new URLSearchParams(location.search).get("river"));

const markers = createEvents(document.getElementById("river-events"), events, {
  start: START,
  end: END,
});

export const river = createRiver(document.getElementById("river"), {
  portrait,
  landscape,
  start: START,
  end: END,
  boatFacing: 0,
  progress: Number.isNaN(debug) ? undefined : debug,
  onLayout: (api) => markers.layout(api), // re-place markers after every resize
});
