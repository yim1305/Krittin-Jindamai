// --------------------------------------------------------------------------
// CBF project page — the real Gazebo run, not a synthetic stand-in.
//
// Krittin recorded a 235-second ROS 2 + Gazebo Harmonic run of a TurtleBot3
// Burger tracking a reference spiral under a CBF-QP safety filter, and exported
// it to assets/data/ (see the README there):
//   robot_odom.csv      the full capture, ~28 Hz: t, x, y, yaw, and velocity
//                       columns the DiffDrive plugin left at zero
//   spiral_geometry.csv 300 points of the COMMANDED path, which deliberately
//                       spirals out past the room — that is what the filter has
//                       to refuse to follow
//   walls.csv           the safe rectangle the barrier is built from,
//                       [-2.75, 2.75] x [-6.75, 6.75] m
//   cbf-run.csv         what this file actually plays: one continuous episode
//                       of the capture, thinned and yaw-unwrapped by
//                       scripts/export-cbf-run.ps1 (the reasoning is in there —
//                       in short, the raw capture contains seven repositions
//                       that would look like teleports, and 596 KB is too much
//                       to ship for a page decoration)
//
// The camera never moves. It is a fixed instrument view of the whole safe set,
// tilted enough that the boundary markers and the robot have real height while
// the spiral stays as legible as it would be on a plan.
//
// House style is the site's, not a simulator's: MeshBasicMaterial and no lights
// at all, per-facet banded shading, flat hairline edges, and screen-space Line2
// paths rather than tube geometry. The one accent is `--orange` on the robot's
// actual path, which is the same "orange is a trajectory" rule the Projects
// scene follows; everything else is the neutral greys, brightening to bone
// where the barrier is doing work.
//
// PERFORMANCE, because this is the second WebGL scene on a page that also
// carries the site's backdrop: the whole scene is ~10 draw calls of static
// geometry. Nothing is rebuilt per frame — the robot gets a new transform, four
// boundary materials get a new colour, and the trail grows by setting
// `instanceCount` on geometry that was uploaded once. The loop is capped at
// 30 fps, only runs while the canvas is on screen and the tab is visible, and
// does not exist at all under prefers-reduced-motion (one static settle
// instead). Text lives in HTML over the canvas, not in canvas textures.
// --------------------------------------------------------------------------

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Straight from the design tokens in css/style.css, the same subset the other
// scene modules keep their own copy of.
const CARBON = 0x1d1a18;
const ASH = 0x3d3a39;
const GRAPHITE = 0x4d4947;
const WARM_GRANITE = 0x8a8380;
const BONE = 0xeeeeee;
const ORANGE = 0xee6018;
// Slate teal, the same tint the TurtleBot carries in the home Projects scene —
// this is the same robot, so it is the same colour.
const ROBOT_TINT = 0x7fa0a3;

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// --------------------------------------------------------------------------
// Scene constants.
// --------------------------------------------------------------------------

// World mapping: room x -> three.x, room y -> three.-z, height -> three.y.
// The negated z is what keeps the plan un-mirrored on screen — with room y as
// +z, a camera looking down would flip the spiral's handedness, which would be
// a lie about the data. roomToScene() is the only place this is expressed.
const roomToScene = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

// Fixed camera. The room is 5.5 x 13.5 m, so its LENGTH has to be the
// horizontal one on screen — hence a camera that looks along the short axis,
// with a small azimuth so the view is not a dead-flat elevation. Both angles
// were solved against the fit below rather than eyeballed: the vertical extent
// of the composition is 5.5 m of depth foreshortened by sin(elevation), and
// azimuth tips the 13.5 m length into that same vertical budget, so both
// steepening the camera and swinging it round cost scale. At 50 / 8 degrees
// into a canvas near 2.4:1, the whole safe set fills ~90% of the width and
// ~94% of the height, and a metre of floor is about 63 px on a 1120 px canvas.
// Changing either angle, or the canvas aspect, changes that trade — re-check
// it rather than nudging by eye.
const CAM_ELEV = 50 * DEG;
const CAM_AZIM = 8 * DEG;
const CAM_FOV = 30;
const FIT_MARGIN = 1.06;

// Boundary markers. The safe set is a 2D rectangle — the barrier has no height
// — so this is a drawn marker height chosen to read, NOT a measured wall.
const MARKER_H = 0.55;
// A wall's marker brightens as the look-ahead point closes on it. 0.6 m is
// roughly where the QP starts visibly bending the command in this run.
const NEAR_WALL = 0.6;

