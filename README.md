# Krittin Jindamai — Aerospace Engineering Portfolio

This is my portfolio site, built with plain HTML/CSS/JS and hosted on
GitHub Pages.

## Performance

All active WebGL scenes share `js/scene-performance.js`. Startup prepares
shaders before drawing, using parallel compilation where the driver supports
it, and yields between setup stages. The homepage initializes scenes on
approach, one at a time. Simulation CSV parsing yields every 256 rows without
changing the exported values; HCMG charts are constructed in separate tasks.

| Scene | Initial framebuffer limit | Maximum animation rate |
| --- | --- | --- |
| Hero | 1.4 million pixels | 60 FPS, divided to match the display |
| Projects Earth/Moon | 1.6 million pixels | 30 FPS active, 12 FPS ambient |
| HCMG / CBF | 1 million pixels each | 30 FPS |

Devices reporting at most 4 GB RAM, at most four logical processors, or Data
Saver use 55% of those pixel budgets, smaller planet textures, and lower frame
rates. Missing hardware hints use the standard settings. Sustained slow frames
reduce resolution and cadence further for the current visit. Pixel limits hold
even on 4K and ultrawide canvases; there is no minimum DPR overriding the limit.

Offscreen/hidden scenes cancel their scheduled work. HCMG charts can keep their
clock while its offscreen canvas skips drawing. Project videos pause offscreen
and in hidden tabs, preserve user pauses, and retain native playback controls.
Reduced motion renders static scenes with interactive navigation still enabled.

Run `node --test scripts/verify-performance.mjs` for scheduler, framebuffer,
simulation-data, video-lifecycle, syntax and asset-reference checks. These use
simulated browser timing, not a physical GPU. Actual loading smoothness, visual
quality and memory usage still need checking in Chrome/Edge, Firefox and Safari
on representative hardware. No browser or dev server was launched for this pass.

Implementation references: [Three.js shader preparation](https://threejs.org/docs/pages/WebGLRenderer.html#compileAsync)
and [MDN WebGL performance guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
