# Krittin "Yim" Jindamai — Aerospace Engineering Portfolio

Static site for GitHub Pages. Plain HTML/CSS/JS, no build step, relative paths
only. Dev-only context; safe to delete before publishing. Audience: professors
he's applying to work with — it must read as credible and technical, skim fast,
and link straight to specific projects.
**Keep this file under 300 lines.** Necessary information only — load-bearing
decisions, rules Krittin set, traps that have already caused bugs. Detailed
rationale belongs beside the code. When something is superseded, delete the
old passage rather than writing beside it.

## Files

```
index.html              single scrolling page, all five sections
css/style.css           everything
js/main.js              typing, eased scroll, reveals, nav, descent, starfield, clock
js/orbit-scene.js       the Three.js hero (ES module)
js/system-scene.js      the Three.js Earth/Moon system in Projects (ES module)
js/cmg-scene.js         real HCMG sim attitude animation, thesis.html only (ES module)
js/cbf-scene.js         real Gazebo CBF run, ros-research.html only (ES module)
js/moon-scene.js        SUPERSEDED, imported by nothing — kept as a revert path
projects/_template.html duplicate for a build/design project (timeframe/role/tools)
projects/_template-research.html duplicate for a research entry (PI/dept/duration)
scripts/export-cbf-run.ps1  derives assets/data/cbf-run.csv from the raw capture
assets/                 images/ (nebula-backdrop.webp, about media), papers/, data/
```

## Local dev

ES modules mean **`file://` will not work** — serve over HTTP (`npx serve .`).
Three.js r160 is vendored at `js/vendor/three/` (was unpkg — self-hosted so
the hero's first paint doesn't wait on a third-party CDN; see the README
there to update the version) and resolved via an import map in the `<head>`
of every page with a scene (required — addons import the bare specifier
`"three"`). No internet connection needed for the 3D scenes anymore.

**Do not start a server or open a browser to verify changes** — Krittin checks
visually himself and it loads his laptop. Reason about the code, state the
numbers and the viewport they assume, and say plainly what is unverified.

**Every `css/style.css`/`js/main.js` reference, and every scene module import,
carries a `?v=YYYYMMDD` cache-buster** (`index.html` and all of `projects/*`).
GitHub Pages' CDN and browsers can keep serving an older file after a
re-upload otherwise, which is what made the live site look different from
localhost after a push. **Bump the date in every one of those references**
whenever `style.css`, `main.js`, or a scene module changes, or the deploy
won't pick it up.

## Design system — "Factory" + space theme

Dark, flat, instrument-panel. **The UI itself is flat**: no shadows, glow, blur,
gradients, or emoji. Depth comes from contrast, hairlines and spacing.

**Colors** (hexes in `style.css`) — `--void`/`--void-edge` (backdrop),
`--obsidian`/`--carbon` (raised surfaces), `--ash` (hairlines), `--graphite`,
`--warm-granite`, `--pale-stone`, `--bone` (text), `--chalk` — the four mid
greys also underlie the 3D models' per-facet shading (`shadeByNormal`, each
model multiplying through its own tint). **`--orange`/`--green` stay
functional accents only**, never a model — just the two trajectories.
**Type** — Space Grotesk (400/500/600) headings/body; JetBrains Mono for labels/nav/mono data.
**Rules** — radii 3px buttons/nav, 10px cards, 999px pills, 20px panels; 1px
hairline borders, never shadows; 120px section rhythm (80px under 900px);
`--t-fast`/`--t-mid` on `--ease` for feedback, `--t-slow` on `--ease-out` for
entrances; eyebrows uppercase mono 12px with a small orange status dot.
**Depth exception** — two places only, because fully flat read as dull: the
backdrop (`.nebula` at 38% × `--sky-color`, three achromatic parallaxing star
layers, rare meteors) and the two 3D scenes. Nothing in the UI glows.
**`--sky-color`** is scroll-driven by `main.js`: full over the hero, draining
to 0 across the descent, back to `PROJECT_SKY` (0.8) for Projects and held
through Awards; detail pages set it to 0.
**Motion** — every animation must be skippable: honour `prefers-reduced-motion`
in CSS (block at the end of `style.css`) and JS (`REDUCED` in each file), and
prefer motion that *means* something over generic fades.