// The look-ahead point the barrier is actually evaluated at: 0.15 m ahead of
// the robot's centre along its heading, per the data README. Used for the live
// h readout. Deliberately NOT drawn as a marker: the robot glyph below is
// enlarged 3x for legibility, so a true-scale 0.15 m offset would sit inside
// its hull and read as wrong to anyone who knows the method.
const LOOKAHEAD = 0.15;

// TurtleBot3 Burger is 138 mm across. The frame has to hold a 13.5 m room, so
// at 1:1 the robot is nine pixels — a speck. Drawn 4x it is about 36, which is
// the smallest that still reads as a machine with a heading rather than a dot.
// Disclosed in the page's legend, the same way the CMG page labels its
// satellite "enlarged".
const ROBOT_EXAGGERATION = 4;
const BURGER_RADIUS = 0.069;

// 60 s of run in 30 s of page. Fast enough to hold attention, slow enough that
// a 0.44 m/s robot still reads as a small careful machine.
const PLAYBACK_RATE = 2;
const END_HOLD_SECONDS = 1.2;

// --------------------------------------------------------------------------
// Materials and model building — the same flat, banded, hairline-edged
// language as js/system-scene.js. See the long note there; this is the short
// version, kept local because a handful of hex literals is not worth a
// cross-module import.
// --------------------------------------------------------------------------

const FILL_STEPS = [WARM_GRANITE, GRAPHITE, ASH, CARBON];
const FILL_ALPHA_STEPS = [0.5, 0.34, 0.22, 0.14];
const FILL_LIGHT = new THREE.Vector3(0.42, 0.82, 0.45).normalize();

function shadeByNormal(geometry) {
  const normals = geometry.getAttribute("normal");
  if (!normals) return geometry;
  const colors = new Float32Array(normals.count * 4);
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i);
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

function fillMaterial(tint) {
  return new THREE.MeshBasicMaterial({
    color: tint,
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

const lineMat = (color, opacity = 1) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity });

// Dihedral threshold that drops facet seams but keeps real edges — 32 degrees,
// just above the 30 of a twelve-sided cylinder. Same constant, same reason, as
// every other model on this site.
const EDGE_CLEAN = 32;

function mergedPart(geometries, tint, edgeAngle = EDGE_CLEAN) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shadeByNormal(mergeGeometries(geometries, false)), fillMaterial(tint)));
  const edges = geometries.map((g) => new THREE.EdgesGeometry(g, edgeAngle));
  group.add(new THREE.LineSegments(mergeGeometries(edges, false), lineMat(BONE)));
  edges.forEach((g) => g.dispose());
  geometries.forEach((g) => g.dispose());
  return group;
}

// The CBF TurtleBot: drum base, two wheels, a lidar mast. Ported unchanged from
// buildTurtlebot() in js/system-scene.js so the robot on this page and the one
// standing on Earth in the Projects scene are the same object — keep them in
// step. Forward is local +Z, drum radius 0.34 in these units, and its lowest
// point is the wheels' 0.14 below the origin — which is how far it has to be
// lifted here to stand ON the floor rather than half sunk into it.
const BUILDER_DRUM_R = 0.34;
const BUILDER_GROUND = 0.14;
function buildTurtlebot() {
  const geos = [new THREE.CylinderGeometry(BUILDER_DRUM_R, BUILDER_DRUM_R, 0.22, 16)];

  const wheel = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12);
  const spin = new THREE.Matrix4().makeRotationZ(90 * DEG);
  geos.push(wheel.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(0.34, -0.05, 0).multiply(spin)));
  geos.push(wheel.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(-0.34, -0.05, 0).multiply(spin)));
  wheel.dispose();

  const mast = new THREE.BoxGeometry(0.05, 0.42, 0.05);
  mast.translate(0, 0.32, 0);
  geos.push(mast);

  const puck = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16);
  puck.translate(0, 0.56, 0);
  geos.push(puck);

  return mergedPart(geos, ROBOT_TINT);
}

// --------------------------------------------------------------------------
// Paths. Line2 expands a polyline into camera-facing quads in the vertex
// shader, so width is in SCREEN pixels and constant however far the line
// recedes — a drawn line over a 3D scene, which is the register the rest of
// the site's chrome is in. Its one requirement is `resolution`, which resize()
// sets by walking for isLineMaterial rather than keeping a registry.
// --------------------------------------------------------------------------

