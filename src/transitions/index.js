/* Transition registry. To add a gl-transition:
   1. save its .glsl file in this folder
   2. import it with ?raw and add an entry below (uniforms are optional)
   3. use its key as `name` in TRANSITIONS in main.js
   A uniform whose value is a string is loaded as a video (see gl-transition.js). */
import burn0 from "./burn0.glsl?raw"; // author: liubailin2020
import FilmBurn from "./FilmBurn.glsl?raw";
import burn from "./burn.glsl?raw";
import customVideo from "./customVideo.glsl?raw";

const base = import.meta.env.BASE_URL; // "/" in dev, "/static/" in the Django build

export const transitionDefs = {
  burn0: { glsl: burn0, uniforms: { burnColor: [1.0, 0.5, 0.0] } },
  FilmBurn: { glsl: FilmBurn, uniforms: { Seed: 2.31 } },
  burn: { glsl: burn, uniforms: { color: [0.9, 0.4, 0.2] } },
  customVideo: {
    glsl: customVideo,
    uniforms: {
      fireVideo: base + "images/fireVideo.mp4", // path relative to /public
      mode: 3, // 0 luma matte | 1 overlay | 2 alpha mask | 3 video is the transition
      softness: 0.1, // mode 0 edge softness
      intensity: 1.0, // mode 1 strength
      envelope: 1.0, // mode 1: 1 = fade video in/out with progress, 0 = raw video
    },
  },
};
