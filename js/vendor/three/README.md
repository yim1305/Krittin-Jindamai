# Vendored Three.js r160

Self-hosted copy of the exact Three.js build every scene's import map used to
pull from unpkg at runtime (`three@0.160.0`). Vendoring it removes a
third-party network round trip from the hero's first paint — the reason to
do this over just linking unpkg is speed, not licensing (MIT, same as
upstream).

```
build/three.module.min.js        the core, minified
examples/jsm/controls/OrbitControls.js
examples/jsm/utils/BufferGeometryUtils.js
examples/jsm/lines/Line2.js
examples/jsm/lines/LineGeometry.js
examples/jsm/lines/LineMaterial.js
examples/jsm/lines/LineSegments2.js       (Line2's dependency)
examples/jsm/lines/LineSegmentsGeometry.js (LineGeometry's dependency)
```

This is the full transitive closure of what `orbit-scene.js`, `system-scene.js`,
`cmg-scene.js` and `cbf-scene.js` actually import — not the whole `examples/jsm`
tree. Every file here keeps the exact relative path unpkg served it at, so the
addon files' own internal relative imports (e.g. `Line2.js` importing
`../lines/LineSegments2.js`) still resolve without edits.

## Updating the version

1. Fetch the new core: `https://unpkg.com/three@<version>/build/three.module.min.js` → `build/three.module.min.js`.
2. Re-fetch each file listed above from
   `https://unpkg.com/three@<version>/examples/jsm/<same path>`, checking
   whether any of them started importing an addon file not already in this
   list (grep each new file for `from '../` or `from './`) — if so, fetch
   that one too and keep mirroring its path.
3. Bump `three@0.160.0` to the new version in this file's own text above.
4. No cache-buster bump needed for this folder specifically — the importing
   HTML files' own `?v=` on `main.js`/`style.css` is unrelated; if you want
   browsers to pick up the new vendored files immediately rather than
   whenever their own cache expires, append a matching `?v=` query to the
   `<script type="importmap">` entries and the `modulepreload` links that
   point here.