## Site structure

One page: `home` → `about` → `experience` → `projects` → `awards`.

- **Education/Skills are not sections** — Education is a list at the end of
  About's middle column; Skills is the vertical marquee in its right column
  (keeps `#skills` for deep links, out of the nav). Nav is five items:
  home/about/experience/projects/awards — the hero's fourth cubesat points at
  `#awards`, and **its `id` must equal the section id** (`onSelect` scrolls to
  `"#" + id`). **The nav order is duplicated in all seven `projects/` files.**
- **About is three columns** (portrait / bio+education / marquee), widening
  `.section-inner` to 1560px (Experience matches); the rest stay at 1200.
  Every section is `min-height: calc(100vh - 64px)`, content flex-centred —
  **`.section-inner` needs explicit `width: 100%`**, or a flex item with
  `margin: 0 auto` shrinks to content instead of stretching. **Auto margins
  suppress stretch on GRID items too** — inherited `margin: 0 auto` is what
  silently centred thesis.html's `.detail-header` in its columns; set
  `margin: 0` (or `width: 100%`) on any such item. Experience is six
  hairline rows inverting to a light panel on hover (`grid-template-rows:
  0fr -> 1fr`); no hover below 900px, so detail stays open.

## Page behavior (`js/main.js`)

- **Scrolling** — native smooth is off; eased scroll 620–1150ms scaled by
  distance, cancelled on user scroll, exposed as `window.smoothScrollTo`.
  `NAV_H = 64`. `[data-reveal]` settles in on intersection (`="left"` from the
  side), siblings staggered 90ms, capped at 5.
- **Nav** — active link decided once per observer callback, not per entry, or
  two sections fight over it. Links are absolutely centred (`left:50%;
  top:50%`, both explicit); below 900px they revert to the right-hand end.
- **Starfield** — three layers moved by `background-position` (not transform)
  so tiling stays seamless; depths 0.04/0.10/0.20. Meteor every 7–19s.
- **Nebula** — parallax 0.006 clamped ±30px, drift (96px/~69s x, 48px/~94s y),
  scale breathe (~41s, 1.285–1.395). **Judge these in px/sec, not amplitude**
  (sine peaks at 2πA/T): frozen twice under ~1 px/s, it's ~8.7 px/s now — the
  breathe is what makes it cloud, not a panned texture. 34% CSS overscale
  hides the edges — **raise it before raising these**. Reduced motion leaves
  transform unset so `transform:none` wins.
- **Descent** — one scroll handler publishes `--descent`/`window.__descentP`,
  `window.__risePx` and `--sky-color` as globals (not callbacks), because
  **`main.js` loads from `<head>`, render-blocking** — the scenes come later,
  but `pagereveal` fires at first render, so these must already be set.

## The descent — home, about and experience over one scene

Scrolling from the hero into About is a camera move, not a section break: the
globe is pinned across all three sections and the camera flies in until its
limb lies across the foot of About as a horizon. **One leg** — progress runs
0→1 over the hero's own height, so low orbit arrives as About's top meets the
nav, costing no extra scroll length.