function flatLine(points, { color, width, opacity, dashed = false, dashSize = 0.22, gapSize = 0.16 }) {
  const flat = [];
  points.forEach((p) => flat.push(p.x, p.y, p.z));
  const geometry = new LineGeometry();
  geometry.setPositions(flat);
  const material = new LineMaterial({
    color,
    linewidth: width,
    dashed,
    dashSize,
    gapSize,
    transparent: true,
    opacity,
    alphaToCoverage: false,
  });
  const line = new Line2(geometry, material);
  line.computeLineDistances(); // required, or `dashed` does nothing
  return line;
}

// --------------------------------------------------------------------------
// Data.
// --------------------------------------------------------------------------

async function loadCsv(url) {
  const text = await (await fetch(url)).text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  const cols = {};
  headers.forEach((h) => (cols[h] = []));
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",");
    headers.forEach((h, j) => cols[h].push(parseFloat(vals[j])));
  }
  return cols;
}

// Binary search for the sample bracketing tv, with the interpolation fraction.
function findFrame(t, tv) {
  const n = t.length;
  if (tv <= t[0]) return { i0: 0, i1: 0, frac: 0 };
  if (tv >= t[n - 1]) return { i0: n - 1, i1: n - 1, frac: 0 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tv) lo = mid;
    else hi = mid;
  }
  return { i0: lo, i1: hi, frac: (tv - t[lo]) / (t[hi] - t[lo]) };
}

// --------------------------------------------------------------------------

