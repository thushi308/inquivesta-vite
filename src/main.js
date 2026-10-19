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

/* ---------- Pronite carousel (add more entries to enable the arrows) ---------- */
const slides = [{ name: "Mohammad Irfan", image: "images/rock-concert.png" }];
const nameEl = document.getElementById("pronite-name");
const imgEl = document.getElementById("pronite-img");
const prev = document.getElementById("pronite-prev");
const next = document.getElementById("pronite-next");
let index = 0;

function renderSlide() {
  const s = slides[index];
  nameEl.textContent = s.name;
  imgEl.src = base + s.image;
  imgEl.alt = `Pronite performance, ${s.name}`;
}
function go(d) {
  index = (index + d + slides.length) % slides.length;
  renderSlide();
}
prev.addEventListener("click", () => go(-1));
next.addEventListener("click", () => go(1));
prev.disabled = next.disabled = slides.length < 2;
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
