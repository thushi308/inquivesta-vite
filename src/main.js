import "./style.css";
import { createGLTransitions } from "./gl-transition.js";
import { transitionDefs } from "./transitions/index.js";
import { createTransitionStage } from "./gl-stage.js";
import { rasterizeSpecial } from "./special-raster.js";

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
   Arrows:     the WHOLE section (background, card, text, arrows) transitions to the
               next event on its own canvas (sceneStage).
   Card click: event image <-> artist photo on a separate canvas inside the card
               (cardStage).
   Image paths are relative to /public. */

import { specialEvents } from "./special-events-data.js";

/* ---------- Transition settings (change these) ----------
   name:     a key from src/transitions/index.js
   duration: milliseconds
   reverse:  true = play that transition backwards
   reveal = card click (event image <-> artist photo)
   next / prev = the arrows (whole section -> next/previous event) */
const TRANSITIONS = {
  reveal: { name: "customVideo", duration: 1500, reverse: false },
  next: { name: "cube", duration: 1400, reverse: false }, // placeholder: swap in the new transition
  prev: { name: "cube", duration: 1400, reverse: true },
};

const sectionEl = document.getElementById("special-events");
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
let eventBusy = false; // ignore clicks while an event-to-event transition plays

/* Preload every image so transitions can start instantly */
const imageCache = new Map();
function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      }),
    );
  }
  return imageCache.get(src);
}
specialEvents.forEach((s) => {
  loadImage(base + s.image).catch(() => {});
  loadImage(base + s.artist.image).catch(() => {});
});

/* ---------- Two separate GL canvases (CSS crossfade is the fallback) ---------- */
// each stage only compiles the transitions it actually uses
const pick = (defs, names) =>
  Object.fromEntries(names.filter((n) => defs[n]).map((n) => [n, defs[n]]));

// canvas inside the card: event image <-> artist photo
const cardStage = createTransitionStage(
  cardEl,
  pick(transitionDefs, [TRANSITIONS.reveal.name]),
  { className: "special__gl", before: captionEl },
);
// canvas over the whole section: event -> event
const sceneStage = createTransitionStage(
  sectionEl,
  pick(transitionDefs, [TRANSITIONS.next.name, TRANSITIONS.prev.name]),
  { className: "special__scene-gl", zIndex: 5 },
);

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const ready = (img) => img.complete && img.naturalWidth > 0;
const canUseGL = (stage, cfg) =>
  Boolean(stage?.has(cfg.name)) && !reduceMotion.matches;

/* ---------- Rendering ---------- */
function applyImages() {
  const s = specialEvents[index];
  eventImg.src = base + s.image;
  eventImg.alt = s.title;
  artistImg.src = base + s.artist.image;
  artistImg.alt = `${s.artist.name}, artist at ${s.title}`;
  captionEl.textContent = s.artist.name; // name overlaid on the photo
}
function applyText() {
  const s = specialEvents[index];
  titleEl.textContent = s.title;
  descEl.textContent = s.description;
  nameEl.textContent = revealed ? s.artist.name : ""; // name under the description
  updateCardLabel();
}
function updateCardLabel() {
  const s = specialEvents[index];
  cardEl.setAttribute("aria-pressed", String(revealed));
  cardEl.setAttribute(
    "aria-label",
    revealed
      ? `Showing artist ${s.artist.name}. Show ${s.title} image`
      : `Show artist for ${s.title}`,
  );
}
function renderSlide() {
  cardStage?.cancel();
  sceneStage?.cancel();
  revealed = false;
  cardEl.dataset.revealed = "false";
  applyImages();
  applyText();
}

/* ---------- Card click: event image <-> artist photo (cardStage) ---------- */
function setRevealed(value) {
  if (eventBusy) return;
  const cfg = TRANSITIONS.reveal;
  revealed = value;
  const [fromImg, toImg] = revealed
    ? [eventImg, artistImg]
    : [artistImg, eventImg];
  if (canUseGL(cardStage, cfg) && ready(fromImg) && ready(toImg)) {
    cardStage.play(cfg.name, fromImg, toImg, cfg); // faces swap underneath the canvas
  } else {
    cardStage?.cancel(); // CSS crossfade
  }
  cardEl.dataset.revealed = String(revealed);
  nameEl.textContent = revealed ? specialEvents[index].artist.name : "";
  updateCardLabel();
}