- **Past the horizon the globe rides the scroll**, not the camera —
  `window.__risePx`, a pixel offset applied 1:1, **deliberately not eased**
  (lag reads as sliding against the content). Must stop exactly where the
  sticky scene unpins, or the two add up and the globe leaves at double speed
  (`main.js` derives that from `.descent`'s box); don't re-add camera motion.
- **The globe stays interactive at every scroll position** — drag, hover,
  labels, click-to-navigate, never gated on scroll; it's navigation, not
  ornament. `HORIZON_Y` (0.70, matched by `--horizon-band`) dials how much
  planet is on screen.
- **Pinning** — `#home`/`#about`/`#experience` share one `.descent` wrapper
  with `.hero-scene` as its sticky first child (Experience is in it because
  the canvas is clipped to its own box). Scene sized to the band under the nav
  (`top: 64px; height: calc(100vh - 64px)`) but keeping its full flow height —
  a sticky element releases at its margin box, so the usual negative-margin
  trick would pin it a screen too long — with the hero pulled back over it via
  `margin-top: calc(-100vh + 64px)`. The three sections are
  `pointer-events: none`, content taking it back, or they eat drags.
- **No descent below 900px or under reduced motion** (needs `left:0;right:0`,
  or sticky→absolute drops the auto width and the canvas collapses to zero);
  the scene has no `view-transition-name`.

## Page transitions

`@view-transition { navigation: auto; }`, cross-document, no JS. `.nebula`,
`.stars`, `.topnav` and `footer` carry `view-transition-name`s so the chrome
holds still and navigation reads as content swapping inside a fixed frame —
the single change that most improved it; do not fold them back in.

- **Motion is directional** — `main.js` sets `data-vt="forward"|"back"` on
  `<html>` before the snapshot, on **both** documents. Backdrop offsets carry
  over via `sessionStorage` (`krj-backdrop`), persisted on `pagehide`, painted
  synchronously on load — a late restore shows as a jump.
- **Shared-element morph is title-only** — `cardFor()` returns null for the
  Projects scene (it cross-fades; a 3D canvas can't be snapshotted). **Never
  put `data-reveal` on `.detail-header`/`.detail-media`** — it leaves them at
  `opacity: 0` when the snapshot is taken and the morph lands on nothing.
  Fallback is a 200ms exit-only fade, off under reduced motion.

## Home hero (`js/orbit-scene.js`)

Left third: name (types on), "(Yim)", title, focus line, live status strip,
numbered links. Right two-thirds: the 3D scene.

- **The globe is a cartographic instrument, not a photoreal planet** —
  posterised elevation, hairline coastline, flat ice caps (`abs(n.y)` kept
  high, 0.938 ≈ 20° cap), quantised terminator. **No glow anywhere**; the
  atmosphere is a billboarded hairline limb ring at `GLOBE_R * 1.075`.
  Continents bake ONCE into a 2048×1024 target — don't move that noise back
  into the per-frame shader.
- **The canvas is full-bleed across hero, About and Experience** (it used to be
  boxed in `.hero-right`, slicing cubesats in half); it reads right-of-centre
  because the frustum is offset (`SCENE_CENTER_WIDE` 0.68). **No lights at
  all** — six fixed per-face fills on the 4 cubesats, mid-grey not near-black,
  or they read as holes in the planet. `buildCubesat()` is also the Projects
  scene's satellite.
- **Hover is recomputed every frame from the stored pointer position**, not
  `pointerenter`/`pointerleave` — that sticks under a stationary cursor.

## Projects — the Earth/Moon system (`js/system-scene.js`)

Index order is **by year, most recent first, Lunar Hopper always last** (both
Krittin's). Order lives only in `index.html`'s `.proj-index`; `system-scene.js`
matches rows to objects by href, so reordering needs no change there.

| Project | Year | File | Model / where |
|---|---|---|---|
| Hybrid CMG Desaturation | 2026 | `thesis.html` | the hero's satellite, between the bodies |
| Non Holonomic CBF | 2026 | `ros-research.html` | TurtleBot at Earth's limb |
| Project TerraGator | 2025 | `rocket-airbrake.html` | Space Shuttle, outbound climb |
| Project Communigator | 2024 | `rocket-software.html` | SLS, on the way home |
| Sky Crane | 2025 | `controls-final-project.html` | octagonal deck + 4 thrusters, hovering |
| Lunar Hopper | 2026, in progress | `senior-design-project.html` | the hop arc off the south pole |

**TerraGator is the airbrake page, Communigator the software one** — the opposite
of the alphabetical guess. **Filenames have never changed and must not**
through two renames, to avoid breaking links.
The camera never moves; everything sits in a design frame of `(fx, fy)`
fractions `resize()` contain-fits. `LAYOUTS` (three presets by aspect) places
the bodies/satellites; the Moon is pushed toward the upper-right, then shifted
right by exactly one fifth of its displayed diameter. Its attached/flight-path
models follow. Per-preset camera margins keep the whole Moon and every model
inside the canvas. Two smaller satellites represent BDot Detumbling and
THEOS-3A: BDot is the projected midpoint from the CBF robot to TerraGator;
THEOS-3A starts halfway between the Lunar Hopper apex and the visible page
bottom, then moves down by half its own model height and 0.42 world units right
toward the project index; its label sits directly below. BDot's label sits
close above its satellite.
Both connect to their index rows, labels, hover panels, and project pages. All
three satellites use neighboring muted-gold shades. CMG is offset left by one
quarter of its nominal model width and down by one quarter of its height.
Communigator parks at the midpoint of the Moon-to-Earth return curve; its label
is offset down and right to clear the model. On desktop
`.proj-scene` rises 56px into the preceding sky;
the Moon's top aligns near the Projects eyebrow, while the wide layout moves
Earth left to meet the viewport edge. `framePos`'s `k` is real perspective,
not fudge.
**Judge spacing in SCREEN space, not world distance** — Navigator sits ~0.76
units behind the plane, so world (1.35 vs 1.16) and screen (449px vs 175px,
what Krittin saw) disagree; `cmg` keeps midpoint **fx**, raises **fy** till equidistant.

- **Earth is a whole globe** — the canvas runs 68% taller than its section
  (`--scene-spill`), so the lower half carries on behind Awards; `resize()`
  still solves preset/fit/camera against the *section* height, keeping Earth
  the same size and place. **The `--scene-spill: 1.68` override must sit AFTER
  the `1` default** — a media query adds no specificity, and putting it earlier
  once silently broke it. `.awards` needs `position:relative; z-index:1` (no
  background) to paint in front of the planet.
- **The index is TWO `.proj-index` navs** sharing the class (so
  `initIndexTyping()`/href-matching still see one six-row list) — top-left
  **Research** (CBF, CMG) in the ~26%×46% corner, bottom-right **Projects**
  (the other four), UNVERIFIED against the Moon-side composition, 39px
  (**1.5x**, up from 26). Row = title + year + optional `.proj-status`/
  `.proj-program`; only the title types, the rest fade in. CBF, CMG, Lunar
  Hopper carry "in progress"; Lunar Hopper's year is the real 2026.
- **Models are SOLID, not wireframes**, each its own muted colour (never
  `--orange`/`--green`, reserved for the flight paths; a `*_TINT` const per
  model) with per-facet opacity (`FILL_ALPHA_STEPS`, ~0.14–0.5), not flat.
  `shadeByNormal()` bakes tone+alpha per vertex on the MERGED geometry — the
  hero's per-face material ARRAY won't work here (`applyFade` needs one).
- **Three models have a preferred roll** or read as a stick/bare tube —
  shuttle/SLS keep identifying features in local XY, `park()` rolls that
  plane toward camera (`TERRAGATOR_ROLL`/`COMMUNIGATOR_ROLL`); satellite gets an
  explicit basis (not `setFromUnitVectors`, one axis only) plus `SAT_ROLL`.
- **`EDGE_CLEAN` is 32°** — a 12-gon's 30° seams vanish, a 10-gon's 36° draw.
  Cylinders/cones want ≥12, except **Sky Crane's deck**: octagon, 45°, deliberate.
- **One continuous flight-path line**, half-bright orange (`dim(ORANGE,0.5)`
  on colour, not opacity — opacity lets the starfield through), wrapping the
  Moon but not Earth, not closed into a loop. Outbound's hand-placed
  (`OUTBOUND_CONTROL`); homebound derives from the wrap tangent (`sign=-1`).
  Lunar Hopper's green arc is the loudest line — don't add a path unasked.
- **Hover opens `.proj-info`** instead of navigating — anchored next to the
  model itself (`updateInfoPanel()`, inline `left`/`right`/`top`, not a
  canvas-edge dock; `INFO_MOBILE_MQ` skips it under 900px, inline beats the
  bottom-sheet media query otherwise). Touch: a MODEL tap opens it, a second
  (or its link) navigates. `desc` is each page's real title, never fabricated.
- **`.proj-label` (16px/bone) is pushed off Earth's/Moon's disc** by
  `clearBody()` if `dx`/`dy` would sit it on one (`avoidEarth`/`avoidMoon`,
  off for whichever body the object stands ON). Nudges are a prefix of the
  text ("as far as 'nav'"), so `dx` derives from mono's 0.6em, not pixels.
- **`EARTH_YAW` is chosen at runtime** — a 128×64 bake scored for green land
  facing camera, becomes `earthSpin`'s rest rotation (arrival settles *onto* it,
  not 0). `EARTH_TILT_X` (−45°)/`MOON_TILT_X` (−35°) decide which pole faces where.
- **TurtleBot stands at Earth's LIMB, not on the disc** — `robotWant`'s
  toward-camera component (0.18) is the dial (~80° off view direction);
  below ~0.12 it crosses to the far side and floats. `greenestNear`'s green
  tie-break is 0.0004 — at 0.0015 a texel ~20° away could win, ruinous here.
- **Far field (Sun/Saturn/Mars) removed** — "just make nebula the thing that
  slowly changes." Earth's cloud shell is the only moving part and the only
  reason there's a render loop (`DRIFT_FPS` 24, visible-only, off reduced).
  Build each body *before* its graticule/limb/surface, or draw order breaks.
  Every path is a flat `Line2` — its `LineMaterial` needs `resolution` set, and
  `resize()` walks `isLineMaterial` **after** `applyLayout`.
- **Section sizing:** edge to edge, one screen above 900px, `flex-start` not
  `center` (center + hard height overflows both ends). Mobile: 70vh scene,
  index under it. `ROBOT_DROP` scales with `ROBOT_SCALE`. Separate scene from
  the hero — Krittin turned the continuous-globe version down.

## The CBF run — `js/cbf-scene.js`, ros-research.html's lead

Krittin's real Gazebo capture under a fixed camera: floor grid, commanded
spiral, safe set as four markers, TurtleBot, driven path. Rationale is in the
module header and `assets/data/README.md`; the rules that bite:

- **Playback covers 0-80 s at 2x** (40 s plus a 1.2 s end hold), per
  Krittin's request. `scripts/export-cbf-run.ps1` retains every source row in
  that window, unwraps yaw, and interpolates an exact 80 s endpoint. The three
  reset transitions are visually smoothed over 1.5 s, so the robot and trail
  remain continuous. Source timestamps and all poses outside those bridges
  remain intact; bridge poses are intentionally derived. **Reverse driving is
  real**; preserve the recorded heading.
- **The HUD reports signed distance to the safe set**; marker brightness
  indicates proximity, not QP activation.
- **The camera is solved, not placed** — `fitCamera()` contains the 5.5 × 13.5 m
  room at any aspect. Elevation and azimuth both cost scale; 50°/8° gives
  ~63 px/m at 1120 px and the room's length sets the canvas aspect, so re-check
  numerically before nudging either. Robot **drawn 4x** (1:1 is nine pixels),
  disclosed in the legend. Trail grows via `instanceCount`, never a rebuild.

## Content status — do not fabricate any of this

Placeholders are marked in brackets; leave them until Krittin supplies content.

- **About** — bio real (his own words: Thailand/GISTDA origin, research
  interests/experience/thesis); photo real, uncropped (`aspect-ratio:548/900`,
  height varies with it). **Education & coursework (real):** `.about-edu-row`
  puts education LEFT, coursework RIGHT; `.edu-detail` is `--pale-stone`,
  education's year its own line not "· year". **Awards section has no
  certificate list any more** — Krittin had it deleted entirely; the section
  stays in the DOM empty, only so the Projects globe's spill still has room.
- **Experience** — all 7 rows real, no `.exp-summary`. Order: CBF, then Space
  Systems Group (SSG). "Swamp Launch Rocketry Team (Swamplaunch)" reconstructs
  a message that came through blanked — UNVERIFIED, confirm the wording.
- **Projects** — years are real (table above). Research pages
  (`_template-research.html`: PI/department/duration/tools/focus/
  responsibility, a paper+code CTA) have real content on CBF (**university
  scholars program**) and CMG (**undergraduate honors thesis**) — tagged on
  their page, in `PROJECTS`' hover `desc`, and in the index (`.proj-program`,
  own line via `flex-wrap`). **CBF's lead is the animation now**, its two real
  Gazebo stills moved down into `.desc`. Build pages don't normally get a paper
  link — **Sky Crane is the exception**: a real class PDF Krittin asked to link
  (`controls-final-project.pdf`), its overview/approach/results AI-written FROM
  that PDF, 2 of its 3 results plots real exports (`crane-linsim-result.png`/
  `-nonlinsim-result.png`) and pole-placement simulated fresh from the PDF's
  poles/K-matrix (illustrative only, flag as needing his read-through).
  TerraGator/Navigator/Sky Crane otherwise use whatever `.desc` header
  breakdown Krittin gave, not a fixed overview/approach/results. Lunar Hopper
  untouched. thesis.html's lead media + five plots are
  live off `assets/data/`/`js/cmg-scene.js`, and **it is one grid, not two
  columns**: title, plots and animation share `.thesis-workspace` (three
  columns) so the animation's stacked halves line up with plot rows — satellite
  beside the title, globe beside the flywheel plots, torque beside
  gimbal/singularity — the canvas taking its height from the two rows it spans
  (`height:100%`, view labels off `50%`), write-up centred on the page.
  **No placeholders left there**: both `.desc` figures are Krittin's own
  diagrams (`cmg-pyramid-configuration.png`, `cmg-simulation-block-diagram.png`).
  **TerraGator and Communigator have real photos/video now** — background-removed
  cutouts use `.cutout` (no card, per-image aspect rather than a fixed box —
  "must see the entire model not image cutoff"). Communigator stacks its
  payload and retention-system photo under its `.is-xl` rocket in a sticky
  third rail pulled 220px upward to begin beside the page header. Its software-architecture diagram spans
  and centers across the complete three-column page grid; invert +
  grayscale keeps the filled boxes visible while a screen blend removes the
  diagram's white canvas. The page header and
  back link use the same 1500px grid as timeframe. Telemetry text describes an
  APRS package over the 2M LoRa link. `BaroData.csv` is an Excel-container
  source for `assets/data/communigator-flight-data.json`; the Communigator
  lead row places the launch photo left of the software architecture and the
  team photo beneath them. The Results section draws static filtered-altitude
  and filtered-velocity versus elapsed-time SVG charts from that extracted data.
  TerraGator's lead is
  `assets/video/terragator.mp4`, muted with a
  JS-delayed `.play()` 1s after load. `.detail-figure--plain` drops the
  carbon/ash box (Navigator's flight logs, the CMG block diagram). Higgsfield's
  free credits are at 0; local PowerShell/`System.Drawing` is the fallback —
  decontaminate edge colors (not just threshold alpha), or soft edges halo.
- **Skills marquee** — duplicated in the markup; edit both copies. Resume,
  LinkedIn and GitHub links are all real now.

## Generated assets

Decorative, non-representational assets only (background textures) may use the
Higgsfield MCP connector. **Project descriptions, experience entries and his
headshot must never be generated or invented.** Check `balance` and preflight
with `get_cost: true` (free-plan, credits scarce). Take the compressed
`minUrl` WebP, not the raw PNG (50 KB vs 6.4 MB), into `assets/images/`,
referenced relatively so it resolves from root and `projects/` both.
