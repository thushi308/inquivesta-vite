/* Reusable "transition stage": one canvas + the gl-transitions runner + show/hide handling.

   USE IT TWO WAYS
   1) Give it a CONTAINER element: it creates the canvas inside and manages it.
        const stage = createTransitionStage(cardEl, defs, { before: captionEl });
      The container must be positioned (relative / absolute / sticky).
   2) Give it an existing <canvas>: it uses that canvas. The canvas follows the size
      of its parent (or pass { sizeEl } to follow another element).
        const stage = createTransitionStage(document.querySelector("canvas.my"), defs);

   THEN
        stage.has("burn0")                 // is this transition compiled and usable?
        const job = stage.play("burn0", fromSrc, toSrc, { duration: 1400, reverse: false });
        await job.done                      // true = finished, false = cancelled
        stage.cancel()                      // stop and hide
        stage.running                       // true while playing
   fromSrc / toSrc can be an <img>, <video> or <canvas>.
   The canvas is only visible while a transition plays. Returns null if WebGL is missing. */

import { createGLTransitions } from "./gl-transition.js";

export function createTransitionStage(
  target,
  defs,
  { className = "", before = null, sizeEl, zIndex = 1 } = {},
) {
  let canvas;
  let owned = false;
  if (target instanceof HTMLCanvasElement) {
    canvas = target;
  } else {
    owned = true;
    canvas = document.createElement("canvas");
    canvas.className = className;
    canvas.setAttribute("aria-hidden", "true");
    // inline defaults so the module works without any CSS
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: String(zIndex),
    });
    target.insertBefore(canvas, before);
  }
  canvas.style.display = "none";

  const gl = createGLTransitions(canvas, defs, { sizeEl });
  if (!gl) {
    if (owned) canvas.remove();
    return null;
  }

  let job = null;
  function cancel() {
    job?.cancel();
    job = null;
    canvas.style.display = "none";
  }
  function play(name, from, to, opts) {
    cancel();
    canvas.style.display = "block";
    const j = gl.run(name, from, to, opts); // draws the first frame synchronously
    job = j;
    j.done.then(() => {
      if (job === j) cancel();
    });
    return j;
  }

  return {
    canvas,
    has: gl.has,
    play,
    cancel,
    get running() {
      return job !== null;
    },
  };
}
