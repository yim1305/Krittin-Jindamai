// ==========================================================================
// Projects — the Earth/Moon system.
//
// One FIXED 3D scene holding all eight projects at their designated places,
// replacing the old rotating-Moon scene (js/moon-scene.js, kept on disk as
// the revert path but no longer imported). Krittin's brief, and his sketch:
// Earth cropped by the bottom-left corner, the Moon fully visible on the
// right, and every project sitting where it belongs in that system —
//
//   CBF TurtleBot ............ standing on Earth's surface
//   Hybrid CMG satellite ..... between the flight path's two legs
//   Project TerraGator ....... Space Shuttle, on the outbound climb
//   Project Communigator ...... SLS, on the way home
//   Sky Crane ................ landed on the Moon's surface
//   Lunar Hopper ............. the hop arc off the Moon's south pole
//
// FIVE OF THE SIX ARE JUST OBJECTS NOW. The scene used to draw a trajectory
// for each of four of them; all four are gone, and only the Lunar Hopper's arc
// survives, because that project has no model and the line IS its object. See
// the block further down where they used to be described.
//
// The two rockets sit on ONE continuous flyby: out from Earth, a wrap around
// the Moon that passes in front of it on one side and behind it on the other,
// then home again. Krittin: "make the trajectory of the rocket line go around
// the moon, and connect to the one from earth as well like a passby."
//
// ALMOST NOTHING MOVES. No orbiting, no self-spin, no camera drift, no
// OrbitControls — Krittin: "keep it static for now, lets get the design
// pretty and every model looks good with camera angle and the scene first."
// The single exception is Earth's cloud shell, which he asked for afterwards.
//
// That exception costs more than it looks like it should, and it is worth
// knowing why. This scene was designed with NO requestAnimationFrame loop at
// all: it rendered once on arrival, again on each resize, and then cost
// exactly nothing while it sat on screen. Drifting clouds means re-rendering
// the whole scene, so the loop is back. It is kept on the tightest leash that
// still looks right — visible-only, throttled well under display rate, and
// skipped entirely under prefers-reduced-motion. See the arrival section at
// the bottom. Do not add any FURTHER continuous motion without a reason worth
// that trade; this is a second WebGL context on a page that already runs a
// full-screen scene.
//
// Everything else follows the house style unchanged, and most of it is
// lifted from js/orbit-scene.js and js/moon-scene.js rather than reinvented:
// posterised elevation bands instead of gradients, a hairline at the
// coast/mare boundary, a hairline limb ring instead of any glow, a graticule
// with an orange equator kept on top of the solid surface, a terminator
// quantised to four flat steps, one shared light DIRECTION and NO LIGHTS IN
// THE SCENE AT ALL. Paths are flat screen-space Line2 ribbons, never 3D tube
// geometry — see flatLine() for why that matters.
//
// ---- how the composition is placed ------------------------------------
//
// The camera never moves, so rather than hand-tuning world coordinates,
// every object is placed against a DESIGN FRAME: a rectangle FRAME_W x
// FRAME_H world units, at the depth of the Earth/Moon plane, which is
// guaranteed to be fully visible. Positions inside it are given as plain
// (fx, fy) fractions — (0,0) top-left, (1,1) bottom-right — exactly like the
// --x/--y percentages the old CSS scatter field used, which is why the
// numbers below can be read straight off the sketch.
//
// Three layout presets cover the range of canvas aspects (see LAYOUTS).
// They exist because one composition cannot serve both a 1.9:1 desktop band
// and a 0.5:1 phone: on a portrait canvas the Moon has to sit ABOVE Earth
// rather than beside it. Switching preset repositions the two bodies and
// rebuilds the two flight arcs; everything else is parented to a body and
// follows for free.
//
// The arcs are the one thing NOT specified in frame fractions, because they
// span between the two bodies and would need re-deriving per preset. They
// are given in an axis-relative frame instead — s along Earth->Moon, h
// perpendicular to it, c toward the camera, all in units of the Earth-Moon
// separation — so one table of numbers works in all three layouts.
//
// UNVERIFIED: none of the framing arithmetic below has been checked in a
// browser (standing instruction not to run the site). The screen positions
// quoted in the comments are computed for the WIDE preset at a 1440x740
// canvas. Check them by eye before trusting any of them further.
// ==========================================================================

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
// Fat lines. Every path in this scene (the flyby trajectory, the orbit ring,
// the CBF trail, the hop arc) is drawn with these rather than as 3D tube
// geometry — see flatLine() for why.
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

// Straight from the design tokens in css/style.css — keep them in sync.
// The four greys are the model fill palette (see FILL_STEPS), and are the same
// four the hero's cubesats step their faces through in orbit-scene.js.
const CARBON = 0x1d1a18;
const ASH = 0x3d3a39;
const GRAPHITE = 0x4d4947;
const WARM_GRANITE = 0x8a8380;
const PALE_STONE = 0xb8b3b0;
const BONE = 0xeeeeee;
const ORANGE = 0xee6018;
const GREEN = 0xa0ca92;

const DEG = Math.PI / 180;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Scales every channel of a packed 0xRRGGBB colour. Used to darken an accent
// without reaching for opacity, which would blend it into the backdrop and
// let the starfield show through instead of just dimming it.
function dim(hex, k) {
  const r = Math.round(((hex >> 16) & 0xff) * k);
  const g = Math.round(((hex >> 8) & 0xff) * k);
  const b = Math.round((hex & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

// --------------------------------------------------------------------------
// Scene constants.
// --------------------------------------------------------------------------
const EARTH_R = 1.0;
const MOON_R = 0.8; // ~0.8x Earth's apparent size, as sketched — not to scale

// A longish lens, deliberately. At the framing below a 34-degree fov puts the
// camera ~3.5 units from a radius-1 sphere, which bends the limb like a
// fisheye; 22 degrees pulls back to ~5.6 and keeps both silhouettes clean, so
// the 3/4 tilt reads through the graticule ellipses rather than through
// perspective distortion. That suits an instrument panel better than a photo.
const CAM_FOV = 22;
// The 3/4 tilt Krittin picked: ~17 degrees above the Earth-Moon plane, so
// orbit rings and flight arcs read as ellipses sweeping through depth and
// surface objects sit on a visibly curved surface.
const CAM_EL = 17 * DEG;
const CAM_AZ = 0;

// Axial tilts. NEITHER of these is cosmetic — both are load-bearing, and both
// are about which pole is pointed where.
//
// Earth: -45 degrees about X tips the NORTH POLE AWAY from the camera, which
// is the point. Krittin: "choose another Earth orientation (white pole makes
// the color werid) (chioose the side that is just green and blue)". Earth is
// cropped by the bottom-left corner, so the part of the disc actually in frame
// is its upper right — which, at a 23.4-degree tilt, was showing the north ice
// cap, and a hard white plate is exactly the wrong note against posterised
// ocean and land. At -45 the whole north cap sits on the far side (its nearest
// edge is still 98 degrees off the view direction) and the south cap projects
// to y ~143% of the frame, well inside the cropped-off region. What is left in
// view is low and mid latitude: blue and green only.
//
// Moon: -35 degrees about X does the opposite job. At +17 degrees of camera
// elevation the true south pole faces slightly AWAY, and the Lunar Hopper arc
// has to start there (Krittin: "same line on moon south pole"). The tilt
// brings it back round to the near side so the hop leaves where you can see it.
//
// Both are X-only, deliberately: surface directions are converted through
// these by hand (see the Sky Crane note, and chooseEarthYaw, which inverts the
// tilt to score the bake), and a single-axis rotation has an inverse you can
// write down. Adding a second axis means redoing that algebra.
const EARTH_TILT_X = -45 * DEG;
const MOON_TILT_X = -35 * DEG;

// Model scales. Every one of these is far larger than the real object would
// be against a planet, and that is the long-standing call on this section:
// legibility of "which project is this" beats literal scale. Rough on-screen
// sizes at a 1440x740 canvas, where 1 world unit ~ 339px.
const ROBOT_SCALE = 0.39; // TurtleBot ~89px across — 1.3x, per Krittin
// 1.5x, per Krittin, up from the 0.34 that had matched the old CMG bus's
// on-screen width. ~0.98 model units tip-to-tip, so about 170px of wingspan.
const CMG_SCALE = 0.51;
const CRANE_SCALE = 0.72; // lander ~76px across
// The two launch vehicles were on ONE shared scale until Krittin asked for
// them to grow by different amounts ("navigator 1.3x bigger, and terragator
// 2x bigger"), which a single constant cannot express. Both are multiples of
// the 0.448 they shared. TerraGator is the far bigger jump because the
// shuttle orbiter's own model is much shorter than SLS's stack, so at equal
// scale it read as the smaller vehicle.
const TERRAGATOR_SCALE = 0.896; // 2x
const COMMUNIGATOR_SCALE = 0.582; // 1.3x
const DECORATIVE_SAT_SCALE_A = 0.34;
const DECORATIVE_SAT_SCALE_B = 0.29;

// The scene bakes both Earth and Moon on approach. 768 is sufficient for the
// posterised surfaces; high-density laptops step down further at init time.
const BAKE_W = 768;

// --------------------------------------------------------------------------
// Layout presets, widest first. `min` is the canvas aspect (w/h) at or above
// which the preset applies; the thresholds sit where two neighbouring presets
// zoom out by the same amount, so neither is ever obviously the wrong choice.
//
//   fw/fh    the design frame, in world units. fh sets the scale: Earth's
//            radius is EARTH_R/fh of the frame's height.
//   earth    frame fraction of Earth's CENTRE. y > 1 means below the frame,
//            i.e. deliberately cropped by the bottom edge.
//   moon     frame fraction of the Moon's centre. Always fully inside.
//   cmg      frame fraction of the CMG cubesat, which has no orbit to ride.
//   fit      extra camera margin that keeps the shifted Moon/models uncut.
//
// Everything else is derived: the rockets ride the flight path, and the two
// surface models are placed by direction inside their body's tilted group.
// Switching preset repositions the bodies and rebuilds the flight path; the
// rest follows.
// --------------------------------------------------------------------------
// EARTH IS NO LONGER CROPPED BY THE BOTTOM OF THE SECTION. Its centre is still
// below the design frame — that has not changed and must not, the composition
// depends on it — but the canvas now runs taller than the section it sits in,
// so the lower half of the globe carries on behind Awards instead of being
// sliced off by a hard straight edge. Krittin: "dont crop off earth maek erth
// a full globe (keep it where it is, the bottom half just be on the awards
// page)". See --scene-spill in css/style.css and the spill note in resize():
// the frame, the preset choice and the camera are all still solved against the
// SECTION-visible height, which is what keeps Earth at the same size and in
// the same place while more of it becomes visible.
//
// The Moon now sits farther toward the upper-right in every preset. Its surface
// models move with moonSpin, the flight path is rebuilt from its new position,
// and the rockets parked on that path follow automatically.
//
// The CMG satellite shifts with the Moon rather than remaining at its former
// midpoint, preserving the visual relationship among the upper models.
const LAYOUTS = [
  // Wide desktop band. Earth 46% of frame height, centred below the frame at
  // x = 6%; Moon 37% of frame height, spanning x 52-90%, y 7-81%.
  // Two smaller satellites occupy the open sky below the two index regions.
  { min: 1.46, fw: 4.23, fh: 2.18, fit: 1.20, earth: [-0.04, 1.12], moon: [0.77, 0.325], cmg: [0.43, 0.49] },
  // Squarish — small laptop windows, tablets in landscape. Moon-limited: 394px
  // vs 102px, with 0.15 world of clearance left past the Moon.
  { min: 0.83, fw: 3.3, fh: 2.9, fit: 1.28, earth: [0.06, 1.07], moon: [0.73, 0.235], cmg: [0.445, 0.56] },
  // Portrait. The Moon stacks ABOVE Earth rather than beside it; both bodies
  // shrink to a quarter of the frame height so the labels have room. The index
  // is not overlaid here at all — it flows under the canvas. Moon-limited too:
  // 201px vs 50px at 0.15 clearance.
  { min: 0, fw: 2.2, fh: 4.0, fit: 1.52, earth: [0.32, 1.0], moon: [0.62, 0.12], cmg: [0.475, 0.455] },
];

// --------------------------------------------------------------------------
// Camera basis. The camera direction never changes, so its right/up/forward
// axes are constants — which is what lets every position below be written in
// screen-ish terms (right, up, toward-camera) instead of world coordinates.
// DIR points FROM the scene TOWARD the camera, so +c in any placement helper
// means "nearer the viewer".
// --------------------------------------------------------------------------
const DIR = new THREE.Vector3(
  Math.cos(CAM_EL) * Math.sin(CAM_AZ),
  Math.sin(CAM_EL),
  Math.cos(CAM_EL) * Math.cos(CAM_AZ)
).normalize();
const RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), DIR).normalize();
const UP = new THREE.Vector3().crossVectors(DIR, RIGHT).normalize();

// --------------------------------------------------------------------------
// THE FLIGHT PATH — one continuous line, wrapping the Moon but not Earth.
//
// This used to be one closed circuit wrapping fully around BOTH bodies.
// Seeing it actually rendered, Krittin cut the Earth side: "remove the white
// line that circles around both earth and moon, idk what that line is for."
// That round also removed the Moon wrap along with it, but that went too far
// — the very next round asked for it back: "the old line used to look more
// like a trajectory that wraps around the moon, bring that back." So the
// Earth wrap stays gone, but the Moon wrap (`moonWrap` in buildFlight below)
// is back, and it is stitched into ONE line with the outbound and homebound
// legs either side of it — not a closed loop (the two Earth-side ends do not
// connect to each other), but not two disconnected pieces either.
//
// wrapBasis/wrapPoint/wrapTangent still place the four points near each body
// and give the tangent to leave or arrive along; Earth's pair (eEnter/eExit)
// are no longer the ends of a drawn arc, just anchor points for the two legs.
//
// TerraGator's leg also needed reshaping, not just re-parking: Krittin,
// looking at the actual render, pointed out a wide empty gap between the
// .proj-index list and where the rocket sat, and asked for the whole leg —
// rocket included — to move into it and climb higher ("up more"). A leg whose
// control points are derived purely from the Earth-side tangent can only
// bulge between the height of its two endpoints, which cannot reach up into
// that gap — so the outbound leg's two control points are hand-placed in
// frame fractions (OUTBOUND_CONTROL below) instead. The homebound leg is
// unchanged by any of this and still uses the tangent-derived construction.
// --------------------------------------------------------------------------
// Raised from 1.3 — Krittin: "trajectory coming out of moon to earth part of
// it is overlapping with the moon, and ... it should not block the skycrane
// model." At 1.3 the homebound leg's departure sat close enough to the disc
// that it could read as crossing it, and mEnter (near the Moon's top, where
// the outbound leg used to wrap in) sat close to Sky Crane. More radius pushes
// both construction points further out from the surface without touching the
// tangent-continuity math below (only the radius changes, not the entry/exit
// angles or tilt). UNVERIFIED — check both complaints are actually gone, and
// increase further if not.
const WRAP_R_MOON = 1.6; // multiples of MOON_R — clear of the limb ring at 1.075
const WRAP_TILT_MOON = 28 * DEG;
// Earth's wrap is tilted much further toward the vertical. At the Moon's 28
// degrees the entry point would sit ~1.13 world units toward the camera, and
// framePos's perspective correction then throws it off the left edge of the
// frame — Earth is already at x = 6%, so there is nothing to spare. 60 degrees
// puts most of the offset into UP instead, which is where it is wanted.
const WRAP_R_EARTH = 1.28; // multiples of EARTH_R
const WRAP_TILT_EARTH = 60 * DEG;

// How far the homebound leg's wrap-side control points sit along their
// tangent, as a multiple of the Earth-Moon separation. Bigger = a longer,
// lazier approach that hugs the tangent direction further before turning.
// Only homebound uses these now — outbound's control points are hand-placed,
// see OUTBOUND_CONTROL below.
const LEAD_EARTH = 0.3;
const LEAD_MOON = 0.42;
// Extend both open ends beyond their old endpoints by a small fraction of the
// Earth-Moon separation, keeping the same tangent and line weight.
const FLIGHT_END_EXTENSION = 0.06;

// The outbound leg's two control points, as frame fractions — replacing the
// tangent-derived ones now that the leg no longer has to join a drawn wrap
// arc (see the note above WRAP_R_MOON). Chosen to pull the curve up into the
// gap between the .proj-index list and where TerraGator used to sit: Krittin,
// looking at the render, "there is an empty space between where terragator is
// right now and the index top left, move the rocket and trajectory to that
// free space." The two points hold the curve high and roughly flat across
// that gap rather than climbing straight from Earth to the Moon. UNVERIFIED —
// these are a first guess against the screenshot, not measured against the
// live layout; nudge fx right if it still reads close to the index, or fy
// down for more height.
const OUTBOUND_CONTROL = [
  [0.2, 0.14],
  [0.42, 0.11],
];

// Where each rocket is parked, as a fraction of arc length along its OWN leg.
//
// TerraGator moved from 0.75 (parked right by the Moon's edge, overlapping
// its disc — Krittin: "rocket is infront of moon rn, i want rocket not
// infront of anything") to about the middle of the new hand-placed leg above,
// which should land it in the gap by the index rather than at either end.
// UNVERIFIED.
const TERRAGATOR_T = 0.5;
// Midpoint of the Moon-to-Earth return leg, remaining on the same curve.
const COMMUNIGATOR_T = 0.5;

// How far each vehicle is rolled off exactly-broadside, about its own long
// axis. See the long note on park(): 0 would face each model's identifying
// plane flat at the camera, which for the shuttle is a plan view with the fin
// pointing straight at you (invisible), and for SLS hides how the boosters
// stand off the core. These tip both into a three-quarter view.
const TERRAGATOR_ROLL = 36 * DEG;
const COMMUNIGATOR_ROLL = 26 * DEG;

// Dash pitch for the Lunar Hopper's arc, which is the only dashed line left in
// the scene. The flight path is solid — Krittin: "make rocket trajectory a
// thin solid white line isntead of mix of solid and dash lines (make it thin)"
// — and the CMG orbit is gone entirely: "remove trajectory line for the
// satellite".
const DASH_TRAJ = 0.11;
const GAP_TRAJ = 0.085;

// The flight path: thin, solid, and a DIMMED orange. Krittin asked for orange
// ("change rocket trajectory line to orange"), then for it to be toned down:
// "make orange trajectory line color half bright". Full --orange next to the
// posterised planets pulled the eye straight off them.
//
// Halved in the literal sense — every channel of --orange #ee6018 multiplied
// by 0.5 — rather than by dropping opacity, because opacity would blend it
// toward the backdrop and let the starfield show through the line. This keeps
// it solid, just darker. Raise HALF back toward 1 to undo.
const FLIGHT_COLOR = dim(ORANGE, 0.5);
const FLIGHT_WIDTH = 1.3;
const FLIGHT_OPACITY = 0.92;

// The far field (Sun/Saturn/Mars drifting behind the Earth/Moon plane) was
// removed — Krittin: "remove sun and saturn and just make nebula the thing
// that slowly changes in the background." The .nebula backdrop (main.js) is
// the section's one slow-moving background element now; this scene keeps only
// Earth's cloud drift, which is the render loop's sole remaining reason to
// exist.

// --------------------------------------------------------------------------
// Shared GLSL — the value-noise/fBm pair both bodies use, plus the Worley
// cell noise that makes the Moon's craters (fBm alone gives reticulated
// ridges and never circles). Identical to the versions in orbit-scene.js and
// moon-scene.js; copied rather than imported because neither of those files
// is written as a library and this scene must not be able to break the hero.
// --------------------------------------------------------------------------
const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p){
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 hash33(vec3 p){
    p = vec3(dot(p, vec3(127.1, 311.7,  74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }
  float vnoise(vec3 x){
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
          mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
          mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p){
    float amp = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 6; i++){
      sum += amp * vnoise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }
  float worley(vec3 p){
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d = 1e9;
    for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
    for (int z = -1; z <= 1; z++){
      vec3 g = vec3(float(x), float(y), float(z));
      d = min(d, length(g + hash33(i + g) - f));
    }
    return d;
  }
`;

// Both bakes share this preamble and this plumbing — only the body of the
// fragment shader differs. The direction reconstruction mirrors
// THREE.SphereGeometry's UV convention exactly, so the bake lands on the mesh
// with no seam; change one and you must change the other.
function bakeEquirect(renderer, width, bodyGLSL) {
  const height = width / 2;

  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: true,
    depthBuffer: false,
    stencilBuffer: false,
  });

  renderEquirect(renderer, target, bodyGLSL);
  return target.texture;
}

// The render half of the bake, split out so the face-picking analysis can run
// the SAME shader into a tiny target of its own and read it back — see
// sampleEarthSurface(). Two callers, one definition, no chance of the analysis
// drifting away from what the globe actually shows.
function renderEquirect(renderer, target, bodyGLSL) {
  const bakeScene = new THREE.Scene();
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main(){
        float theta = (1.0 - vUv.y) * 3.14159265;
        float phi = vUv.x * 6.28318531;
        vec3 n = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
        ${bodyGLSL}
      }
    `,
  });

  bakeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMat));

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(bakeScene, bakeCam);
  renderer.setRenderTarget(prevTarget);

  bakeMat.dispose();
  bakeScene.children[0].geometry.dispose();
}