export async function initCbfScene({ canvas, runUrl, spiralUrl, wallsUrl, hudEl }) {
  if (!canvas) return;

  const [run, spiralCsv, wallsCsv] = await Promise.all([
    loadCsv(runUrl),
    loadCsv(spiralUrl),
    loadCsv(wallsUrl),
  ]);

  const t = run.t;
  const tMax = t[t.length - 1];
  const room = {
    xMin: wallsCsv.x_min[0],
    xMax: wallsCsv.x_max[0],
    yMin: wallsCsv.y_min[0],
    yMax: wallsCsv.y_max[0],
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  // Same budget as the other two scenes: never above 1.4x, and lower still on
  // a large canvas, so a 4K display doesn't quietly quadruple the fill cost.
  const pixelRatioFor = (w, h) =>
    Math.max(0.75, Math.min(window.devicePixelRatio || 1, 1.4, Math.sqrt(1200000 / Math.max(1, w * h))));

  // ---- floor: one dim plane plus a 1 m hairline grid. The plane is barely
  // there (0.16) on purpose — it gives the room a surface without shutting out
  // the site's starfield behind the canvas, which every other scene lets
  // through.
  const floorW = room.xMax - room.xMin;
  const floorL = room.yMax - room.yMin;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorW, floorL),
    new THREE.MeshBasicMaterial({ color: CARBON, transparent: true, opacity: 0.16, depthWrite: false })
  );
  floor.rotation.x = -90 * DEG;
  floor.position.y = -0.004;
  floor.renderOrder = 0;
  scene.add(floor);

  const gridPoints = [];
  for (let gx = Math.ceil(room.xMin); gx <= Math.floor(room.xMax); gx++) {
    gridPoints.push(roomToScene(gx, room.yMin), roomToScene(gx, room.yMax));
  }
  for (let gy = Math.ceil(room.yMin); gy <= Math.floor(room.yMax); gy++) {
    gridPoints.push(roomToScene(room.xMin, gy), roomToScene(room.xMax, gy));
  }
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(gridPoints),
    lineMat(GRAPHITE, 0.34)
  );
  grid.renderOrder = 1;
  scene.add(grid);

  // ---- the safe set. Four independent half-plane barriers is how the filter
  // is written, so it is drawn as four independent markers: each wall is its
  // own floor edge + top rail + two posts with its own material, and that
  // material is what brightens when the look-ahead point closes on THAT wall.
  const wallCorners = [
    // [name, (x0,y0) -> (x1,y1), distance function for the look-ahead point]
    ["x_max", room.xMax, room.yMin, room.xMax, room.yMax, (px) => room.xMax - px.x],
    ["x_min", room.xMin, room.yMin, room.xMin, room.yMax, (px) => px.x - room.xMin],
    ["y_max", room.xMin, room.yMax, room.xMax, room.yMax, (px) => room.yMax - px.y],
    ["y_min", room.xMin, room.yMin, room.xMax, room.yMin, (px) => px.y - room.yMin],
  ];
  const walls = wallCorners.map(([name, x0, y0, x1, y1, distance]) => {
    const material = lineMat(GRAPHITE, 0.85);
    const points = [
      roomToScene(x0, y0), roomToScene(x1, y1),                     // floor edge
      roomToScene(x0, y0, MARKER_H), roomToScene(x1, y1, MARKER_H), // top rail
      roomToScene(x0, y0), roomToScene(x0, y0, MARKER_H),           // posts
      roomToScene(x1, y1), roomToScene(x1, y1, MARKER_H),
    ];
    const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material);
    line.renderOrder = 2;
    scene.add(line);
    return { name, material, distance };
  });

  // ---- the commanded spiral. Drawn in full, including the turns that leave
  // the room: that the reference asks the robot to drive through a wall is the
  // whole reason the filter is interesting. Dashed and dim, because it is a
  // command, not a measurement.
  const spiralPoints = spiralCsv.x.map((x, i) => roomToScene(x, spiralCsv.y[i], 0.006));
  const spiral = flatLine(spiralPoints, { color: WARM_GRANITE, width: 1.3, opacity: 0.5, dashed: true });
  spiral.renderOrder = 3;
  scene.add(spiral);

  // ---- the path actually driven. Built once, at full length, and revealed by
  // setting instanceCount: Line2 draws one instance per segment, so a growing
  // trail costs one number per frame instead of a re-uploaded buffer.
  const trailPoints = run.x.map((x, i) => roomToScene(x, run.y[i], 0.012));
  const trail = flatLine(trailPoints, { color: ORANGE, width: 2, opacity: 0.95 });
  trail.renderOrder = 4;
  trail.geometry.instanceCount = 0;
  scene.add(trail);

  // ---- the robot.
  const robot = buildTurtlebot();
  const robotScale = (BURGER_RADIUS * ROBOT_EXAGGERATION) / BUILDER_DRUM_R;
  robot.scale.setScalar(robotScale);
  const robotLift = BUILDER_GROUND * robotScale;
  // renderOrder on a Group does nothing — the group itself is never drawn — so
  // it has to go on the mesh and the edge lines individually.
  robot.traverse((o) => (o.renderOrder = 5));
  scene.add(robot);

  // ---- fixed camera. Direction is fixed; only the DISTANCE is solved, so the
  // composition is identical at every viewport and nothing swims on resize.
  const dir = new THREE.Vector3(
    Math.cos(CAM_ELEV) * Math.cos(CAM_AZIM),
    Math.sin(CAM_ELEV),
    -Math.cos(CAM_ELEV) * Math.sin(CAM_AZIM)
  ).normalize();
  const target = new THREE.Vector3(0, MARKER_H * 0.35, 0);

  // Every corner of the room's box, in a camera basis built from `dir`. With
  // the camera at target + D*dir, a point's camera-space depth is (a.z - D), so
  // the D that just contains a corner is a.z + |a.x|/tan(hFov) (and the same in
  // y) — take the largest over all eight and the whole safe set is in frame at
  // any aspect, with no hand-tuned distance to go stale.
  const fitCorners = [];
  for (const x of [room.xMin, room.xMax]) {
    for (const y of [room.yMin, room.yMax]) {
      for (const h of [0, MARKER_H]) fitCorners.push(roomToScene(x, y, h));
    }
  }
  const basis = new THREE.Matrix4();
  function fitCamera(aspect) {
    const zAxis = dir.clone();                                    // camera looks down -z
    const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis).normalize();
    const yAxis = zAxis.clone().cross(xAxis).normalize();
    basis.makeBasis(xAxis, yAxis, zAxis);
    const inverse = basis.clone().transpose();                    // orthonormal, so transpose == inverse

    const tanV = Math.tan((CAM_FOV * DEG) / 2);
    const tanH = tanV * aspect;
    let distance = 0;
    const local = new THREE.Vector3();
    for (const corner of fitCorners) {
      local.copy(corner).sub(target).applyMatrix4(inverse);
      distance = Math.max(
        distance,
        local.z + (Math.abs(local.x) / tanH) * FIT_MARGIN,
        local.z + (Math.abs(local.y) / tanV) * FIT_MARGIN
      );
    }
    camera.position.copy(dir).multiplyScalar(distance).add(target);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.near = Math.max(0.1, distance * 0.05);
    camera.far = distance * 4;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  // ---- pose. Position and the unwrapped yaw are interpolated between the two
  // bracketing samples, so 14 Hz data plays back smoothly at 30 fps. Yaw is
  // unwrapped in the exported CSV precisely so this can be a plain lerp.
  const lookahead = { x: 0, y: 0 };
  const pose = { x: 0, y: 0, yaw: 0 };
  function poseAt(simTime) {
    const { i0, i1, frac } = findFrame(t, simTime);
    pose.x = run.x[i0] + (run.x[i1] - run.x[i0]) * frac;
    pose.y = run.y[i0] + (run.y[i1] - run.y[i0]) * frac;
    pose.yaw = run.yaw[i0] + (run.yaw[i1] - run.yaw[i0]) * frac;
    lookahead.x = pose.x + LOOKAHEAD * Math.cos(pose.yaw);
    lookahead.y = pose.y + LOOKAHEAD * Math.sin(pose.yaw);
    return i0;
  }

  const wallColor = new THREE.Color();
  const BONE_COLOR = new THREE.Color(BONE);
  function applyPose(sampleIndex) {
    robot.position.set(pose.x, robotLift, -pose.y);
    // buildTurtlebot() faces local +Z; a rotation of (yaw + 90deg) about Y aims
    // that at the room heading under this file's x/-z mapping.
    robot.rotation.y = pose.yaw + Math.PI / 2;
    trail.geometry.instanceCount = sampleIndex;

    for (const wall of walls) {
      const h = wall.distance(lookahead);
      // 1 at the barrier, 0 once comfortably clear — the marker states how much
      // of the constraint is live, rather than blinking on a threshold.
      const proximity = clamp(1 - h / NEAR_WALL, 0, 1);
      wallColor.setHex(GRAPHITE).lerp(BONE_COLOR, proximity);
      wall.material.color.copy(wallColor);
      wall.material.opacity = 0.85 + 0.15 * proximity;
    }
  }

  function barrierValue() {
    let h = Infinity;
    for (const wall of walls) h = Math.min(h, wall.distance(lookahead));
    return h;
  }

  function updateHud(simTime) {
    if (!hudEl) return;
    const heading = (((pose.yaw * (180 / Math.PI)) % 360) + 360) % 360;
    hudEl.textContent =
      `t   ${simTime.toFixed(1).padStart(6)} s\n` +
      `x   ${pose.x.toFixed(2).padStart(6)} m\n` +
      `y   ${pose.y.toFixed(2).padStart(6)} m\n` +
      `yaw ${heading.toFixed(0).padStart(6)} deg\n` +
      `h   ${barrierValue().toFixed(2).padStart(6)} m`;
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(pixelRatioFor(w, h));
    renderer.setSize(w, h, false);
    // Line2 widths are in pixels, which is meaningless without the drawing
    // buffer size — and a LineMaterial with no resolution renders wrong or not
    // at all. Walk for them rather than keeping a registry.
    scene.traverse((o) => {
      if (o.material && o.material.isLineMaterial) o.material.resolution.set(w, h);
    });
    fitCamera(w / h);
    renderer.render(scene, camera);
  }

  // First paint: settle on the opening pose before anything is scheduled.
  poseAt(0);
  applyPose(0);
  updateHud(0);
  resize();
  window.addEventListener("resize", resize);
  // The canvas is sized by CSS, and its box can change without the window
  // doing (a webfont landing, the reading column reflowing). setSize's third
  // argument is false, so this never writes the canvas's CSS size back and
  // cannot feed itself.
  if ("ResizeObserver" in window) new ResizeObserver(() => resize()).observe(canvas);

  // Static settle, no loop — the rule every scene on this site follows.
  if (REDUCED) {
    const last = t.length - 1;
    poseAt(tMax);
    applyPose(last);
    updateHud(tMax);
    renderer.render(scene, camera);
    return;
  }

  const LOOP_SECONDS = tMax / PLAYBACK_RATE;
  const FRAME_INTERVAL = 1000 / 30;
  let frame = null;
  let visible = false;
  let elapsedSeconds = 0;
  let previousTick = null;
  let lastDraw = 0;
  let lastHud = 0;

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (lastDraw && now - lastDraw < FRAME_INTERVAL * 0.9) return;
    lastDraw = now;
    // Clock starts when the scene first becomes visible and pauses offscreen.
    if (previousTick !== null) elapsedSeconds += (now - previousTick) / 1000;
    previousTick = now;

    const phase = elapsedSeconds % (LOOP_SECONDS + END_HOLD_SECONDS);
    const simTime = Math.min(phase * PLAYBACK_RATE, tMax);
    const index = poseAt(simTime);
    applyPose(index);
    renderer.render(scene, camera);

    if (now - lastHud > 150) {
      lastHud = now;
      updateHud(simTime);
    }
  }
  function start() {
    if (frame !== null) return;
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    previousTick = null;
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (visible) start();
  });
}
