# Project stills — NOT for the home Projects scene

**The home Projects section (js/system-scene.js) still doesn't use any of
these.** It's one fixed 3D Earth/Moon system with all six projects as real 3D
objects — no `<img>` elements at any viewport, so dropping files in here does
nothing for that section specifically.

That said, files here ARE now used by individual project DETAIL pages, a
different context this README used to not distinguish:
`projects/rocket-airbrake.html` (TerraGator) loads `terragator.png`,
`acs.webp`, `acs-2.webp`, `acs-3.png` and `acs-4.png` directly — the two
`.webp` ones are background-removed via Higgsfield's `remove_background`
(the site's 2 free-plan credits for this session, now at 0); `terragator.png`
already had no background from an earlier batch. `projects/rocket-software.html`
(Communigator) loads `navigator.png` (also already background-free),
`navigator-payload.png` (background AND a team-logo badge removed locally
with PowerShell + .NET `System.Drawing` — chroma-key on the near-white pixels
plus a hand-erased rectangle over the logo — once Higgsfield's credits ran
out), `navigator-retention-system.png`, `navigator-preflight.png`,
`navigator-flight.png` and `navigator-postflight.png` — renamed from their
original spaced/parenthesised filenames (and one typo, "Flioght") for a
clean URL. `projects/ros-research.html` (CBF) loads `cbf-1.png` (Gazebo
workspace, safe-set boundary + robot) and `cbf-2.png` (top-down trajectory
plot) — renamed from `CBF1.png`/`CBF 2.png` for the same reason.
`projects/controls-final-project.html` (Sky Crane) loads
`crane-linear-simulink.png` and `crane-nonlinear-simulink.png` (the two
Simulink models from the paper, `assets/papers/controls-final-project.pdf`)
— renamed from `crane lin simulink.png`/`crane nonlin simulink.png` — plus
`crane-linsim-result.png`/`crane-nonlinsim-result.png` (real exported
Figures 9–10/12–13, renamed from `linsim result.png`/`nonlinsim result.png`)
and `crane-poleplacement-response.svg`, the one plot still without a real
export — simulated fresh from the PDF's own poles/K-matrix, illustrative
only (see the note in the HTML for how, and why it isn't a replica of the
paper's actual noisy disturbance run).
`projects/thesis.html` (CMG) loads `cmg-pyramid-configuration.png` (the
four-CMG pyramid mounting diagram) — renamed from
`cmg pyramid configuration.png` — and `cmg-simulation-block-diagram.png`
(Krittin's own MATLAB simulation block diagram: tracking controller, HCMG
steering, and the MTQ cross-product desaturation loop), renamed from
`Thesis Simulation Block Diagram.png` for the same clean-URL reason. The
pyramid render is white-background and sits in the carbon box with `.is-chart`
(`contain`, so nothing is cropped). The 960x720 block diagram is
`.detail-figure--plain` — unboxed, full column width at its own aspect ratio,
because the box's 440px height cap shrank its labels too far to read — and its
ink was recoloured from black to `--bone` (#eeeeee) for the dark page:
Krittin's export is ALREADY alpha-cut (black strokes on full transparency, not
on white), so the recipe is simply "keep every pixel's alpha, set RGB to
#eeeeee". Do NOT derive alpha from luminance the way a chroma-key would — the
transparent field is (0,0,0,0), reads as black, and floods solid. His original
is kept verbatim as `cmg-simulation-block-diagram-source.png` so the recolour
can be redone or reverted. The live copy is additionally cropped to its ink
(960x479 from 960x720, 14px of breathing room top and bottom) — his export
carried ~116px of empty canvas above the drawing and ~153px below, which read
on the page as a gap the figure's CSS margins could not explain.

If the home scatter field is ever revived instead, see "Projects field" in
`CLAUDE.md` for what that would involve — its markup was deleted rather than
commented out, so it is a real rewrite, not a toggle.

The other four filenames this document used to ask for — `hybrid-cmg.png`,
`nonholonomic-cbf.png`, `sky-crane.png`, `lunar-hopper.png` — were never
supplied, and their `<img>` tags were silently 404ing for the whole life of the
old field. That is one of the reasons the section moved to real 3D.

## If a still is ever needed again

The two live sources for these objects are:

- `scripts/model-renders.html` — a standalone dev tool (not part of the built
  site) that constructs each object as real Three.js primitive geometry and
  renders it as a white-hairline-outline / transparent-body still. This is what
  Krittin approved instead of AI-generating pictures of his hardware.
- `js/system-scene.js` — the live scene, which is where every object's current
  design actually lives. Keep it and `model-renders.html` in step if either
  changes.

The standing rule still holds: **project descriptions, experience entries and
his headshot must never be generated or invented.** AI generation is permitted
only for decorative, non-representational assets (the nebula backdrop).