// Earth. Same posterised bands, coastline hairline and hard-edged ice caps as
// the hero globe, and — as on the hero — the alpha channel carries cloud
// density for the drifting shell above it.
const EARTH_BAKE_GLSL = /* glsl */ `
  const float SEA = 0.524;

  vec3 warp = vec3(
    fbm(n * 2.1 + 13.7),
    fbm(n * 2.1 + 41.3),
    fbm(n * 2.1 + 67.9)
  ) - 0.5;
  float h = fbm(n * 2.6 + warp * 1.35);

  vec3 abyssal = vec3(0.063, 0.129, 0.176);
  vec3 basin   = vec3(0.106, 0.239, 0.322);
  vec3 shelf   = vec3(0.180, 0.376, 0.463);
  vec3 ocean = abyssal;
  ocean = mix(ocean, basin, step(0.400, h));
  ocean = mix(ocean, shelf, step(0.482, h));

  vec3 lowland  = vec3(0.290, 0.420, 0.310);
  vec3 midland  = vec3(0.427, 0.573, 0.408);
  vec3 highland = vec3(0.627, 0.792, 0.573);   // #a0ca92, the design green
  vec3 land = lowland;
  land = mix(land, midland,  step(0.575, h));
  land = mix(land, highland, step(0.640, h));

  vec3 base = mix(ocean, land, step(SEA, h));

  float coast = 1.0 - smoothstep(0.0, 0.0075, abs(h - SEA));
  base = mix(base, vec3(0.541, 0.678, 0.722), coast * 0.85);

  // n.y is the cosine of the polar angle, so 0.938 is a cap of about 20
  // degrees angular radius. Keep it high — 0.8 swallows a third of the globe,
  // and the CBF TurtleBot sits at 60 degrees north, which must stay off it.
  float polar = step(0.938, abs(n.y));
  float polarEdge = 1.0 - smoothstep(0.0, 0.010, abs(abs(n.y) - 0.938));
  base = mix(base, vec3(0.851, 0.855, 0.859), polar * 0.94);
  base = mix(base, vec3(0.678, 0.694, 0.706), polarEdge * 0.7);

  // Cloud density rides in the alpha channel, on different noise coordinates
  // so the weather doesn't trace the coastlines. Quantised to two flat levels
  // so it reads as an overlay on a chart rather than as volumetric cloud.
  float c = fbm(n * 3.4 + 91.2);
  float cloud = step(0.560, c) * 0.55 + step(0.625, c) * 0.45;

  gl_FragColor = vec4(base, cloud);
`;

// Moon. Greys rather than blue and green — read Krittin's "same colors" as
// the same palette and the same treatment, not literally Earth's blues. The
// alpha channel carries crater rims, which the surface shader strokes as a
// hairline exactly where Earth gets its coastline.
const MOON_BAKE_GLSL = /* glsl */ `
  const float MARE = 0.508;

  vec3 warp = vec3(
    fbm(n * 1.9 + 21.3),
    fbm(n * 1.9 + 53.1),
    fbm(n * 1.9 + 88.7)
  ) - 0.5;
  float h = fbm(n * 2.3 + warp * 1.5);

  vec3 mareDeep  = vec3(0.078, 0.082, 0.090);
  vec3 mareMid   = vec3(0.114, 0.118, 0.129);
  vec3 mareEdge  = vec3(0.153, 0.157, 0.169);
  vec3 mare = mareDeep;
  mare = mix(mare, mareMid,  step(0.400, h));
  mare = mix(mare, mareEdge, step(0.470, h));

  vec3 highLow  = vec3(0.290, 0.278, 0.271);
  vec3 highMid  = vec3(0.400, 0.384, 0.376);
  vec3 highTop  = vec3(0.541, 0.514, 0.502);   // #8a8380, --warm-granite
  vec3 high = highLow;
  high = mix(high, highMid, step(0.558, h));
  high = mix(high, highTop, step(0.622, h));

  vec3 base = mix(mare, high, step(MARE, h));

  float shore = 1.0 - smoothstep(0.0, 0.008, abs(h - MARE));
  base = mix(base, vec3(0.482, 0.459, 0.451), shore * 0.8);

  float bigD   = worley(n * 4.5);
  float smallD = worley(n * 11.0);
  float density = smoothstep(0.35, 0.62, fbm(n * 1.7 + 5.5));

  float bigFloor = (1.0 - step(0.20, bigD)) * density;
  float bigRim   = (1.0 - smoothstep(0.0, 0.020, abs(bigD - 0.21))) * density;
  float smFloor  = (1.0 - step(0.16, smallD)) * (0.4 + 0.6 * density);
  float smRim    = (1.0 - smoothstep(0.0, 0.030, abs(smallD - 0.17))) * (0.4 + 0.6 * density);

  base *= 1.0 - 0.30 * bigFloor - 0.16 * smFloor;

  gl_FragColor = vec4(base, clamp(bigRim + smRim * 0.7, 0.0, 1.0));
`;

// --------------------------------------------------------------------------
// The two body meshes. One texture fetch and a stepped terminator each — the
// same shader both other scenes use. `uRim` is the only difference: 0 for
// Earth (its alpha channel is unused), 0.55 for the Moon, where alpha is the
// crater-rim mask and gets stroked in --pale-stone.
//
// The light DIRECTION is shared with the hero globe so all three bodies on
// the site are lit consistently — there is still no actual light anywhere.
// --------------------------------------------------------------------------
// buildBody() and buildClouds() below both just need vUv/vWorldN for their
// fragment shader, so they share this pass-through vertex shader rather than
// each carrying their own identical copy.
const SURFACE_VERTEX_GLSL = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldN;
  void main(){
    vUv = uv;
    vWorldN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function buildBody(surfaceTex, radius, segments, rim, ambient) {
  const uniforms = {
    uSurface: { value: surfaceTex },
    uLight: { value: new THREE.Vector3(0.55, 0.42, 0.72).normalize() },
    uFade: { value: REDUCED ? 1 : 0 },
    uRim: { value: rim },
    uAmbient: { value: ambient },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: SURFACE_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSurface;
      uniform vec3 uLight;
      uniform float uFade;
      uniform float uRim;
      uniform float uAmbient;
      varying vec2 vUv;
      varying vec3 vWorldN;

      void main(){
        vec4 surf = texture2D(uSurface, vUv);
        vec3 albedo = mix(surf.rgb, vec3(0.722, 0.702, 0.690), surf.a * uRim);

        vec3 N = normalize(vWorldN);
        vec3 L = normalize(uLight);

        // Four flat steps. Smooth falloff and specular both read as
        // photography and are the thing this style exists to avoid.
        float day = smoothstep(-0.22, 0.44, dot(N, L));
        day = floor(day * 4.0 + 0.5) / 4.0;

        gl_FragColor = vec4(albedo * (uAmbient + (1.0 - uAmbient) * day), uFade);
      }
    `,
  });

  const geo = new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.66));
  return { mesh: new THREE.Mesh(geo, material), uniforms };
}

// --------------------------------------------------------------------------
// Earth's cloud shell — the one thing in this scene that moves.
//
// Reads the alpha channel of the same bake. The mesh carries its own UVs, so
// rotating it drifts the weather over the surface underneath. Flat --chalk at
// low opacity in two quantised levels: a weather overlay on a chart, not
// volumetric cloud.
//
// This is what put a render loop back into a scene that was designed not to
// need one (Krittin asked for moving clouds directly). It is kept as cheap as
// it can be: the loop runs only while Projects is on screen, is throttled well
// below display rate — the drift is far too slow for anyone to see the
// difference — and is skipped outright under prefers-reduced-motion, where the
// shell is simply drawn once and left still.
// --------------------------------------------------------------------------
function buildClouds(surfaceTex, radius) {
  const uniforms = {
    uSurface: { value: surfaceTex },
    uLight: { value: new THREE.Vector3(0.55, 0.42, 0.72).normalize() },
    uFade: { value: REDUCED ? 1 : 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: SURFACE_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSurface;
      uniform vec3 uLight;
      uniform float uFade;
      varying vec2 vUv;
      varying vec3 vWorldN;

      void main(){
        float a = texture2D(uSurface, vUv).a;
        if (a < 0.01) discard;
        float day = step(0.0, dot(normalize(vWorldN), normalize(uLight)));
        gl_FragColor = vec4(vec3(0.980, 0.980, 0.980), a * 0.17 * (0.25 + 0.75 * day) * uFade);
      }
    `,
  });

  return {
    mesh: new THREE.Mesh(new THREE.SphereGeometry(radius * 1.016, 64, 48), material),
    uniforms,
  };
}

// --------------------------------------------------------------------------
// Chrome: limb ring and graticule. Both straight out of the other two scenes.
//
// The limb is a hairline, never a glow, and is billboarded to the camera so
// it traces the apparent silhouette. In this scene the camera never moves, so
// unlike the other two it is oriented once rather than every frame.
// --------------------------------------------------------------------------
function buildLimbRing(radius, segments = 192) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(radius * Math.cos(t), radius * Math.sin(t), 0));
  }
  const material = fadeable(
    new THREE.LineBasicMaterial({ color: PALE_STONE, transparent: true, opacity: 0.4, depthWrite: false })
  );
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
}

// Kept ON TOP of the solid surface at low opacity — the move that makes a
// body read as an instrument rather than as a stock 3D planet. depthTest on
// so the far side is hidden; depthWrite off so the lines don't fight each
// other where they cross. Orange marks the equator and nothing else.
// `equatorOpacity` of 0 (or less) omits the orange equator ring entirely
// rather than drawing it invisibly — which is how both bodies are built in
// THIS scene. Krittin: "Remove orange equator line for earth and moon in this
// page as well (home page stays same)". The hero globe in orbit-scene.js keeps
// its equator; that file is untouched. The only orange left in this scene is
// the flight path (see FLIGHT_COLOR) — keep it off the bodies themselves.
function buildGraticule(radius, gridOpacity, equatorOpacity) {
  const group = new THREE.Group();
  const gridMat = fadeable(
    new THREE.LineBasicMaterial({ color: PALE_STONE, transparent: true, opacity: gridOpacity, depthWrite: false })
  );

  // THINNED, from 12 x 8. Two bodies each wearing a 19-curve net, under four
  // paths, is a lot of line for something that is only meant to say "this is a
  // sphere and here is its axis" — and Earth's visible face is a cropped
  // sliver that happens to sit directly behind the busiest object in the
  // scene. 8 x 6 keeps the equator (an even `parallels` puts a circle at
  // phi = 0) and drops a third of the curves.
  const SEG = 64;
  const gridPoints = [];
  const addLoop = (points) => {
    for (let i = 0; i < points.length - 1; i++) gridPoints.push(points[i], points[i + 1]);
  };
  const meridians = 8;
  for (let i = 0; i < meridians; i++) {
    const pts = [];
    const yaw = (i / meridians) * Math.PI;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    for (let a = 0; a <= SEG; a++) {
      const t = (a / SEG) * Math.PI * 2;
      const x = radius * Math.sin(t);
      pts.push(new THREE.Vector3(x * cy, radius * Math.cos(t), -x * sy));
    }
    addLoop(pts);
  }

  const parallels = 6;
  for (let j = 1; j < parallels; j++) {
    const phi = (j / parallels) * Math.PI - Math.PI / 2;
    const y = radius * Math.sin(phi);
    const r = radius * Math.cos(phi);
    const pts = [];
    for (let a = 0; a <= SEG; a++) {
      const t = (a / SEG) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t)));
    }
    addLoop(pts);
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), gridMat));

  if (equatorOpacity > 0) {
    const equatorMat = fadeable(
      new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, opacity: equatorOpacity, depthWrite: false })
    );
    const eqPts = [];
    for (let a = 0; a <= SEG; a++) {
      const t = (a / SEG) * Math.PI * 2;
      eqPts.push(new THREE.Vector3(radius * Math.cos(t), 0, radius * Math.sin(t)));
    }
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(eqPts), equatorMat));
  }

  return group;
}