/* ---------- Arrows: whole section -> next event (sceneStage) ---------- */
async function changeEvent(d) {
  if (eventBusy) return;
  const newIndex = (index + d + specialEvents.length) % specialEvents.length;
  const cfg = d > 0 ? TRANSITIONS.next : TRANSITIONS.prev;
  if (!canUseGL(sceneStage, cfg)) {
    index = newIndex;
    renderSlide();
    return;
  }

  eventBusy = true;
  try {
    const cur = specialEvents[index];
    const nxt = specialEvents[newIndex];
    const [cEvent, cArtist, nEvent, nArtist] = await Promise.all([
      loadImage(base + cur.image),
      loadImage(base + cur.artist.image),
      loadImage(base + nxt.image),
      loadImage(base + nxt.artist.image),
      document.fonts.ready, // canvas text needs the web fonts
    ]);

    cardStage?.cancel(); // stop a card transition still in progress
    // 1. snapshot what is on screen now
    const from = rasterizeSpecial(sectionEl, {
      eventImg: cEvent,
      artistImg: cArtist,
      revealed,
    });
    // 2. switch the page to the next event (hidden under the canvas), snapshot that
    index = newIndex;
    revealed = false;
    cardEl.dataset.revealed = "false";
    applyImages();
    applyText();
    const to = rasterizeSpecial(sectionEl, {
      eventImg: nEvent,
      artistImg: nArtist,
      revealed: false,
    });
    // 3. play: all in the same frame, so nothing flashes
    sceneStage.play(cfg.name, from, to, cfg).done.then(() => {
      eventBusy = false;
    });
  } catch (err) {
    console.error(
      "[special-events] event transition failed, swapping instantly",
      err,
    );
    index = newIndex;
    renderSlide();
    eventBusy = false;
  }
}

prev.addEventListener("click", () => changeEvent(-1));
next.addEventListener("click", () => changeEvent(1));
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

/* ----------- Room ---------------------------------------------------- */
// import { Room, FlickerLight, RoomLight } from "./room/index.js";
//
// let room_light = new RoomLight({
//   position: [0, 0, 0],
//   color: "#ffffff",
//   intensity: 3,
//   radius: 1,
// });
// let fire = new FlickerLight({
//   position: [0, -0.6, 0], // x, y, z in -1..1 room units
//   color: "#ff5a14",
//   colorHigh: "#ffc36b",
//   intensity: 1.9,
//   radius: 1.3,
//   flicker: 0.2,
//   speed: 2,
// });

// const room = new Room(document.querySelector("#room"), {
//   lights: [fire, room_light],
//   ambient: 0.3,
// });
//
// room.setCamera(
//   { x: 0.2, y: 0, z: 0.3, pitch: -8, yaw: 15, roll: 4, zoom: 1.2 },
//   { duration: 1.2 }, // 0 = instant
// );
// room_light.moveTo([0.5, -0.4, 0.2], { duration: 1.5 });
// fire.moveTo([0.5, -0.4, 0.2], { duration: 1.5 }); // animated, returns a Promise
// fire.moveTo([0, 0, 0], { duration: 0 }); // instant
// fire.position.set(0.1, 0.2, 0); // also works directly

import {
  PolyRoom,
  DragControls,
  FlickerLight,
  RoomLight,
} from "./polyroom/index.js";

const room = new PolyRoom(document.querySelector("#room"), {
  // prevButton: ".my-prev", // selector, element, or list of elements
  // nextButton: document.querySelector(".my-next"),
  floor: { color: "#ffffff", texture: "/images/floor.png", tile: 512 },
  ceiling: { color: "#ffffff", texture: "/images/floor.png", tile: 512 }, // or false for pure black
  // lights: [
  //   new RoomLight({
  //     position: [0, -0.6, 0],
  //     color: "#ff5a14",
  //     intensity: 16,
  //     radius: 1.3,
  //   }),
  // ],
  ambient: 1,
});

room.setCamera(
  { x: 0, y: 0, z: 0.4 },
  { duration: 1.2 }, // 0 = instant
);

// new DragControls(room, {
//   axis: "horizontal", // 'horizontal' | 'vertical' | 'both'
//   // yawLimit: [-40, 40],
//   release: "free", // 'free' | 'spring' | 'snap'
// });

new DragControls(room, {
  target: "room", // spin the room instead of moving the camera
  axis: "horizontal",
  yawLimit: null, // for 'room', limits are the room's rotation in degrees
  release: "snap", // 'free' | 'spring' | 'snap'
});

import { createKites } from "./kites.js";
export const kites = createKites(document.getElementById("stats"));
