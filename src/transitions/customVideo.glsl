// Author: custom
// License: MIT
// Description: Uses a video clip to drive the transition (4 modes)
// Tags: video, overlay, luma, matte, mask
// @mode 0 = luma matte, 1 = overlay, 2 = alpha mask, 3 = video plays as the transition
uniform sampler2D fireVideo; // bound by gl-transition.js from the URL given in index.js
uniform float mode /* = 1.0 */;
uniform float softness /* = 0.1 */;   // edge softness (mode 0)
uniform float intensity /* = 1.0 */;  // overlay strength (mode 1)
uniform float envelope /* = 1.0 */;   // mode 1: 1 = fade video in/out with progress, 0 = raw video

// same Y flip as getFromColor / getToColor
vec4 getVideoColor(vec2 uv) {
  return texture2D(fireVideo, vec2(uv.x, 1.0 - uv.y));
}

vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  vec4 v = getVideoColor(uv);
  vec3 col;

  if (mode < 0.5) {
    // 0: luma matte. Dark video pixels reveal the next image first, bright ones last.
    float s = max(softness, 0.001);
    float luma = dot(v.rgb, vec3(0.299, 0.587, 0.114));
    float p = mix(-s, 1.0 + s, progress);
    col = mix(a.rgb, b.rgb, smoothstep(luma - s, luma + s, p));

  } else if (mode < 1.5) {
    // 1: overlay. Crossfade with the video screen-blended on top
    // (best for fire / light leaks filmed on a black background).
    vec3 base = mix(a.rgb, b.rgb, progress);
    float k = mix(1.0, sin(3.14159265 * progress), envelope) * intensity;
    col = 1.0 - (1.0 - base) * (1.0 - v.rgb * v.a * k);

  } else if (mode < 2.5) {
    // 2: alpha mask. The next image shows where the video is opaque.
    // Needs a video with an alpha channel (VP9 WebM / HEVC alpha).
    float m = v.a;
    m = mix(m, 1.0, smoothstep(0.97, 1.0, progress)); // always end on B
    m *= smoothstep(0.0, 0.03, progress);             // always start on A
    col = mix(a.rgb, b.rgb, m);

  } else {
    // 3: the video itself is the transition. It covers the frame mid-way,
    // where A swaps to B, then clears.
    vec3 base = progress < 0.5 ? a.rgb : b.rgb;
    float cover = smoothstep(0.0, 0.25, progress) * (1.0 - smoothstep(0.75, 1.0, progress));
    col = mix(base, v.rgb, cover * v.a);
  }

  return vec4(col, 1.0);
}