// --------------------------------------------------------------------------
// Shared object treatment: a SOLID stepped-grey fill plus a hairline edge
// outline.
//
// The fill used to be near-invisible (opacity 0.05), which made every model a
// wireframe. Krittin: "fill in color for all the models (similar to the
// satellite model in the home page) (same theme)" — so they are solid now, in
// the same flat greys the hero's cubesats use.
//
// HOW THE HERO DOES IT, AND WHY THIS CANNOT COPY IT DIRECTLY. Over in
// orbit-scene.js buildCubesat() hands its box an ARRAY of six materials, one
// flat palette grey per face, stepping light-to-dark. That is impossible here:
// applyFade() and litMaterials() both read `o.material` expecting a single
// material, and an array has no `.userData` or `.opacity` — applyFade would
// throw on the first frame.
//
// So the same look is reached the other way round, with ONE material and
// per-vertex colours (see shadeByNormal): a face's palette step is baked into
// the geometry from its own normal, and the material just multiplies through.
// That is strictly better here anyway — it works on cylinders and cones, which
// have no "six faces" to enumerate, and it survives mergeGeometries.
// --------------------------------------------------------------------------

// Flat palette steps, lightest to darkest — the same four tones the hero's
// cubesat faces step through. NOT a gradient: the band edges are hard, which
// is the whole instrument-panel look. Each model multiplies these through its
// own TINT (see fillMaterial) rather than replacing them, so the light/dark
// banding survives under colour exactly as it did in plain grey.
const FILL_STEPS = [WARM_GRANITE, GRAPHITE, ASH, CARBON];
// Same four bands' visible alpha, lightest-facing to darkest-facing — not one
// flat value, so a model reads as some facets more solid and some more
// see-through rather than a uniform sheet. Krittin: "make everything not
// fully solid color reduce opacity for all and can use some spots more
// opaque some spots more solid depending on what you think is aesthetic".
// Averages ~0.30, down from the flat 0.46 this replaces.
const FILL_ALPHA_STEPS = [0.5, 0.34, 0.22, 0.14];
// Fixed direction in the model's OWN space that decides which face gets which
// step. Deliberately not a world light: the hero's per-face fills are constants
// that do not track orientation either, and making these track would turn a
// flat illustration into a lit render, which is the thing this style avoids.
// Up-and-slightly-forward, so tops read lightest (and most opaque) and
// undersides darkest (and most transparent).
const FILL_LIGHT = new THREE.Vector3(0.42, 0.82, 0.45).normalize();
// The material's own opacity is a ceiling on top of FILL_ALPHA_STEPS, not a
// second independent dimmer — kept at 1 so the numbers above are the actual
// visible alpha. It still exists for applyFade()'s arrival tween (0 -> 1) and
// registerModel()'s hover swell, both of which scale THIS value.
const FILL_OPACITY = 1;

// One hue per model — Krittin: "fill in colors for all the models choose any
// color that matches the theme". Deliberately NOT --orange or --green: those
// two stay reserved for the outbound/homebound trajectory and the Lunar
// Hopper's arc (see the flight-path note below), so a model can never be
// mistaken for a piece of the path it's flying. Each is muted/desaturated
// rather than a bright primary, in keeping with the flat instrument-panel
// look, and each multiplies THROUGH shadeByNormal's grey bands (see
// fillMaterial) rather than replacing them, so the light/dark faceting
// survives under colour. UNVERIFIED — chosen without being able to see the
// scene rendered; treat as a first pass to react to, not a final answer.
const TERRAGATOR_TINT = 0xd6cdbe; // pale warm ivory — shuttle thermal tile
const COMMUNIGATOR_TINT = 0x9db3c2; // cool ice blue — contrasts TerraGator's warmth
const CMG_TINT = 0xc9b46a; // muted gold — satellite MLI foil
const SATELLITE_TINT_A = 0xb9a56a; // a slightly darker gold
const SATELLITE_TINT_B = 0xd4c589; // a slightly lighter champagne
const CRANE_TINT = 0xa08599; // dusty mauve — Mars regolith, without reading as orange
const ROBOT_TINT = 0x7fa0a3; // slate teal — robotics/electronics

// Writes a `color` attribute onto a geometry, one palette step per vertex,
// chosen by how much that vertex's normal faces FILL_LIGHT. Called on the
// MERGED geometry rather than on each input, so there is no chance of the
// merge failing on a mismatched attribute set. RGBA (itemSize 4) rather than
// RGB: the same band that picks a vertex's grey tone also picks its alpha
// from FILL_ALPHA_STEPS, so opacity varies by facet using the exact banding
// already established for colour instead of a second, unrelated scheme.
function shadeByNormal(geometry) {
  const normals = geometry.getAttribute("normal");
  if (!normals) return geometry;

  const colors = new Float32Array(normals.count * 4);
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i);
    // -1..1 -> 0..1, then quantised into as many hard bands as there are
    // palette steps. floor() rather than a smooth remap, same as the
    // terminators on the two bodies.
    const lit = (n.dot(FILL_LIGHT) + 1) * 0.5;
    const band = clamp(Math.floor((1 - lit) * FILL_STEPS.length), 0, FILL_STEPS.length - 1);
    c.setHex(FILL_STEPS[band]);
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = FILL_ALPHA_STEPS[band];
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  return geometry;
}

// fadeable() is what lets the arrival tween dim everything uniformly: it
// records a material's resting opacity so applyFade() can scale it, without
// each builder having to hand its materials back to the caller.
function fadeable(mat) {
  mat.transparent = true;
  mat.userData.baseOpacity = mat.opacity;
  return mat;
}

// `color` multiplies the vertex palette rather than replacing it, so each
// model's own TINT (see the MODEL_TINT constants below) tints the SAME
// light/dark banding shadeByNormal() already bakes in, instead of painting
// flat per-model colour over it. Defaults to white (no tint) for anything
// that doesn't pass one — Earth/Moon surface pieces still call this bare.
//
// depthWrite is ON now that the fill is solid — without it the model's own far
// side draws through the near side and the thing reads as a glass box. Which
// then needs polygonOffset: the hairline edges sit exactly on these faces, and
// at equal depth they z-fight into a dashed shimmer. Pushing the fill a hair
// further from the camera lets every edge win cleanly.
//
// side: DoubleSide is kept because several parts (the shuttle's wings and fin,
// the open-ended cylinders) are single-sided sheets with no back face of their
// own to hide behind.
function fillMaterial(tint = 0xffffff) {
  return fadeable(
    new THREE.MeshBasicMaterial({
      color: tint,
      vertexColors: true,
      transparent: true,
      opacity: FILL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  );
}
function edgeMaterial() {
  return fadeable(new THREE.LineBasicMaterial({ color: BONE, transparent: true, opacity: 1 }));
}

// Dihedral threshold that drops facet seams but keeps rims and real edges.
// See the note above mergedPart(); 32 is chosen to sit just above the 30
// degrees between adjacent faces of a twelve-sided cylinder.
const EDGE_CLEAN = 32;

// Many geometries -> ONE fill + ONE edges. None of the sub-parts in this scene
// (wings, boosters, legs, solar panels) ever moves independently of its
// parent, so there is nothing lost by baking their transforms into the
// vertices up front, and it is the difference between 2 draw calls per model
// and 2 per piece.
//
// `edgeAngle` is the dihedral threshold above which an edge is drawn, and it
// is the whole difference between a clean model and a scribble. The default
// 1 degree keeps EVERY facet seam: a twelve-sided cylinder contributes twelve
// vertical lines down its body, a sixteen-sided drum sixteen, and a rocket
// built from four such pieces is a bundle of white lines with a shape
// somewhere inside it. That is what Krittin was objecting to.
//
// EDGE_CLEAN is 32, just above the 30-degree dihedral of a twelve-gon, so
// every one of those seams disappears and what survives is the silhouette,
// the rims where two pieces meet, and genuine feature edges. Anything COARSER
// than a twelve-gon keeps its seams, so this is a threshold rather than a
// blanket "silhouette only" — which is exactly what makes the Sky Crane's
// octagonal deck show its eight sides.
function mergedPart(geometries, edgeAngle = 1, tint = 0xffffff) {
  const group = new THREE.Group();
  // shadeByNormal runs on the MERGED result, after every sub-part's transform
  // is baked in, so a leg's normals are scored in the same frame as the deck's.
  group.add(new THREE.Mesh(shadeByNormal(mergeGeometries(geometries, false)), fillMaterial(tint)));
  const edges = geometries.map((g) => new THREE.EdgesGeometry(g, edgeAngle));
  group.add(new THREE.LineSegments(mergeGeometries(edges, false), edgeMaterial()));
  // Both merges copy their inputs, so every source geometry here is dead the
  // moment they return — and there are a lot of them.
  edges.forEach((g) => g.dispose());
  geometries.forEach((g) => g.dispose());
  return group;
}

// Repeats one geometry at N evenly-spaced azimuths, each tilted outward,
// returning the transformed clones for mergedPart() to absorb. `localOffset`,
// if given, is applied before the tilt (sliding a leg or a CMG pyramid
// off-centre).
function radialClones(geometry, { count, azimuthOffset = 45, azimuthSign = -1, tiltDeg, localOffset }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const az = azimuthSign * (i * (360 / count) + azimuthOffset) * DEG;
    let m = new THREE.Matrix4().makeRotationY(az).multiply(new THREE.Matrix4().makeRotationZ(tiltDeg * DEG));
    if (localOffset) {
      m = m.multiply(new THREE.Matrix4().makeTranslation(localOffset.x || 0, localOffset.y || 0, localOffset.z || 0));
    }
    out.push(geometry.clone().applyMatrix4(m));
  }
  return out;
}

// --------------------------------------------------------------------------
// Paths — flat screen-space lines, not 3D geometry.
//
// These were originally short TubeGeometry segments with gaps between them:
// real geometric thickness plus a genuine dash pattern, because a plain
// THREE.Line is capped at 1px in most browsers whatever `linewidth` says.
// Krittin's verdict was blunt — "i dont like the design of the 3d lines...
// make them 2D and prettier" — and he was right. A tube is a solid object, so
// it carries its own silhouette, its own faceting and its own edge wireframe,
// none of which a trajectory should have.
//
// Line2 is the fix. It expands a polyline into camera-facing quads in the
// vertex shader, so the width is in SCREEN pixels and stays constant along the
// whole path however far it recedes — a flat drawn line over a 3D scene, which
// is the register the rest of this site's chrome is in. Dashes come from the
// material rather than from chopping the geometry up, so a path is ONE draw
// call instead of a merged pile of tubes, and it still depth-tests properly so
// the bodies occlude it.
//
// The one thing Line2 needs that an ordinary material does not is
// `resolution`: a pixel width is meaningless without the canvas size. resize()
// walks the scene for `isLineMaterial` and sets it, rather than keeping a
// registry — the flight path is rebuilt whenever the layout preset changes, so
// a registry would need pruning on every rebuild to avoid holding disposed
// materials forever.
// --------------------------------------------------------------------------

function flatLine(
  points,
  { color = BONE, width = 1.6, opacity = 0.62, dashed = true, dashSize = DASH_TRAJ, gapSize = GAP_TRAJ } = {}
) {
  const flat = [];
  points.forEach((p) => flat.push(p.x, p.y, p.z));

  const geometry = new LineGeometry();
  geometry.setPositions(flat);

  const material = new LineMaterial({
    color,
    linewidth: width, // in pixels — see the note on resolution above
    dashed,
    dashSize,
    gapSize,
    transparent: true,
    opacity,
    // Off deliberately: antialias is already on, and alpha-to-coverage makes
    // thin dashes crawl rather than smoothing them.
    alphaToCoverage: false,
  });
  material.userData.baseOpacity = opacity;

  const line = new Line2(geometry, material);
  line.computeLineDistances(); // required, or `dashed` does nothing
  return line;
}

// Sample a curve and hand the points to flatLine().
function flatCurve(curve, samples, opts) {
  return flatLine(curve.getPoints(samples), opts);
}

// --------------------------------------------------------------------------
// Models.
//
// The Sky Crane and the TurtleBot are ported unchanged in design from
// js/moon-scene.js (which took them from scripts/model-renders.html) — keep
// them in sync if that reference build ever changes. The satellite is ported
// from the hero scene. The two launch vehicles are specific real ones at
// Krittin's request (shuttle, SLS).
//
// Every vehicle is built nose-up along local +Y with a total length of ~1, so
// aiming one along a trajectory is a single setFromUnitVectors plus the roll
// park() applies on top.
// --------------------------------------------------------------------------

// (finGeometry/finClones, which scattered flat triangular fins evenly around
// a body, went with the two generic rockets they existed for. Neither the
// shuttle nor SLS has radially repeated fins.)

// ---- the two launch vehicles -------------------------------------------
//
// Both replaced the generic finned rockets they used to be — Krittin: "make
// new models for terra and navigator, use spaceshuttle for terra and use SLS
// for Navigator (make new 3d model same style as other models)". So these are
// real vehicles now rather than two variations on a pencil, built in the same
// merged fill + hairline edge treatment as everything else here.
//
// BOTH HAVE A PREFERRED ROLL, which the old rockets did not. A finned tube
// reads the same from any angle, so park() could leave the roll wherever
// setFromUnitVectors happened to put it. A shuttle seen edge-on is a stick,
// and SLS with its two boosters hidden behind the core is just a tube — so
// park() now rolls each model about its own long axis to face the camera, and
// each is built with its identifying features in the local XY plane (the
// plane that roll points at the viewer). See park(), and TERRAGATOR_ROLL /
// COMMUNIGATOR_ROLL for the offset off exactly-broadside.

// Project TerraGator — the Space Shuttle orbiter. Nose-up along +Y like every
// other model here, so it sits on the outbound climb without special-casing.
//
// The delta planform IS the recognisable thing at this size, so the wings lie
// in the local XY plane and get the camera-facing roll; the vertical fin is
// perpendicular to them, in ZY, and TERRAGATOR_ROLL tips the whole thing off
// broadside so the fin reads as height rather than vanishing edge-on.
function buildTerraGatorShuttle() {
  const R = 0.058;
  const geos = [];

  // Fuselage and nose. The taper is slight — a shuttle's body is close to a
  // constant-section tube with a rounded nose, not a cone.
  const body = new THREE.CylinderGeometry(R, R * 1.06, 0.56, 12, 1, true);
  body.translate(0, -0.04, 0);
  geos.push(body);
  const nose = new THREE.ConeGeometry(R, 0.24, 12);
  nose.translate(0, 0.36, 0);
  geos.push(nose);

  // Delta wings, swept back from mid-fuselage to a clipped tip — a flat
  // ShapeGeometry quadrilateral in the local XY plane, so it has the
  // shuttle's blunt wingtip rather than coming to a point.
  const SPAN = 0.235;
  [-1, 1].forEach((side) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.1); // root, leading edge, well forward on the body
    s.lineTo(side * SPAN, -0.2); // tip, leading edge — the sweep
    s.lineTo(side * SPAN, -0.27); // clipped tip
    s.lineTo(0, -0.3); // root, trailing edge
    s.closePath();
    geos.push(new THREE.ShapeGeometry(s));
  });

  // Vertical fin: the same trick rotated a quarter turn, so it stands in the
  // ZY plane. rotateY(-90) maps local x onto local z, so the shape's x is the
  // fin's height above the fuselage axis.
  const fin = new THREE.Shape();
  fin.moveTo(0, -0.12); // root, forward
  fin.lineTo(0.17, -0.26); // tip, swept back
  fin.lineTo(0.17, -0.31);
  fin.lineTo(0, -0.33); // root, aft
  fin.closePath();
  const finGeo = new THREE.ShapeGeometry(fin);
  finGeo.rotateY(-Math.PI / 2);
  geos.push(finGeo);

  // OMS pods — the two bulges either side of the fin root. Small, but they
  // are what stops the tail end reading as a plain cut-off tube. 12-sided
  // like everything else here: see the note on EDGE_CLEAN — a coarser drum
  // has facet seams above the 32-degree threshold and draws every one of them.
  [-1, 1].forEach((side) => {
    const pod = new THREE.CylinderGeometry(0.022, 0.03, 0.13, 12);
    pod.translate(side * 0.05, -0.26, 0.045);
    geos.push(pod);
  });

  return mergedPart(geos, EDGE_CLEAN, TERRAGATOR_TINT);
}

