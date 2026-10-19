/* Transition registry. To add a gl-transition:
   1. save its .glsl file in this folder
   2. import it with ?raw and add an entry below (uniforms are optional)
   3. use its key as `name` in TRANSITIONS in main.js */
import burn0 from "./burn0.glsl?raw"; // author: liubailin2020

export const transitionDefs = {
  burn0: { glsl: burn0, uniforms: { burnColor: [1.0, 0.5, 0.0] } },
};
