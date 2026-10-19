import "./style.css";

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

/* Transition between the two faces. Crossfade is pure CSS, driven by
   data-revealed. To switch to gl-transitions later, add another function with
   the same (card, revealed) signature here and point runTransition at it. */
const transitions = {
  crossfade(card, showArtist) {
    card.dataset.revealed = String(showArtist);
  },
};
const runTransition = transitions.crossfade;

function setRevealed(value) {
  revealed = value;
  const s = specialEvents[index];
  runTransition(cardEl, revealed);
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
  setRevealed(false); // each event starts on its event image
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