// Project Navigator — SLS. Core stage with two solid boosters strapped either
// side, an upper stage and Orion stacked on top, and the launch abort tower's
// spike above that. The booster pair sits in the local XY plane so the roll
// keeps both of them visible rather than hiding one behind the core.
function buildCommunigatorSLS() {
  const CORE_R = 0.06;
  const SRB_R = 0.028;
  const geos = [];

  // Core stage.
  const core = new THREE.CylinderGeometry(CORE_R, CORE_R, 0.72, 12, 1, true);
  core.translate(0, -0.06, 0);
  geos.push(core);
  // The intertank band, which is the one feature that breaks the core's
  // length up at this size.
  const band = new THREE.CylinderGeometry(CORE_R * 1.05, CORE_R * 1.05, 0.05, 12, 1, true);
  band.translate(0, -0.02, 0);
  geos.push(band);

  // Upper stage, then Orion, then the abort tower — a stepped taper rather
  // than one cone, which is what makes the top of an SLS read as a stack.
  const upper = new THREE.CylinderGeometry(CORE_R * 0.72, CORE_R * 0.86, 0.14, 12, 1, true);
  upper.translate(0, 0.37, 0);
  geos.push(upper);
  const orion = new THREE.ConeGeometry(CORE_R * 0.72, 0.12, 12);
  orion.translate(0, 0.5, 0);
  geos.push(orion);
  const las = new THREE.CylinderGeometry(0.008, 0.012, 0.16, 12);
  las.translate(0, 0.63, 0);
  geos.push(las);

  // The two SRBs, offset along X so the camera-facing roll shows both.
  // 12-sided throughout — see the note on EDGE_CLEAN: a 10-gon's 36-degree
  // facet seams sit ABOVE the 32-degree threshold and all ten get drawn.
  [-1, 1].forEach((side) => {
    const x = side * (CORE_R + SRB_R + 0.004);
    const srb = new THREE.CylinderGeometry(SRB_R, SRB_R, 0.56, 12, 1, true);
    srb.translate(x, -0.1, 0);
    geos.push(srb);
    const srbNose = new THREE.ConeGeometry(SRB_R, 0.1, 12);
    srbNose.translate(x, 0.23, 0);
    geos.push(srbNose);
    // Booster skirt, flared at the base.
    const skirt = new THREE.CylinderGeometry(SRB_R, SRB_R * 1.3, 0.07, 12, 1, true);
    skirt.translate(x, -0.41, 0);
    geos.push(skirt);
  });

  // Core engines: a cluster at the base, deliberately just four stubs.
  const bell = new THREE.ConeGeometry(0.019, 0.07, 12, 1, true);
  geos.push(
    ...radialClones(bell, { count: 4, tiltDeg: 0, localOffset: { x: 0.026, y: -0.46 } })
  );
  bell.dispose();

  return mergedPart(geos, EDGE_CLEAN, COMMUNIGATOR_TINT);
}

// The Hybrid CMG project's satellite — the SAME satellite the hero scene
// flies, ported from buildCubesat() in js/orbit-scene.js. Krittin: "use the
// satellite model from home page instead of the cubesat model". The 12U CMG
// bus it replaces was a plain box with four internal pyramids, which at this
// size read as a box; the hero satellite's solar wings and antenna say
// "satellite" immediately, and reusing it ties the two scenes together.
//
// THE SHAPE IS PORTED, NOT THE MATERIALS. The hero version carries six solid
// per-face fills on one mesh; here it gets this scene's near-invisible fill
// plus hairline edges, both because that is the house style and because
// applyFade() and litMaterials() read `o.material` expecting ONE material —
// the array a multi-material mesh carries would break both.
//
// The wings lie in the local XY plane, and the satellite's attitude is built
// from an explicit basis (see cmgSat below) rather than setFromUnitVectors,
// so local +Z faces the camera and they are never seen edge-on.
const SAT_BUS = 0.3;
const SAT_PANEL_W = 0.3;
const SAT_PANEL_H = 0.19;
const SAT_PANEL_X = SAT_BUS / 2 + 0.04 + SAT_PANEL_W / 2;
const SAT_MODEL_W = 2 * (SAT_PANEL_X + SAT_PANEL_W / 2);
// Local bottom of the bus to the antenna tip; used to move THEOS-3A down by
// exactly half of its own nominal model height.
const SAT_MODEL_H = SAT_BUS + 0.17;
// Nudge THEOS-3A toward the right-hand project index while preserving its
// vertical relationship to Lunar Hopper.
const THEOS_RIGHT_OFFSET = 0.52;

function buildSatellite(tint = CMG_TINT) {
  const geos = [new THREE.BoxGeometry(SAT_BUS, SAT_BUS, SAT_BUS)];

  // Solar arrays. Thin BOXES rather than the hero's flat planes: a plane's
  // EdgesGeometry is a bare rectangle, which at this size reads as a floating
  // outline instead of a panel with a near side.
  [-1, 1].forEach((side) => {
    const panel = new THREE.BoxGeometry(SAT_PANEL_W, SAT_PANEL_H, 0.012);
    panel.translate(side * SAT_PANEL_X, 0, 0);
    geos.push(panel);
  });

  // The status block on the end of the antenna boom. The boom itself is a
  // plain line below, as it is on the hero.
  const tip = new THREE.BoxGeometry(0.045, 0.045, 0.045);
  tip.translate(0, SAT_BUS / 2 + 0.17, 0);
  geos.push(tip);

  const group = mergedPart(geos, EDGE_CLEAN, tint);

  // Antenna boom + solar cell dividers, as lines. The dividers are two per
  // array — the detail that makes a rectangle read as a solar panel — and
  // they are lines with no surface, so they cannot come out of the merge.
  // Sat slightly proud of the panel face (z) so they never z-fight with it.
  const pts = [
    new THREE.Vector3(0, SAT_BUS / 2, 0),
    new THREE.Vector3(0, SAT_BUS / 2 + 0.15, 0),
  ];
  [-1, 1].forEach((side) => {
    [-1, 1].forEach((k) => {
      const x = side * SAT_PANEL_X + (k * SAT_PANEL_W) / 6;
      pts.push(
        new THREE.Vector3(x, -SAT_PANEL_H / 2, 0.008),
        new THREE.Vector3(x, SAT_PANEL_H / 2, 0.008)
      );
    });
  });
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      // Dimmer than the silhouette edges so they read as surface detail. The
      // hover highlight recolours every LineSegments material it finds, so
      // this ends up chalk on hover like the rest — which is correct.
      fadeable(new THREE.LineBasicMaterial({ color: BONE, transparent: true, opacity: 0.42 }))
    )
  );
  return group;
}

// Sky Crane — an OCTAGONAL deck with four thrusters around its rim. Krittin:
// "change skycrane model to octagon with 4 thrusters on the edge." It was a
// square box on four splayed legs.
//
// Losing the legs is right rather than a shortcut: a real sky crane never
// lands, it hovers on its thrusters and lowers its payload on a bridle, so a
// thruster ring is the more truthful silhouette as well as the requested one.
// It is still placed just clear of the surface by anchorOnSurface's radial
// offset, which now reads as hovering rather than as standing.
//
// EIGHT SIDES IS DELIBERATELY BELOW THE EDGE_CLEAN THRESHOLD. An octagon's
// facet normals differ by 45 degrees, above the 32-degree cutoff, so every one
// of its eight vertical seams is drawn — which is the entire point here, since
// "octagon" has to be legible as an octagon. Do not raise the segment count.
function buildSkyCrane() {
  const DECK_R = 0.19;
  const geos = [new THREE.CylinderGeometry(DECK_R, DECK_R, 0.075, 8)];

  // A slightly narrower collar under the deck, so the underside is not one
  // flat plate and the thrusters look mounted rather than stuck on.
  const collar = new THREE.CylinderGeometry(DECK_R * 0.72, DECK_R * 0.62, 0.045, 8);
  collar.translate(0, -0.055, 0);
  geos.push(collar);

  // Four thrusters at the rim, on alternate octagon faces. Each is a throat
  // plus a bell flaring downward — 12-sided so the bells stay clean against
  // the deck's deliberate eight.
  const throat = new THREE.CylinderGeometry(0.019, 0.019, 0.05, 12);
  geos.push(...radialClones(throat, { count: 4, azimuthSign: 1, tiltDeg: 0, localOffset: { x: DECK_R * 0.86, y: -0.055 } }));
  throat.dispose();
  const bell = new THREE.CylinderGeometry(0.019, 0.045, 0.075, 12, 1, true);
  geos.push(...radialClones(bell, { count: 4, azimuthSign: 1, tiltDeg: 0, localOffset: { x: DECK_R * 0.86, y: -0.118 } }));
  bell.dispose();

  return mergedPart(geos, EDGE_CLEAN, CRANE_TINT);
}

// The CBF TurtleBot: drum base, two wheels, a lidar mast. Ported from
// buildTurtlebot() in scripts/model-renders.html. Forward is local +Z (the
// wheel axle lies along X), which is what anchorOnSurface() aims along the
// trail.
function buildTurtlebot() {
  const geos = [];
  geos.push(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16));

  const wheel = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12);
  const spin = new THREE.Matrix4().makeRotationZ(90 * DEG);
  const left = wheel.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(0.34, -0.05, 0).multiply(spin));
  const right = wheel.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(-0.34, -0.05, 0).multiply(spin));
  geos.push(left, right);
  wheel.dispose();

  const mast = new THREE.BoxGeometry(0.05, 0.42, 0.05);
  mast.translate(0, 0.32, 0);
  geos.push(mast);

  const puck = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16);
  puck.translate(0, 0.56, 0);
  geos.push(puck);

  // Same cleaned-up wireframe as the rockets. What makes it findable against
  // the planet is no longer its material but WHERE it stands: the face-picking
  // search puts it on land, where mid-green is a far better ground for white
  // hairlines than open ocean was.
  return mergedPart(geos, EDGE_CLEAN, ROBOT_TINT);
}

// --------------------------------------------------------------------------
// Surface placement.
// --------------------------------------------------------------------------

// A unit outward normal at (latDeg, lonDeg) — lat 0 the equator, +/-90 the
// poles, in the TILTED body's own frame (so "south pole" means the pole a
// viewer sees, which is the point for the Lunar Hopper).
function surfaceNormal(latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon)
  ).normalize();
}

// Stands a model on the sphere: its local +Y is aimed along the outward
// normal, so it sits on the curved surface rather than floating at a world
// tilt. `radialOffset` lifts it by roughly its own leg/wheel drop so the feet
// meet the surface instead of the deck sinking into it. If `forward` is given
// (a tangent in the same frame) the model is also spun about its own axis so
// its local +Z follows it.
function anchorOnSurface(normal, radius, radialOffset, model, forward) {
  const anchor = new THREE.Object3D();
  anchor.position.copy(normal.clone().multiplyScalar(radius + radialOffset));
  anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  anchor.add(model);
  if (forward) {
    const local = forward.clone().applyQuaternion(anchor.quaternion.clone().invert());
    model.rotation.y = Math.atan2(local.x, local.z);
  }
  return anchor;
}

// The Lunar Hopper: a hop from the south pole to a landing point elsewhere on
// the surface. It follows the great circle between the two (spherical
// interpolation) rather than cutting a chord, and lifts away from the surface
// by `lift` at the midpoint, tapering to exactly the surface at both ends — a
// hop, not a tunnel. There is deliberately no lander model; the trajectory IS
// the project's object.
function hopPath(normalStart, normalEnd, radius, lift = 0.4, segments = 64) {
  const angle = normalStart.angleTo(normalEnd);
  const sinAngle = Math.sin(angle);
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let dir;
    if (sinAngle < 1e-6) {
      dir = normalStart.clone();
    } else {
      const a = Math.sin((1 - t) * angle) / sinAngle;
      const b = Math.sin(t * angle) / sinAngle;
      dir = normalStart.clone().multiplyScalar(a).add(normalEnd.clone().multiplyScalar(b)).normalize();
    }
    points.push(dir.multiplyScalar(radius * (1 + Math.sin(t * Math.PI) * lift)));
  }
  return new THREE.CatmullRomCurve3(points);
}

function disposeGroup(group) {
  const dead = [];
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
    if (o !== group) dead.push(o);
  });
  dead.forEach((o) => o.parent && o.parent.remove(o));
}

// --------------------------------------------------------------------------
// Picking Earth's face — "choose the side of earth that has the most green and
// make robot stay on there".
//
// The continents are procedural noise baked on the GPU, so which longitudes
// are land is not something this file can know by reading itself, and it
// changes the moment anything in EARTH_BAKE_GLSL is touched. Rather than
// hard-coding a guess that would silently rot, the scene ASKS THE BAKE.
//
// A second, tiny copy of the same bake (ANALYSIS_W x ANALYSIS_W/2) is rendered
// and read back once at mount. Then:
//
//   1. Score every candidate yaw by how much green land it turns toward the
//      camera, weighted by projected area, and keep the best.
//   2. With that yaw fixed, find the green texel whose world direction lands
//      closest to where the TurtleBot is wanted on screen, and stand the robot
//      on it.
//
// So the robot is on land BY CONSTRUCTION rather than by a lat/lon that has to
// be re-derived by hand every time the tilt or the noise changes — which is
// exactly what went wrong with the trail's six waypoints twice before.
//
// Cost: one extra 128x64 render and a 32KB readback, once, on a scene that is
// already mounted lazily. The readback is a synchronous GPU stall, which is
// why it is deliberately NOT done against the 1024-wide bake the globe
// actually uses.
//
// Green test: the bake writes ocean blue-dominant (shelf is 46,96,118), land
// green-dominant (lowland 74,107,79 through highland 160,202,146), ice
// near-neutral (217,218,219) and the coast hairline blue-ish (138,173,184).
// "g clearly above b" separates land from all three, and (g - b) then scores
// how green that land is, so highland counts for more than lowland.
// --------------------------------------------------------------------------
const ANALYSIS_W = 128;

function sampleEarthSurface(renderer) {
  const target = new THREE.WebGLRenderTarget(ANALYSIS_W, ANALYSIS_W / 2, {
    depthBuffer: false,
    stencilBuffer: false,
  });
  renderEquirect(renderer, target, EARTH_BAKE_GLSL);

  const w = ANALYSIS_W;
  const h = ANALYSIS_W / 2;
  const px = new Uint8Array(w * h * 4);
  // Binds and restores the framebuffer itself, so this needs no setRenderTarget
  // dance around it.
  renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
  target.dispose();

  // Only green texels are kept — everything else contributes nothing to either
  // question being asked, so there is no reason to carry it.
  const dirs = [];
  const greens = [];
  for (let y = 0; y < h; y++) {
    // readRenderTargetPixels returns rows bottom-up, which is also how v runs.
    const v = (y + 0.5) / h;
    const theta = (1 - v) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = px[i + 1] - px[i + 2]; // green minus blue
      if (g < 10) continue;
      const phi = ((x + 0.5) / w) * Math.PI * 2;
      // Mirrors bakeEquirect's direction reconstruction exactly. Change one
      // and you must change the other.
      dirs.push(new THREE.Vector3(-Math.cos(phi) * sinT, cosT, Math.sin(phi) * sinT));
      // sinT is the equirectangular texel's area weight: rows near the poles
      // cover far less sphere than rows near the equator.
      greens.push(g * sinT);
    }
  }
  return { dirs, greens };
}

// The yaw, in radians, to give earthSpin at rest.
function chooseEarthYaw({ dirs, greens }, tiltX, steps = 96) {
  if (!dirs.length) return 0;
  let best = 0;
  let bestScore = -Infinity;
  const probe = new THREE.Vector3();
  for (let s = 0; s < steps; s++) {
    const yaw = (s / steps) * Math.PI * 2;
    // Instead of rotating every texel by Rx(tilt) * Ry(yaw), rotate the VIEW
    // direction backwards into the body's own frame once per candidate. Same
    // dot products, one rotation instead of thousands.
    probe.copy(DIR).applyAxisAngle(new THREE.Vector3(1, 0, 0), -tiltX).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    let score = 0;
    for (let i = 0; i < dirs.length; i++) {
      const facing = dirs[i].dot(probe);
      if (facing > 0) score += greens[i] * facing;
    }
    if (score > bestScore) {
      bestScore = score;
      best = yaw;
    }
  }
  return best;
}

// The green texel nearest a wanted world direction, expressed back in the
// body's own (pre-yaw, pre-tilt) frame so it can be handed to anchorOnSurface.
function greenestNear({ dirs, greens }, tiltX, yaw, wantWorld) {
  const want = wantWorld
    .clone()
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), -tiltX)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < dirs.length; i++) {
    const near = dirs[i].dot(want);
    if (near <= 0) continue;
    // Mostly "closest to where we asked", with a light preference for the
    // greener texel when two are equally close.
    //
    // The green weight came DOWN from 0.0015 when the robot moved out to the
    // limb. `greens` runs to roughly 80, so at 0.0015 the bonus reached ~0.12
    // against a proximity term that only spans 0..1 — enough for a very green
    // texel up to ~20 degrees away to beat a merely-green one exactly on
    // target. Twenty degrees of surface was tolerable when the robot sat in
    // the middle of the disc and only needed to be ON land; it is not now,
    // when the whole point is that it sits within a few degrees of the limb.
    // At 0.0004 the bonus tops out near 0.03 and can only break ties inside
    // about 11 degrees, so position wins and green is the tie-break it was
    // always meant to be.
    const score = near * near * near + 0.0004 * greens[i];
    if (score > bestScore) {
      bestScore = score;
      best = dirs[i];
    }
  }
  return best ? best.clone() : want.normalize();
}

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// --------------------------------------------------------------------------
export function initSystemScene({ canvas, labelLayer, infoPanel }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);

  const highDensityDesktop =
    window.innerWidth > 900 &&
    (window.devicePixelRatio || 1) > 1.25 &&
    window.matchMedia("(pointer: fine)").matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: highDensityDesktop ? "high-performance" : "default",
  });
  // Capped at 1.6 rather than the usual 2. The canvas is 68% taller than the
  // section it sits in (see the spill note in resize()), so at DPR 2 this
  // would be pushing roughly 6.8M pixels a frame on a 1440-wide laptop, every
  // frame, for a scene whose whole budget argument is "must not cost anything
  // noticeable". 1.6 gives back about a third of that and the difference is
  // not visible on a body made of flat posterised bands.
  // Cap framebuffer area as well as DPR. High-density laptop panels otherwise
  // render several times more pixels than the same laptop's HDMI monitor.
  const maxRenderPixels = highDensityDesktop ? 1600000 : 2400000;
  const pixelRatioFor = (w, h) =>
    Math.max(0.75, Math.min(window.devicePixelRatio || 1, 1.6, Math.sqrt(maxRenderPixels / Math.max(1, w * h))));
  renderer.setPixelRatio(pixelRatioFor(canvas.clientWidth, canvas.clientHeight));

  const bakeWidth = highDensityDesktop ? 512 : BAKE_W;
  const earthTex = bakeEquirect(renderer, bakeWidth, EARTH_BAKE_GLSL);
  const moonTex = bakeEquirect(renderer, bakeWidth, MOON_BAKE_GLSL);

  // ---- Earth -------------------------------------------------------------
  // Three nested groups, each with exactly one job — which is what makes the
  // arrival animation a one-line change rather than a rewrite:
  //
  //   earthGroup  position only, never rotated, so everything hung off it can
  //               be placed in the fixed camera basis.
  //   earthTilt   the axial tilt. Surface lat/lon is measured in HERE, so it
  //               means what a viewer would say it means.
  //   earthSpin   the arrival's rotate-in, AND the resting EARTH_YAW that
  //               turns the greenest face toward the camera. The body, its
  //               graticule and the TurtleBot all live inside it, so turning
  //               it turns the planet WITH everything standing on it — which
  //               is the whole point ("make moon (along with hopper and crane)
  //               rotate in, and earth rotate in"), and it is also what lets
  //               the face be chosen at runtime without moving the robot off
  //               the land it was placed on.
  //
  // The limb ring stays outside the tilt entirely: it is billboarded to the
  // camera and traces the apparent silhouette, so it must not turn with the
  // body. The cloud shell sits in earthTilt but OUTSIDE earthSpin, so its own
  // drift is independent of the arrival.
  const earthGroup = new THREE.Group();
  const earthTilt = new THREE.Group();
  const earthSpin = new THREE.Group();
  earthTilt.rotation.x = EARTH_TILT_X;
  const earth = buildBody(earthTex, EARTH_R, 96, 0.0, 0.16);
  earthSpin.add(earth.mesh, buildGraticule(EARTH_R * 1.004, 0.1, 0)); // 0 = no equator ring
  const clouds = buildClouds(earthTex, EARTH_R);
  earthTilt.add(earthSpin, clouds.mesh);
  earthGroup.add(earthTilt, buildLimbRing(EARTH_R * 1.075));

  // CBF TurtleBot, standing on Earth's greenest visible face.
  //
  // ITS TRAIL IS GONE for good — Krittin: "dont need robot trail anymore" —
  // and with it the six hand-derived lat/lons that used to define it, which
  // were the most fragile numbers in this file: they were solved against a
  // specific EARTH_TILT_X and silently meant something else the moment it
  // changed, twice.
  //
  // What decides where the robot stands now is a search, not a constant.
  // EARTH_YAW turns the greenest hemisphere toward the camera, and the robot
  // is then dropped on the greenest texel near where it is wanted on screen —
  // Krittin: "choose the side of earth that has the most green and make robot
  // stay on there". See sampleEarthSurface() and chooseEarthYaw().
  //
  // WANT is where it is wanted, as a world normal rather than a frame fraction
  // because the search works in directions: the three components are RIGHT /
  // UP / toward-camera, and they are the offset from Earth's centre to that
  // spot, normalised.
  //
  // THE TOWARD-CAMERA COMPONENT IS THE DIAL FOR HOW MUCH ROBOT IS SILHOUETTED,
  // and it came down hard, from 0.471 to 0.18 — Krittin: "move turtle bot to
  // have more of its body poking outside, so we can see the body like what we
  // do with the skycrane on the moon, but the wheels still stay attached to
  // the ground."
  //
  // At 0.471 the surface normal there was ~62 degrees off the view direction,
  // which is well inside the disc: the robot stood facing the camera with its
  // whole body drawn over green and blue, and white hairlines on a green
  // planet is the least legible thing in the scene. At 0.18 the normal is ~80
  // degrees off — nearly at the limb — so the robot stands almost side-on with
  // its wheels on the visible edge and its drum, mast and lidar puck rising
  // past the silhouette into empty space. That is exactly how Sky Crane reads
  // on the Moon, which is what he is pointing at.
  //
  // It cannot go much lower: at 0 the contact point is exactly on the limb and
  // anything past that puts the wheels on the far side, floating. Keep it
  // above ~0.12.
  const surface = sampleEarthSurface(renderer);
  const EARTH_YAW = chooseEarthYaw(surface, EARTH_TILT_X);
  const robotWant = RIGHT.clone().multiplyScalar(0.592).addScaledVector(UP, 0.654).addScaledVector(DIR, 0.18).normalize();
  const robotHome = greenestNear(surface, EARTH_TILT_X, EARTH_YAW, robotWant);
  // It drives in from a little to the west, which is the last thing left of
  // "the robot move from left side along the trail to the current position".
  const robotFrom = robotHome.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -20 * DEG);

  const robot = buildTurtlebot();
  robot.scale.setScalar(ROBOT_SCALE);
  const robotAnchor = new THREE.Object3D();
  robotAnchor.add(robot);
  earthSpin.add(robotAnchor);

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  // How far the robot's lowest point (the underside of a wheel: y -0.05 with a
  // radius of 0.09) sits below its own origin, in MODEL units. Multiplied by
  // the scale rather than hard-coded as a world offset, so changing
  // ROBOT_SCALE cannot sink its wheels into the planet.
  const ROBOT_DROP = 0.14;
  function placeRobot(u) {
    // Slerp along the surface rather than through it: normalising the lerp of
    // two unit vectors keeps the robot on the sphere the whole way in.
    tmpA.copy(robotFrom).lerp(robotHome, clamp(u, 0, 1)).normalize();
    robotAnchor.position.copy(tmpA).multiplyScalar(EARTH_R + ROBOT_DROP * ROBOT_SCALE);
    robotAnchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpA);
    // Heading: along the direction of travel, flattened into the local surface
    // plane and expressed in the anchor's frame, so the robot faces the way it
    // drove in rather than at a fixed compass bearing.
    tmpB.copy(robotHome).sub(robotFrom);
    if (tmpB.lengthSq() < 1e-9) tmpB.set(0, 0, 1);
    const local = tmpB.normalize().applyQuaternion(robotAnchor.quaternion.clone().invert());
    robot.rotation.y = Math.atan2(local.x, local.z);
  }

  // The Hybrid CMG satellite. It has no orbit line and no orbital angle — it
  // is a plain frame position (`cmg` in LAYOUTS), now the exact midpoint of
  // the two bodies.
  const cmgSat = buildSatellite();
  cmgSat.scale.setScalar(CMG_SCALE);
  // Attitude, built from an EXPLICIT BASIS rather than setFromUnitVectors,
  // which returns the minimal rotation and so pins one axis while leaving the
  // roll about it arbitrary. The solar wings lie in the local XY plane and
  // would be an invisible edge-on line at an unlucky roll.
  //
  // REORIENTED at Krittin's request. The first version aimed local +Z exactly
  // at the camera, which put the wings perfectly flat to the screen — legible,
  // but dead: a flat rectangle pinned to the frame, with no read on which way
  // the bus is facing. The version below keeps the same construction and then
  // tips it into a three-quarter view.
  //
  //   xa  the wing axis, laid across the screen and raised SAT_PITCH so it
  //       reads as flying past rather than sitting square to the world
  //   za  as near the camera as xa allows (Gram-Schmidt against it), then
  //       rolled SAT_ROLL about the wing axis so the panels turn edge-wards
  //       and the bus shows a corner instead of a face
  //   ya  completes the right-handed set
  //
  // SAT_ROLL is the dial: 0 is the old flat-on look, 90 would hide the wings
  // completely. Around 34 shows both panel faces foreshortened while keeping
  // the full wingspan readable.
  const SAT_PITCH = 26 * DEG;
  const SAT_ROLL = 34 * DEG;
  {
    const xa = RIGHT.clone()
      .multiplyScalar(Math.cos(SAT_PITCH))
      .addScaledVector(UP, Math.sin(SAT_PITCH))
      .normalize();
    // DIR points from the scene toward the camera.
    const zFlat = DIR.clone().addScaledVector(xa, -DIR.dot(xa)).normalize();
    const yFlat = new THREE.Vector3().crossVectors(zFlat, xa).normalize();
    // Roll about the wing axis: rotate the other two basis vectors in their
    // own plane, which leaves xa (and so the wingspan) exactly where it was.
    const za = zFlat.clone().multiplyScalar(Math.cos(SAT_ROLL)).addScaledVector(yFlat, Math.sin(SAT_ROLL)).normalize();
    const ya = new THREE.Vector3().crossVectors(za, xa).normalize();
    cmgSat.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xa, ya, za));
  }
  // Two smaller satellites fill the open sky created by moving the Moon up
  // and right. They are decorative scene elements, so they do not add project
  // labels, hover targets, or navigation entries.
  const decorativeSatA = buildSatellite(SATELLITE_TINT_A);
  decorativeSatA.scale.setScalar(DECORATIVE_SAT_SCALE_A);
  decorativeSatA.quaternion.copy(cmgSat.quaternion);
  decorativeSatA.rotateZ(-18 * DEG);

  const decorativeSatB = buildSatellite(SATELLITE_TINT_B);
  decorativeSatB.scale.setScalar(DECORATIVE_SAT_SCALE_B);
  decorativeSatB.quaternion.copy(cmgSat.quaternion);
  decorativeSatB.rotateZ(24 * DEG);

  // All three are frame-positioned rather than parented to a body.
  scene.add(cmgSat, decorativeSatA, decorativeSatB);

  // ---- Moon --------------------------------------------------------------
  // Same three-group structure as Earth. Sky Crane and the Lunar Hopper arc
  // both go inside moonSpin, so the Moon arrives carrying them.
  const moonGroup = new THREE.Group();
  const moonTilt = new THREE.Group();
  const moonSpin = new THREE.Group();
  moonTilt.rotation.x = MOON_TILT_X;
  const moon = buildBody(moonTex, MOON_R, 72, 0.55, 0.14);
  moonSpin.add(moon.mesh, buildGraticule(MOON_R * 1.004, 0.1, 0)); // 0 = no equator ring
  moonTilt.add(moonSpin);
  moonGroup.add(moonTilt, buildLimbRing(MOON_R * 1.075));

  // Sky Crane, landed. Was at lat 20.4, lon 42.6 (~83%, 20% of the wide frame,
  // the Moon's upper right) — close to where the flight path's wrap enters the
  // Moon near its top. Krittin: "the trajectory ... should not block the
  // skycrane model." Dropped in latitude and pushed further round in
  // longitude, off the entry point and further round the near side, while
  // keeping the surface normal well short of the limb. UNVERIFIED — recheck
  // against WRAP_R_MOON's new radius above and nudge further if the path
  // still crosses it.
  const crane = buildSkyCrane();
  crane.scale.setScalar(CRANE_SCALE);
  const craneAnchor = anchorOnSurface(surfaceNormal(6, 58), MOON_R, 0.13, crane);
  moonSpin.add(craneAnchor);

  // Lunar Hopper: south pole -> a point on the near lower-left. The moon's
  // -35 degree tilt is what brings the pole onto the visible side (see
  // MOON_TILT_X); without it this arc would start behind the limb.
  const hopCurve = hopPath(new THREE.Vector3(0, -1, 0), surfaceNormal(-30, -55), MOON_R, 0.4);
  // Green and thick, per Krittin. Green is normally reserved for functional
  // accents on this site, and that is exactly what this is: the one project in
  // the scene with no model at all, where the line IS the object — so it gets
  // to be the most emphatic path here rather than the quietest.
  //
  // Explicitly kept through the round that removed every other path — Krittin:
  // "Keep the trajectory of lunar hopper ofc" — and it is still the widest and
  // most saturated line in the scene, which is the point: the flight path is a
  // thin 1.3px hairline, so nothing competes with this one.
  //
  // Thicker again on request ("make lunar hopper line thicker"), 3.4 -> 5.0.
  // The gap over the flight path matters more than the absolute value now that
  // the flight path has been dimmed to half-bright orange: this is the loudest
  // line in the scene and should stay that way.
  const HOP_WIDTH = 5;
  const HOP_OPACITY = 0.95;
  const hopLine = flatCurve(hopCurve, 120, {
    color: GREEN,
    width: HOP_WIDTH,
    opacity: HOP_OPACITY,
    dashSize: DASH_TRAJ,
    gapSize: GAP_TRAJ,
  });
  moonSpin.add(hopLine);
  // A plain marker at the arc's apex. The Lunar Hopper has no model, so this
  // is what its floating label tracks — a real object in the scene graph,
  // which means it rides the Moon's rotate-in like everything else rather than
  // needing its own special case.
  const hopMarker = new THREE.Object3D();
  hopMarker.position.copy(hopCurve.getPointAt(0.5));
  moonSpin.add(hopMarker);

  // ---- launch vehicles and the flight path --------------------------------
  // Both are persistent (the labels hold references to them); only the path is
  // rebuilt when the layout preset changes.
  //
  // Named ...Rocket rather than plainly: `navigator` alone would shadow
  // window.navigator for the whole of this function.
  const terragatorRocket = buildTerraGatorShuttle();
  terragatorRocket.scale.setScalar(TERRAGATOR_SCALE);
  const communigatorRocket = buildCommunigatorSLS();
  communigatorRocket.scale.setScalar(COMMUNIGATOR_SCALE);
  const flightPath = new THREE.Group();

  scene.add(earthGroup, moonGroup, flightPath, terragatorRocket, communigatorRocket);

  // ---- hover -------------------------------------------------------------
  //
  // There are NO text labels in this scene at the moment — Krittin: "remove
  // all the text for now only leave the index". The .proj-index list in the
  // corner is the readable, always-clickable route to every project; what the
  // scene itself offers instead is the hero's own gesture, which he asked for
  // by name: "when hover over each model it pops bigger and highlights like
  // saatellites in home page". So each object raycasts, scales up and lights
  // when the pointer is over it, and navigates on click.
  //
  // Text labels came back a round later, but as PLAIN TEXT beside each object
  // — no chip, no border, no leader line ("[no box just text]"). They and the
  // side index are both hover sources for the same highlight; see PROJECTS.
  //
  // Each entry owns an `apply(k)` closure instead of a shared shape, because
  // the eight objects do not light the same way: seven are solid models with
  // fill + edge materials, and the Lunar Hopper is a line with no model at all
  // and has to thicken instead.
  const hoverables = [];

  function litMaterials(root) {
    const fills = [];
    const edges = [];
    root.traverse((o) => {
      if (!o.material) return;
      if (o.isLineSegments) edges.push(o.material);
      else if (o.isMesh) fills.push(o.material);
    });
    return { fills, edges };
  }

  // A solid model: swells, its near-invisible fill comes up to a real value,
  // and its hairlines go from --bone to --chalk. Black-and-white, no glow —
  // the same "lights up" the Experience rows use.
  function registerModel(root, target, href, baseScale) {
    const { fills, edges } = litMaterials(root);
    const cool = new THREE.Color(BONE);
    const warm = new THREE.Color(0xfafafa); // --chalk
    hoverables.push({
      target,
      href,
      k: 0,
      want: 0,
      apply(k) {
        root.scale.setScalar(baseScale * (1 + 0.34 * k));
        // CLAMPED. The 5x was sized for the old near-invisible 0.05 fill,
        // where it was the whole highlight; against the solid 0.92 fill the
        // models carry now it would run far past 1 and do nothing but waste
        // the swell and the edge brighten below, which are what read at this
        // size anyway.
        fills.forEach((m) => {
          m.opacity = Math.min(1, m.userData.baseOpacity * (1 + 5 * k)) * fade;
        });
        edges.forEach((m) => m.color.copy(cool).lerp(warm, k));
      },
    });
  }

  // The Lunar Hopper has no model, so its line is the thing that lights.
  function registerLine(line, href, baseWidth, baseOpacity) {
    hoverables.push({
      target: line,
      href,
      k: 0,
      want: 0,
      apply(k) {
        line.material.linewidth = baseWidth * (1 + 0.55 * k);
        line.material.opacity = baseOpacity * (1 + 0.11 * k) * fade;
      },
    });
  }

  // ---- the eight projects -------------------------------------------------
  //
  // Each row ties together the three things that represent one project: the 3D
  // object, its floating text label, and its line in the .proj-index list.
  // Hovering ANY of the three lights all three — Krittin asked for the index
  // to drive the models ("once you hover on each (the model lights up as
  // well)"), and the reverse falls out of the same wiring for free.
  //
  // Labels are plain text, no chip and no leader: "add text back to each
  // figure (can be left right top or bottom) [no box just text]". `align`
  // says which side of the object the text sits on, and is what lets a label
  // beside an object start at its edge rather than be centred on a point half
  // of it away.
  //
  //   dx, dy  offset from the object, as fractions of the scale unit
  //   align   "center" (above/below), "left" (text to the RIGHT of the object,
  //           left-aligned), "right" (text to the LEFT, right-aligned)
  //   avoidEarth/avoidMoon  whether render() is allowed to push this label off
  //     that body's disc if dx/dy alone would leave it sitting on top of it —
  //     see clearBody() below. Off for whichever body an object actually
  //     stands ON (the robot on Earth; the crane and the hopper's marker on
  //     the Moon), since pushing those clear would fling the label off the
  //     planet it is meant to be next to. Krittin: "dont overlap it with
  //     anything (not the model not the earth nit the moon) if they overlap
  //     move them more to the side." UNVERIFIED — dx/dy are still a guess and
  //     this only guards against the two bodies, not the models themselves.
  // Three labels are NUDGED RIGHT by a prefix of their own text, which is how
  // Krittin specifies these: navigator "by distance as far as 'nav'",
  // terragator "as far as 'terra'", the CBF one by "no". All three are
  // centre-aligned, so shifting by N characters slides the text right by that
  // much while it stays centred on the new point.
  //
  // dx is in units of `unit` (see render()), so these are derived rather than
  // eyeballed: JetBrains Mono advances 0.6em, the labels are 16px, so one
  // character is 9.6px, and `unit` is ~740 on the reference 1440x740 canvas.
  //   "no"    2 chars -> 19.2px -> 0.026
  //   "nav"   3 chars -> 28.8px -> 0.039
  //   "terra" 5 chars -> 48.0px -> 0.065
  // They therefore scale with the canvas rather than being fixed pixels,
  // which is the same reason every other offset here is a fraction.
  // `desc`/`img` feed the hover preview panel (.proj-info) — see
  // updateInfoPanel() below. None of the eight have a real SUMMARY yet (a
  // sentence written for this card specifically would be fabricating one —
  // CLAUDE.md: never fabricate a project description), so `desc` is each
  // project's own real title/subtitle instead, already written and real
  // wherever the detail page has one (`.detail-sub`) — Krittin: "just put
  // the title from each page for the description then put click for more
  // information" (see .proj-info-link's text in index.html for the second
  // half of that). `img` is null, which updateInfoPanel reads as "hide the
  // media box" until a real one exists.
  const PROJECTS = [
    // Below the shuttle, which parks mid-way along the reshaped outbound leg
    // (see OUTBOUND_CONTROL / TERRAGATOR_T), in the gap between the
    // .proj-index list and where it used to sit. UNVERIFIED.
    { text: "terragator", href: "projects/rocket-airbrake.html", dx: 0.065, dy: 0.055, align: "center", avoidEarth: true, avoidMoon: true, desc: "Apogee Control System for Project TerraGator", img: null },
    // Below SLS on the way home, on open sky — Earth's disc never reaches
    // this far right.
    { text: "communigator", href: "projects/rocket-software.html", dx: 0.055, dy: 0.105, align: "center", avoidEarth: true, avoidMoon: true, desc: "Drop It Like It’s Hot (Payload) for Project Communigator", img: null },
    // To the RIGHT of the satellite and level with it. Now that it sits
    // between the two legs rather than by the index, check this still clears
    // the outbound leg above and the homebound leg below — UNVERIFIED. Note
    // the satellite is WIDER than the box it replaced (solar wings), so this
    // offset may need pushing further right.
    { text: "cmg desaturation", href: "projects/thesis.html", dx: 0.075, dy: 0.015, align: "left", avoidEarth: true, avoidMoon: true, desc: "Hybrid Control Moment Gyroscope Angular Momentum Desaturation Using Magnetorquers for CubeSats in Low Earth Orbit (honors thesis)", img: null },
    // ABOVE the robot. avoidEarth stays off even though the robot now stands
    // at the limb rather than deep in the disc: its contact point is right on
    // the silhouette edge, so clearBody would be making a push decision on a
    // knife edge, and the label is already over open space anyway.
    { text: "nonholonomic cbf", href: "projects/ros-research.html", dx: 0.026, dy: -0.12, align: "center", avoidEarth: false, avoidMoon: true, desc: "Control Barrier Functions for Nonholonomic Robots Way Point Control Near Safe Set Barriers (University Scholars Program)", img: null },
    // Above the crane. Its home moved (see craneAnchor above) — recheck this
    // still clears the flight path's wrap. UNVERIFIED. avoidMoon off for the
    // same reason avoidEarth is off above.
    // No .detail-sub on this page yet, so "sky crane" is the only real text
    // there is — duplicates the panel's own bold title, but that still beats
    // a bracket placeholder. Swap in a real one the moment the page has it.
    { text: "sky crane", href: "projects/controls-final-project.html", dx: 0, dy: -0.1, align: "center", avoidEarth: true, avoidMoon: false, desc: "Sky Crane", img: null },
    // Below the hop's apex, which already sits past the Moon's lower limb.
    // Same situation as Sky Crane — no real subtitle exists yet.
    { text: "lunar hopper", href: "projects/senior-design-project.html", dx: 0, dy: 0.055, align: "center", avoidEarth: true, avoidMoon: false, desc: "Lunar Hopper", img: null },
    // The darker added satellite, midway between CBF and TerraGator.
    { text: "bdot detumbling", href: "projects/bdot-detumbling.html", dx: 0, dy: -0.065, align: "center", avoidEarth: true, avoidMoon: true, desc: "B-Dot Control Detumbling", img: null },
    // The lighter added satellite, below Lunar Hopper.
    { text: "theos3a", href: "projects/theos3a.html", dx: 0, dy: 0.12, align: "center", avoidEarth: true, avoidMoon: false, desc: "THEOS-3A Structural Analysis", img: null },
  ];

  // The baseScale here MUST match what each model was actually built at above
  // — registerModel's hover swell is `baseScale * (1 + 0.34k)`, so a stale
  // value silently resizes the model the first time it is hovered.
  registerModel(terragatorRocket, terragatorRocket, PROJECTS[0].href, TERRAGATOR_SCALE);
  registerModel(communigatorRocket, communigatorRocket, PROJECTS[1].href, COMMUNIGATOR_SCALE);
  registerModel(cmgSat, cmgSat, PROJECTS[2].href, CMG_SCALE);
  registerModel(robot, robot, PROJECTS[3].href, ROBOT_SCALE);
  registerModel(crane, crane, PROJECTS[4].href, CRANE_SCALE);
  registerLine(hopLine, PROJECTS[5].href, HOP_WIDTH, HOP_OPACITY);
  registerModel(decorativeSatA, decorativeSatA, PROJECTS[6].href, DECORATIVE_SAT_SCALE_A);
  registerModel(decorativeSatB, decorativeSatB, PROJECTS[7].href, DECORATIVE_SAT_SCALE_B);

  // The object each label tracks, in the same order as PROJECTS. The two
  // surface-mounted ones track their ANCHOR rather than the model itself, so
  // the label does not creep when the model scales up under hover.
  const LABEL_ANCHORS = [terragatorRocket, communigatorRocket, cmgSat, robotAnchor, craneAnchor, hopMarker, decorativeSatA, decorativeSatB];

  PROJECTS.forEach((p, i) => {
    p.hoverable = hoverables[i];
    p.object = LABEL_ANCHORS[i];

    if (labelLayer) {
      const el = document.createElement("a");
      el.className = "proj-label";
      el.href = p.href;
      el.textContent = p.text;
      labelLayer.appendChild(el);
      p.el = el;
    }
    // The matching row in the side index, found by href so the markup and this
    // file cannot drift apart silently.
    p.indexEl = document.querySelector(`.proj-index a[href$="${p.href.split("/").pop()}"]`);

    [p.el, p.indexEl].forEach((el) => {
      if (!el) return;
      el.addEventListener("pointerenter", () => setDomHover(p));
      el.addEventListener("pointerleave", () => setDomHover(null));
    });
  });

  // ---- hover preview panel (.proj-info) -----------------------------------
  //
  // Replaces straight-to-page navigation with a preview: whichever of the
  // three hover sources above lights a project also opens this panel right
  // beside the model itself — Krittin: "it doesnt matter if it blocks other
  // object just put it next to the model instead of far away from them"
  // (this replaced an earlier version that docked to a canvas EDGE instead,
  // which read as unrelated to whatever was hovered). Overlapping Earth, the
  // Moon or another model is fine now; the only thing it still avoids is the
  // model it's actually describing. The model/label/index click still
  // navigates straight through on a device with real hover — see
  // applyHoverState() and the click handler below for the touch case, which
  // has none.
  const infoMedia = infoPanel ? infoPanel.querySelector(".proj-info-media") : null;
  const infoImg = infoPanel ? infoPanel.querySelector(".proj-info-img") : null;
  const infoTitle = infoPanel ? infoPanel.querySelector(".proj-info-title") : null;
  const infoDesc = infoPanel ? infoPanel.querySelector(".proj-info-desc") : null;
  const infoLink = infoPanel ? infoPanel.querySelector(".proj-info-link") : null;
  const infoPos = new THREE.Vector3();
  // Clearance between the model's own screen point and the panel's near
  // edge — enough that the panel reads as "next to" rather than "touching".
  const INFO_GAP = 28;
  // Below this, .proj-info becomes a fixed full-width bottom sheet (see the
  // media query in style.css) — inline left/right/top from JS would win over
  // that (inline always beats a stylesheet rule) and break it, so the
  // per-model positioning below is skipped entirely at this width.
  const INFO_MOBILE_MQ = window.matchMedia("(max-width: 900px)");

  function updateInfoPanel() {
    if (!infoPanel) return;
    const p = hovered ? PROJECTS.find((proj) => proj.hoverable === hovered) : null;
    if (!p) {
      infoPanel.classList.remove("is-open");
      return;
    }
    if (infoTitle) infoTitle.textContent = p.text;
    if (infoDesc) infoDesc.textContent = p.desc || "";
    if (infoLink) infoLink.href = p.href;
    if (infoImg) {
      if (p.img) {
        infoImg.src = p.img;
        infoImg.alt = p.text;
      } else {
        infoImg.removeAttribute("src");
        infoImg.alt = "";
      }
    }
    if (infoMedia) infoMedia.style.display = p.img ? "" : "none";

    // Anchored to the model's own on-screen position (same projection the
    // labels use), not a canvas edge — see the note above. Which half of the
    // canvas it's on still decides which SIDE the panel opens on, so it has
    // somewhere to grow into and tends to stay on-screen, but the distance is
    // measured from the model itself (INFO_GAP), not a fixed 24px inset.
    // Static per hover rather than per frame — nothing in this scene moves
    // once the arrival has settled, so there is no need to re-run this every
    // tick.
    const px = projectPx(p.object.getWorldPosition(infoPos));
    const onLeft = px.x < viewW / 2;
    if (INFO_MOBILE_MQ.matches) {
      // Mobile's bottom-sheet CSS owns left/right/top entirely at this width
      // — clearing any stale inline values lets it, rather than fighting it.
      infoPanel.style.left = infoPanel.style.right = infoPanel.style.top = "";
    } else {
      if (onLeft) {
        infoPanel.style.left = `${clamp(px.x + INFO_GAP, EDGE_PAD, viewW - EDGE_PAD)}px`;
        infoPanel.style.right = "auto";
      } else {
        infoPanel.style.right = `${clamp(viewW - px.x + INFO_GAP, EDGE_PAD, viewW - EDGE_PAD)}px`;
        infoPanel.style.left = "auto";
      }
      infoPanel.style.top = `${clamp(px.y, EDGE_PAD, (viewDesignH || viewH) - EDGE_PAD)}px`;
    }
    infoPanel.classList.remove("dock-left", "dock-right");
    infoPanel.classList.add(onLeft ? "dock-right" : "dock-left");
    infoPanel.classList.add("is-open");
  }

  const raycaster = new THREE.Raycaster();
  // Line2 measures its own hit width from material.linewidth; the threshold is
  // extra slack in pixels on top, which a 3.4px line badly needs to be
  // pointable at all.
  raycaster.params.Line2 = { threshold: 12 };
  // The ordinary Line threshold is in WORLD units and defaults to 1 — which in
  // a scene about four units across would turn every model's hairline edges
  // into an enormous invisible hit box. The fill meshes catch nearly every
  // real hit anyway, so this only has to be small enough not to lie.
  raycaster.params.Line.threshold = 0.02;
  const pointer = new THREE.Vector2();
  let pointerInside = false;
  let pointerMoved = false;
  let hovered = null;

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    pointerInside = true;
    pointerMoved = true;
  });
  canvas.addEventListener("pointerleave", () => {
    pointerInside = false;
    pointerMoved = true;
  });

  // Touch has no hover, so a tap alone can't distinguish "show me what this
  // is" from "take me there" the way a mouse hover + click does. `touchOpened`
  // is the one hoverable a touch tap has already revealed; a second tap on
  // the SAME one navigates, same as the desktop AskUserQuestion answer this
  // came from ("first tap reveals panel, second tap enters"). Labels and the
  // corner index are real <a> tags and are NOT gated by this — tapping one of
  // those still goes straight through, exactly as before, so the panel is a
  // preview layered on top of the model itself, never the only way in.
  let lastPointerType = "mouse";
  let touchOpened = null;
  canvas.addEventListener("pointerdown", (e) => {
    lastPointerType = e.pointerType;
    if (e.pointerType !== "touch") return;
    // Feeds the SAME raycast pointermove drives, because a plain tap on iOS
    // Safari does not reliably fire pointermove first — without this the
    // raycast would still be looking at wherever the last drag or hover left
    // it, one frame too late for updateHover() to catch before click fires.
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    pointerInside = true;
    pointerMoved = true;
  });
  canvas.addEventListener("click", () => {
    if (lastPointerType === "touch") {
      // updateHover() only runs off the render loop's own rAF cadence, which
      // a fast tap's pointerdown -> pointerup -> click can outrun; force one
      // synchronous pass so `hovered` reflects THIS tap before deciding.
      updateHover();
      if (!hovered) {
        touchOpened = null;
        return;
      }
      if (touchOpened !== hovered) {
        touchOpened = hovered;
        return;
      }
    }
    if (hovered) window.location.href = hovered.href;
  });
  // Tapping anywhere else — elsewhere on the page, not the canvas or the
  // panel's own link — closes a panel a touch tap opened, so it doesn't sit
  // there open over a model the pointer has moved on from.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (touchOpened === null) return;
      if (canvas.contains(e.target) || (infoPanel && infoPanel.contains(e.target))) return;
      touchOpened = null;
      rayHover = null;
      domHover = null;
      applyHoverState();
    },
    { passive: true }
  );

  // Hover has THREE sources — the 3D object, its floating label, and its line
  // in the side index — and any of them lights all three. They are tracked
  // separately and resolved in one place, because a DOM hover has to win: the
  // pointer being over a label means it is, by definition, not over the model,
  // and letting the raycast clear the highlight would make the label
  // un-hoverable.
  let rayHover = null;
  let domHover = null;

  function setDomHover(project) {
    if (domHover === project) return;
    domHover = project;
    applyHoverState();
  }

  function applyHoverState() {
    const next = domHover ? domHover.hoverable : rayHover;
    if (next === hovered) return;
    hovered = next;
    hoverables.forEach((h) => {
      h.want = h === hovered ? 1 : 0;
    });
    // The label and the index row light with their object. .is-hot is the same
    // class the hero's cubesat labels use for exactly this.
    PROJECTS.forEach((p) => {
      const on = p.hoverable === hovered;
      if (p.el) p.el.classList.toggle("is-hot", on);
      if (p.indexEl) p.indexEl.classList.toggle("is-hot", on);
    });
    canvas.style.cursor = rayHover ? "pointer" : "";
    updateInfoPanel();
  }

  // Only re-raycast when the pointer has actually moved. The render loop runs
  // continuously for the clouds, and raycasting eight project objects on every one
  // of those frames would be pure waste for a result that cannot have changed.
  function updateHover() {
    if (!pointerMoved) return;
    pointerMoved = false;

    let hit = null;
    if (pointerInside) {
      raycaster.setFromCamera(pointer, camera);
      let nearest = Infinity;
      hoverables.forEach((h) => {
        const hits = raycaster.intersectObject(h.target, true);
        if (hits.length && hits[0].distance < nearest) {
          nearest = hits[0].distance;
          hit = h;
        }
      });
    }
    if (hit === rayHover) return;
    rayHover = hit;
    applyHoverState();
  }

  // Eased toward the target each frame. Returns true while anything is still
  // moving, which is what lets the loop drop back to its throttled rate once
  // everything has settled.
  function updateHoverEasing() {
    let busy = false;
    hoverables.forEach((h) => {
      const d = h.want - h.k;
      if (Math.abs(d) > 0.002) {
        h.k += d * 0.18;
        busy = true;
      } else if (h.k !== h.want) {
        h.k = h.want;
      }
      h.apply(h.k);
    });
    return busy;
  }

  // ---- layout ------------------------------------------------------------
  const HALF_FOV = Math.tan((CAM_FOV * DEG) / 2);
  // The pane the canvas sits in. Its --scene-spill custom property is how CSS
  // tells this file how much taller the canvas is than the section — see the
  // spill note in resize(). Read per resize rather than cached, because the
  // value differs between the desktop and stacked layouts.
  const scenePane = canvas.parentElement || canvas;

  let layout = null;
  let viewW = 0;
  let viewH = 0;
  // The section-visible height, which is what labels are kept inside — the
  // rest of the canvas is behind the next section.
  let viewDesignH = 0;
  let viewBottomNdcY = -1;
  let fade = REDUCED ? 1 : 0;
  // Rebuilt by buildFlight() whenever the layout preset changes; the arrival
  // reads them to fly the rockets in along their own legs.
  let outbound = null;
  let homebound = null;
  // The cubesat's resting world position, resolved from the active preset's
  // `cmg` frame fraction by applyLayout. It has no orbit to sit on any more.
  const cmgHome = new THREE.Vector3();
  const cbfModelWorld = new THREE.Vector3();
  const terragatorNdc = new THREE.Vector3();
  const hopperWorld = new THREE.Vector3();

  // Earth and Moon's on-screen circle (centre + pixel radius, at the limb
  // ring's radius), resolved once per resize — the camera never moves, so
  // this is static between layout changes. Used by render() to keep labels
  // off the bodies; see LABEL_BODY_MARGIN below.
  let earthScreen = null;
  let moonScreen = null;
  const projTmp = new THREE.Vector3();
  function projectPx(worldPos) {
    projTmp.copy(worldPos).project(camera);
    return { x: (projTmp.x * 0.5 + 0.5) * viewW, y: (-(projTmp.y * 0.5) + 0.5) * viewH };
  }
  function bodyScreenCircle(centre, radius) {
    const c = projectPx(centre);
    const edge = projectPx(centre.clone().addScaledVector(RIGHT, radius));
    return { x: c.x, y: c.y, r: Math.hypot(edge.x - c.x, edge.y - c.y) };
  }

  function layoutFor(aspect) {
    return LAYOUTS.find((l) => aspect >= l.min) || LAYOUTS[LAYOUTS.length - 1];
  }

  // Exactly one fifth of the Moon's diameter, expressed as a frame fraction.
  // Applying the same shift to the free-floating satellites keeps the group
  // moving together while the Moon-mounted models follow through parenting.
  function moonRightShift(L) {
    return ((MOON_R * 2) / L.fw) / 5;
  }

  // Frame fraction -> world position, at the depth of the Earth/Moon plane
  // (which is centred on the world origin, so the camera can simply sit at
  // DIR * distance and look at nothing in particular).
  //
  // `c` moves a point toward the camera. The k factor is the perspective
  // correction for that: a point c units nearer projects (d0-c)/d0 further
  // from the optical axis, so the world offset has to shrink by the same
  // ratio for the point to land on the frame fraction asked for. d0 is the
  // preset's OWN design distance rather than the live one, so the correction
  // is exact at the design aspect and off by a hair either side — invisible,
  // and worth it for not having to rebuild every arc on every resize.
  function framePos(L, fx, fy, c = 0) {
    const d0 = L.fh / (2 * HALF_FOV);
    const k = (d0 - c) / d0;
    return RIGHT.clone()
      .multiplyScalar((fx - 0.5) * L.fw * k)
      .addScaledVector(UP, (0.5 - fy) * L.fh * k)
      .addScaledVector(DIR, c);
  }

  // ---- the flight path ---------------------------------------------------
  //
  // Outbound leg, Moon wrap, homebound leg — one continuous open line,
  // rebuilt whenever the bodies move (only on a preset change). See the long
  // note above WRAP_R_MOON for the Earth-wrap-removed/Moon-wrap-restored
  // history.

  // A wrap is a circle around `centre`, in the plane spanned by the camera's
  // RIGHT and by `B` — the view direction tilted toward the camera's up. The
  // tangent at +/-90 degrees is exactly +/-RIGHT, which is what lets a leg
  // join it without lurching.
  function wrapBasis(tilt) {
    return DIR.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(UP, Math.sin(tilt));
  }
  function wrapPoint(centre, radius, B, angle) {
    return centre
      .clone()
      .addScaledVector(RIGHT, radius * Math.cos(angle))
      .addScaledVector(B, radius * Math.sin(angle));
  }
  // Unit tangent in the direction of travel. `sign` is +1 when the angle is
  // increasing along the path and -1 when it is decreasing, which is the only
  // thing that differs between the two wraps.
  function wrapTangent(B, angle, sign) {
    return new THREE.Vector3()
      .addScaledVector(RIGHT, -Math.sin(angle) * sign)
      .addScaledVector(B, Math.cos(angle) * sign)
      .normalize();
  }
  function wrapPoints(centre, radius, B, from, to, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(wrapPoint(centre, radius, B, from + ((to - from) * i) / steps));
    return pts;
  }
  function buildFlight() {
    disposeGroup(flightPath);

    const L = moonGroup.position.distanceTo(earthGroup.position);
    const shiftX = moonRightShift(layout);
    const eB = wrapBasis(WRAP_TILT_EARTH);
    const mB = wrapBasis(WRAP_TILT_MOON);
    const eR = WRAP_R_EARTH * EARTH_R;
    const mR = WRAP_R_MOON * MOON_R;

    //   Earth  exit +90 (above, in front) — where the outbound leg starts.
    //          enter -90 (below, behind) — where the homebound leg ends.
    //   Moon   enter +90 (above, in front) — where the outbound leg arrives
    //          and the Moon wrap begins.
    //          exit -90 (below, behind) — where the Moon wrap ends and the
    //          homebound leg starts.
    const eEnter = wrapPoint(earthGroup.position, eR, eB, -90 * DEG);
    const eExit = wrapPoint(earthGroup.position, eR, eB, 90 * DEG);
    const mEnter = wrapPoint(moonGroup.position, mR, mB, 90 * DEG);
    const mExit = wrapPoint(moonGroup.position, mR, mB, -90 * DEG);

    // Outbound: hand-placed control points, not tangent-derived — see
    // OUTBOUND_CONTROL above for why. Still arrives at mEnter tangent to the
    // Moon wrap below (mEnter's tangent there is +RIGHT, and the curve is
    // approaching mostly horizontally from the hand-placed points), so the
    // join into the wrap doesn't crease.
    outbound = new THREE.CubicBezierCurve3(
      eExit,
      framePos(layout, OUTBOUND_CONTROL[0][0] + shiftX * 0.35, OUTBOUND_CONTROL[0][1]),
      framePos(layout, OUTBOUND_CONTROL[1][0] + shiftX * 0.75, OUTBOUND_CONTROL[1][1]),
      mEnter
    );

    // Homebound: unchanged, still tangent-derived so it leaves the Moon wrap
    // and arrives at Earth without a crease.
    const eLead = LEAD_EARTH * L;
    const mLead = LEAD_MOON * L;
    const eEnterDir = wrapTangent(eB, -90 * DEG, -1); // -RIGHT
    const mExitDir = wrapTangent(mB, -90 * DEG, -1); // -RIGHT
    homebound = new THREE.CubicBezierCurve3(
      mExit,
      mExit.clone().addScaledVector(mExitDir, mLead),
      eEnter.clone().addScaledVector(eEnterDir, -eLead),
      eEnter
    );

    // The Moon wrap is back — Krittin, after the loop came out, asked for
    // this part specifically: "the old line used to look more like a
    // trajectory that wraps around the moon, bring that back." Same arc as
    // before (+90 to -90, the right-hand half — in front above, round the
    // right side, behind below), just no longer joined into a circuit that
    // also wraps Earth.
    const moonWrap = wrapPoints(moonGroup.position, mR, mB, 90 * DEG, -90 * DEG, 60);

    // ONE continuous open line — outbound, into the Moon wrap, into homebound
    // — not closed: the two Earth-side ends do not connect to each other, so
    // there is no full circuit around both bodies, only around the Moon.
    // slice(1,-1) on the wrap drops its own endpoints, which duplicate
    // outbound's last point and homebound's first.
    const out = outbound.getSpacedPoints(48);
    const home = homebound.getSpacedPoints(48);
    const outStart = out[0]
      .clone()
      .addScaledVector(outbound.getTangentAt(0), -FLIGHT_END_EXTENSION * L);
    const homeEnd = home[home.length - 1]
      .clone()
      .addScaledVector(homebound.getTangentAt(1), FLIGHT_END_EXTENSION * L);
    const points = [outStart, ...out, ...moonWrap.slice(1, -1), ...home, homeEnd];

    // Thin and solid (Krittin: "a thin solid ... line isntead of mix of solid
    // and dash lines"), now orange rather than white — see FLIGHT_COLOR.
    flightPath.add(
      flatLine(points, { color: FLIGHT_COLOR, width: FLIGHT_WIDTH, opacity: FLIGHT_OPACITY, dashed: false })
    );

    applyFade(fade); // newly built materials start at their resting opacity
  }

  // Each rocket rides its OWN leg, so the parameter means something stable — a
  // fraction along the climb, and a fraction along the way home — and the
  // arrival can simply ease it from 0.
  //
  // ROLL IS NOW CONTROLLED, which it was not when both of these were generic
  // finned tubes. setFromUnitVectors returns the MINIMAL rotation taking +Y to
  // the tangent, which pins the nose but says nothing about the roll around
  // it — fine for something rotationally symmetric, useless for a shuttle
  // (whose delta wings become an invisible line edge-on) or for SLS (whose two
  // boosters can end up one directly behind the other). Both models put their
  // identifying features in the local XY plane, so after aiming the nose we
  // roll about it until local +Z points as close to the camera as it can,
  // which turns that plane to face the viewer.
  //
  // `bias` then tips it back off exactly-broadside. Dead-on, a shuttle is a
  // flat plan view with its fin pointing straight at you and invisible; a few
  // tens of degrees keeps the planform readable while giving the fin and the
  // far booster some visible depth.
  const rocketUp = new THREE.Vector3(0, 1, 0);
  const rollTmpT = new THREE.Vector3();
  const rollTmpD = new THREE.Vector3();
  const rollTmpX = new THREE.Vector3();
  const rollTmpZ = new THREE.Vector3();
  const rollQuat = new THREE.Quaternion();
  function park(rocket, curve, t, bias = 0) {
    if (!curve) return;
    const u = clamp(t, 0, 1);
    rocket.position.copy(curve.getPointAt(u));

    const tangent = rollTmpT.copy(curve.getTangentAt(u)).normalize();
    rocket.quaternion.setFromUnitVectors(rocketUp, tangent);

    // Where the model's own X and Z axes point after that base rotation. Both
    // are perpendicular to the tangent by construction.
    rollTmpX.set(1, 0, 0).applyQuaternion(rocket.quaternion);
    rollTmpZ.set(0, 0, 1).applyQuaternion(rocket.quaternion);

    // The camera direction with its along-the-tangent component removed —
    // i.e. the best "toward the viewer" available in the roll plane. If the
    // vehicle is flying almost straight at or away from the camera there is
    // no meaningful answer, and the roll is left as the base rotation put it.
    rollTmpD.copy(DIR).addScaledVector(tangent, -DIR.dot(tangent));
    if (rollTmpD.lengthSq() < 1e-6) return;
    rollTmpD.normalize();

    // Rolling by theta about local +Y sends local +Z to
    // cos(theta)*Z + sin(theta)*X, so matching it to the wanted direction is
    // just its components in that pair.
    const theta = Math.atan2(rollTmpD.dot(rollTmpX), rollTmpD.dot(rollTmpZ)) + bias;
    rocket.quaternion.multiply(rollQuat.setFromAxisAngle(rocketUp, theta));
  }

  function applyLayout(L) {
    layout = L;
    const shiftX = moonRightShift(L);
    earthGroup.position.copy(framePos(L, L.earth[0], L.earth[1]));
    moonGroup.position.copy(framePos(L, L.moon[0] + shiftX, L.moon[1]));
    cmgHome
      .copy(framePos(L, L.cmg[0] + shiftX, L.cmg[1]))
      .addScaledVector(RIGHT, -(SAT_MODEL_W * CMG_SCALE) / 4)
      .addScaledVector(UP, -(SAT_MODEL_H * CMG_SCALE) / 4);
    buildFlight();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    viewW = w;
    viewH = h;
    renderer.setPixelRatio(pixelRatioFor(w, h));
    renderer.setSize(w, h, false);

    // ---- the spill --------------------------------------------------------
    // The canvas is TALLER than the section it sits in. Krittin: "the earth
    // make it full (stay same place) the rest of the earth just go over to the
    // next page" — Earth's centre is at 112% of the design frame and its
    // radius 46%, so its bottom edge lands at ~158%, and cutting the canvas at
    // the section boundary sliced it with a hard straight edge. The canvas now
    // runs 160% of the section's height and simply carries on behind Awards,
    // which is transparent (see .proj-scene and .awards in style.css).
    //
    // `designH` is the SECTION-visible height, and everything that decides the
    // composition — the layout preset, the contain-fit, the camera distance —
    // is computed from it, not from the taller canvas. That is what makes the
    // Earth full WITHOUT anything moving: same scale, same screen position,
    // just more of the frustum below.
    //
    // setViewOffset does the extending. With fullHeight = designH and
    // height = h, three.js keeps the frustum's TOP where it is and scales its
    // height by h/designH — so the extra world comes in at the bottom only.
    // Symmetrically widening the fov instead would have shifted the whole
    // composition up the screen.
    const paneStyle = getComputedStyle(scenePane);
    const spill = parseFloat(paneStyle.getPropertyValue("--scene-spill")) || 1;
    const designH = spill > 1 ? h / spill : h;
    viewDesignH = designH;
    // The desktop scene is raised above its normal box. Convert the visible
    // section bottom into NDC so the lower satellite can sit halfway between
    // the Hopper and the actual bottom the viewer sees.
    const topOffset = parseFloat(paneStyle.top) || 0;
    const visibleBottomPx = Math.min(h, designH - topOffset);
    viewBottomNdcY = 1 - (2 * visibleBottomPx) / h;

    const aspect = w / designH;
    const L = layoutFor(aspect);
    if (L !== layout) applyLayout(L);

    // AFTER applyLayout, deliberately: a preset change rebuilds the flyby path
    // and its material is created in there, so doing this first would leave
    // the newest line with no resolution — and a Line2 with no resolution
    // renders at the wrong width, or at nothing.
    scene.traverse((o) => {
      if (o.material && o.material.isLineMaterial) o.material.resolution.set(w, h);
    });

    // Contain-fit the design frame: whichever of its two dimensions runs out
    // first decides the visible height, so the whole composition is always on
    // screen with the surplus split evenly around it.
    const visibleH = aspect >= L.fw / L.fh ? L.fh : L.fw / aspect;
    const distance = (visibleH * L.fit) / (2 * HALF_FOV);

    camera.aspect = aspect;
    camera.position.copy(DIR).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    // setViewOffset updates the projection matrix itself, so it goes last.
    if (h > designH + 0.5) camera.setViewOffset(w, designH, 0, 0, w, h);
    else {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }

    // Billboard both limb rings to the camera. Once, not per frame — the
    // camera never turns.
    earthGroup.children.forEach((c) => c.isLineLoop && c.quaternion.copy(camera.quaternion));
    moonGroup.children.forEach((c) => c.isLineLoop && c.quaternion.copy(camera.quaternion));

    // AFTER the camera is finished (aspect/position/viewOffset all set) —
    // projectPx needs the final projection matrix.
    earthScreen = bodyScreenCircle(earthGroup.position, EARTH_R * 1.075);
    moonScreen = bodyScreenCircle(moonGroup.position, MOON_R * 1.075);
  }

  // Scales every fadeable material by the arrival progress. The two body
  // shaders carry their own uFade uniform instead; everything else recorded
  // its resting opacity in userData when it was built.
  function applyFade(e) {
    // The intro tween calls this every frame from p=0 to p=1, but STAGE.fade
    // saturates at p=0.42 — for the rest of the intro this was re-walking the
    // whole scene graph every frame to set every material's opacity to the
    // value it's already at.
    if (e === fade) return;
    fade = e;
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (m.isShaderMaterial && m.uniforms && m.uniforms.uFade) {
        m.uniforms.uFade.value = e;
        return;
      }
      if (m.userData.baseOpacity === undefined) return;
      const v = m.userData.baseOpacity * e;
      m.opacity = v;
      // LineMaterial is a ShaderMaterial, and the renderer only syncs
      // material.opacity into a uniform for its own built-in materials — a
      // custom shader has to be written directly or the fade silently does
      // nothing. LineMaterial happens to define an opacity accessor that
      // forwards to its uniform, so the line above already works; this is
      // belt and braces for any shader path added here later.
      if (m.uniforms && m.uniforms.opacity) m.uniforms.opacity.value = v;
    });
    if (labelLayer) labelLayer.style.opacity = String(e);
  }

  // Where the text sits relative to the point it is placed at. "left" means
  // the label is to the RIGHT of the object and reads away from it, so its own
  // left edge is the anchor.
  const ALIGN = { center: "translate(-50%, -50%)", left: "translate(0, -50%)", right: "translate(-100%, -50%)" };
  const EDGE_PAD = 12;
  const labelPos = new THREE.Vector3();

  // If (x, y) sits inside `body`'s circle, push it radially outward to just
  // clear it — "if they overlap move them more to the side" reads naturally
  // as pushing along the line from the body's centre through the label,
  // which IS to the side once the label is off-centre from that body at all
  // (true for every label here; none sit exactly on a body's centre).
  const LABEL_BODY_MARGIN = 20; // px clear of the limb, beyond the label's own anchor point
  function clearBody(x, y, body) {
    if (!body) return [x, y];
    const dx = x - body.x;
    const dy = y - body.y;
    const d = Math.hypot(dx, dy);
    const min = body.r + LABEL_BODY_MARGIN;
    if (d >= min || d < 1e-6) return [x, y];
    const k = min / d;
    return [body.x + dx * k, body.y + dy * k];
  }

  function updateLabelPositions() {
    if (!labelLayer) return;
    // Fractions of the canvas, not fixed pixels: the composition rescales
    // with the canvas, so a fixed-px offset that clears Earth's limb on a
    // laptop lands back on the ocean on a large display. The width term caps
    // it on a narrow canvas, where a height-derived offset would fling
    // labels off the side.
    const unit = Math.min(viewDesignH || viewH, viewW * 0.55);
    PROJECTS.forEach((p) => {
      if (!p.el) return;
      p.object.getWorldPosition(labelPos).project(camera);
      const ax = (labelPos.x * 0.5 + 0.5) * viewW;
      const ay = (-(labelPos.y * 0.5) + 0.5) * viewH;
      let x = ax + p.dx * unit;
      let y = ay + p.dy * unit;
      if (p.avoidEarth) [x, y] = clearBody(x, y, earthScreen);
      if (p.avoidMoon) [x, y] = clearBody(x, y, moonScreen);
      // Clamped to the SECTION-visible box, not the whole canvas: the canvas
      // now runs on past the section (see the spill note in resize()), and a
      // label placed down there would sit over the Awards cards.
      x = clamp(x, EDGE_PAD, viewW - EDGE_PAD);
      y = clamp(y, EDGE_PAD, (viewDesignH || viewH) - EDGE_PAD);
      p.el.style.transform = `${ALIGN[p.align]} translate(${x}px, ${y}px)`;
    });
  }

  function render() {
    if (!viewW || !viewH) return;
    updateLabelPositions();
    renderer.render(scene, camera);
  }

  // Post-arrival, nothing PROJECTS' labels are anchored to ever moves again
  // (same fact updateInfoPanel's own comment relies on) — updateLabelPositions()'s
  // only inputs (viewW/viewH/earthScreen/moonScreen, the camera) are otherwise
  // constant until the next resize, which calls render() (and so
  // updateLabelPositions()) itself. So the steady-state loop below — throttled
  // to DRIFT_FPS forever just to spin Earth's cloud shell — only needs to
  // redraw, not re-walk and re-transform all 8 labels on every one of those
  // frames for values that haven't changed since the last one.
  function renderFrame() {
    if (!viewW || !viewH) return;
    renderer.render(scene, camera);
  }

  // ---- the arrival ---------------------------------------------------------
  //
  // Everything flies to its parked position rather than simply fading up,
  // which is what Krittin asked for object by object: the two bodies rotate
  // in carrying whatever stands on them, the TurtleBot drives in along its
  // trail from the left, the cubesat sweeps around its orbit, TerraGator
  // climbs away from Earth and Navigator comes out from behind the Moon.
  //
  // Each object gets its own slice of the timeline rather than all of them
  // sharing one clock. The slices overlap heavily — this should read as one
  // system settling into place, not as six things taking turns — but the
  // ORDER matters: the bodies arrive first so nothing is flying toward a
  // planet that is not there yet, and the two rockets land last because they
  // travel the furthest and are the thing the eye should end on.
  //
  // stage() maps global progress onto a sub-range and eases it, so each row of
  // the table below reads as "from when to when", in fractions of INTRO_MS.
  const STAGE = {
    fade: [0.0, 0.42],
    spin: [0.0, 0.78],
    sat: [0.12, 0.86],
    robot: [0.22, 0.96],
    terra: [0.28, 1.0],
    navi: [0.34, 1.0],
  };
  // How far each body turns on its way in. Small on purpose: this is a planet
  // settling, not a spinning globe, and a large angle drags surface objects
  // right across the disc before they land.
  const EARTH_SPIN_IN = -0.5; // radians
  const MOON_SPIN_IN = 0.42;
  // Where the cubesat comes in from, as a world offset from where it ends up.
  // Left and slightly low, so it arrives travelling the way its parked
  // attitude points — which is the last thing left of it flying in around an
  // orbit it no longer has.
  const CMG_ENTRY = RIGHT.clone().multiplyScalar(-1.5).addScaledVector(UP, -0.35);

  function stage(p, [from, to]) {
    return easeOutCubic(clamp((p - from) / (to - from), 0, 1));
  }

  // Krittin's brief, object by object: "the robot move from left side along
  // the trail to the current position. Terragator move from start of
  // trajectory from earth to current location. Navigator move from moon to
  // current location. Cubesat move from start of trajectory to current
  // location."
  //
  // Earth's rest yaw is EARTH_YAW, not 0 — it is what turns the greenest
  // hemisphere toward the camera, so the spin-in has to settle ONTO it rather
  // than onto zero, or the arrival would end by rotating the chosen face away.
  function applyIntro(p) {
    applyFade(stage(p, STAGE.fade));

    const s = stage(p, STAGE.spin);
    earthSpin.rotation.y = EARTH_YAW + EARTH_SPIN_IN * (1 - s);
    moonSpin.rotation.y = MOON_SPIN_IN * (1 - s);

    const satProgress = stage(p, STAGE.sat);
    cmgSat.position.copy(cmgHome).addScaledVector(CMG_ENTRY, 1 - satProgress);
    placeRobot(stage(p, STAGE.robot));
    park(terragatorRocket, outbound, TERRAGATOR_T * stage(p, STAGE.terra), TERRAGATOR_ROLL);
    park(communigatorRocket, homebound, COMMUNIGATOR_T * stage(p, STAGE.navi), COMMUNIGATOR_ROLL);

    // Satellite A sits at the screen-readable midpoint of the CBF robot and
    // TerraGator. Satellite B stays directly below the Lunar Hopper's apex.
    // Both anchors are derived from the live models, so responsive layouts and
    // the arrival animation cannot make these relationships drift.
    robot.getWorldPosition(cbfModelWorld).project(camera);
    terragatorNdc.copy(terragatorRocket.position).project(camera);
    decorativeSatA.position
      .set(
        (cbfModelWorld.x + terragatorNdc.x) * 0.5,
        (cbfModelWorld.y + terragatorNdc.y) * 0.5,
        (cbfModelWorld.z + terragatorNdc.z) * 0.5
      )
      .unproject(camera)
      .addScaledVector(CMG_ENTRY, 0.65 * (1 - satProgress));
    hopMarker.getWorldPosition(hopperWorld).project(camera);
    decorativeSatB.position
      .set(
        hopperWorld.x,
        (hopperWorld.y + viewBottomNdcY) * 0.5,
        hopperWorld.z
      )
      .unproject(camera)
      .addScaledVector(RIGHT, THEOS_RIGHT_OFFSET)
      .addScaledVector(UP, -(SAT_MODEL_H * DECORATIVE_SAT_SCALE_B) / 2)
      .addScaledVector(CMG_ENTRY, 0.4 * (1 - satProgress));
  }

  // Parked state, used under reduced motion and as the resting state a resize
  // has to restore (a preset change rebuilds the flight curves underneath the
  // rockets, so their positions have to be re-derived from the new ones).
  // Every STAGE range's `to` is <= 1, so applyIntro(1) resolves every stage()
  // call to exactly 1 and lands on the same values this used to set by hand.
  const applySettled = () => applyIntro(1);

  resize();
  // resize() bails without touching the layout if the canvas has no size yet
  // (a display:none ancestor, a zero-height flex box mid-load). Building the
  // widest preset anyway means the scene is fully assembled and merely
  // unsized, so the first real resize is a reframe rather than a cold build.
  if (!layout) applyLayout(LAYOUTS[0]);
  applyFade(fade);
  // REDUCED rather than introDone, which is not declared until below: at this
  // point the two are the same value, and reading introDone here would be a
  // temporal-dead-zone error rather than a subtle one.
  if (REDUCED) applySettled();
  window.addEventListener("resize", () => {
    resize();
    // A preset change moves every frame-placed object, so their positions are
    // stale until re-copied. Only once the arrival has landed — mid-arrival
    // the next frame is about to place everything anyway.
    if (introDone) applySettled();
    render();
  });

  // ---- the loop ------------------------------------------------------------
  //
  // Three things want frames, at three different rates, and the loop switches
  // between them rather than running everything at the fastest:
  //
  //   - the ARRIVAL and HOVER transitions, capped at ACTIVE_FPS;
  //   - the AMBIENT drift, forever, throttled to DRIFT_FPS: Earth's cloud
  //     shell, the only thing in the scene that still moves on its own. It
  //     turns at a fraction of a degree a second, so 12 frames is ample, and
  //     this is a second WebGL context on a page that already
  //     runs a full-screen scene.
  //
  // On top of that the loop runs ONLY while Projects is on screen and stops on
  // tab-hide, and under prefers-reduced-motion everything is placed at its
  // resting state and the loop stops for good.
  const INTRO_MS = 2200;
  const ACTIVE_FPS = 45;
  const ACTIVE_INTERVAL = 1000 / ACTIVE_FPS;
  const DRIFT_FPS = 12;
  const DRIFT_INTERVAL = 1000 / DRIFT_FPS;
  const CLOUD_SPEED = 0.011; // radians per second

  let introStart = null;
  let introDone = REDUCED;
  let frame = null;
  let lastActive = 0;
  let lastDraw = 0;
  let visible = false;

  function tick(now) {
    frame = requestAnimationFrame(tick);

    // Arrival and hover easing do not need to follow a 90/144/165 Hz panel.
    // A bounded active cadence saves the second WebGL context from redrawing
    // more often than the motion can communicate.
    if (lastActive && now - lastActive < ACTIVE_INTERVAL * 0.9) return;
    lastActive = now;

    if (!introDone) {
      if (introStart === null) introStart = now;
      const p = Math.min((now - introStart) / INTRO_MS, 1);
      applyIntro(p);
      ambient(now);
      render();
      if (p >= 1) {
        introDone = true;
        lastDraw = now;
      }
      return;
    }

    // Reduced motion: nothing is allowed to move, so draw the settled scene
    // once and stop the loop rather than spinning on a no-op.
    if (REDUCED) {
      stop();
      render();
      return;
    }

    updateHover();
    // Hover easing is evaluated at the active cadence while it is running,
    // even if the slower cloud throttle would otherwise skip the draw.
    const hoverBusy = updateHoverEasing();

    if (!hoverBusy && now - lastDraw < DRIFT_INTERVAL) return;
    lastDraw = now;
    ambient(now);
    renderFrame();
  }

  // Everything that moves on its own, driven off the same clock. `now` is the
  // rAF timestamp, so this is wall time rather than frame count — the drift
  // runs at the same real speed whether the loop is throttled or not, and
  // scrolling away and back never rewinds it.
  function ambient(now) {
    const seconds = now / 1000;
    clouds.mesh.rotation.y = seconds * CLOUD_SPEED;
  }

  function start() {
    if (frame !== null) return;
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          visible = e.isIntersecting;
          if (visible) start();
          else stop();
        });
      },
      { rootMargin: "120px" }
    );
    io.observe(canvas);
  } else {
    visible = true;
    start();
  }

  // A background tab gets no useful frames anyway, and leaving the loop
  // running there is exactly the idle drain this scene must not add.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (visible) start();
  });

  return { resize, render, start, stop };
}
