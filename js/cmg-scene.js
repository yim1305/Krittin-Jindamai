// --------------------------------------------------------------------------
// CMG project page — the real simulation result, not a synthetic stand-in.
// Krittin ran the actual MATLAB sim (Main.m / web_export.m in the thesis
// repo) and exported the current runs to two CSVs in assets/data/:
//   sim_data_mtq_on.csv  t, quaternion, ECI position (m), flywheel speed
//                       (rad/s), gimbal rates, torques, S_CMG and S_RW
//   sim_data_mtq_off.csv t, flywheel speed (rad/s) — the MTQ-OFF comparison
//                       run, same time grid as cmg-sim.csv row-for-row
//                       (both come from the same downsampling in
//                       web_export.m), so one time index looks up both
// One clock drives the orbit, attitude and all five time-history plots.
// Charts are hand-built SVG (axes, ticks,
// polylines), not a charting library, since nothing else on the site uses
// one and the data is simple enough not to need it.
//
// Playback runs forward, holds the final result for one second, then resets.
// The opening maneuver uses a 0–100 s chart window before the full-run view.
//
// The 3D scene keeps the site's house style for the bus itself
// (MeshBasicMaterial, per-vertex banded shading, no lights/gradients, flat
// hairline edges, static camera) but the body axes and nadir arrow are
// deliberately real/simulation colours (red/green/blue body axes, cyan
// nadir, matching Krittin's reference animate_satellite.m/py) rather than
// the site's neutral palette — Krittin: "add label to the axes like nadir
// direction, xyz coordinates like in simulation". These are informational
// overlay, not another "model", so this doesn't reopen `--orange`/`--green`
// staying accent-only.
// --------------------------------------------------------------------------

import * as THREE from "three";
import { LOW_POWER, createRenderBudget, createFrameLoop, prepareShaders, loadNumericCsv as loadCsv, yieldToPage } from "./scene-performance.js?v=20260907a";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { createEarthModel } from "./orbit-scene.js?v=20260907a";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Straight from the design tokens in css/style.css, same subset
// js/system-scene.js keeps — this file is too small to import across
// modules for a handful of hex literals, so it carries its own copy.
const CARBON = 0x1d1a18;
const ASH = 0x3d3a39;
const GRAPHITE = 0x4d4947;
const WARM_GRANITE = 0x8a8380;
const BONE = 0xeeeeee;

// Real/simulation reference colours (see file header) — not from the site
// palette, used only for the axis/nadir HUD overlay on this one scene.
const AXIS_COLORS = { x: "#e74c3c", y: "#2ecc71", z: "#3498db" };
const NADIR_COLOR = "#1abc9c";
const CHART_COLORS = ["#e74c3c", "#2ecc71", "#3498db", "#c9b46a"];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- flat per-vertex banded shading — see js/system-scene.js's own copy
// for the full rationale (kept in sync there).
const FILL_STEPS = [WARM_GRANITE, GRAPHITE, ASH, CARBON];
const FILL_ALPHA_STEPS = [0.5, 0.34, 0.22, 0.14];
const FILL_LIGHT = new THREE.Vector3(0.42, 0.82, 0.45).normalize();

function shadeByNormal(geometry) {
  const normals = geometry.getAttribute("normal");
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
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function edgeMaterial(color = BONE, opacity = 1) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity });
}

const EDGE_CLEAN = 32;
function solidPart(geometry, tint, edgeAngle = 1) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shadeByNormal(geometry.clone()), fillMaterial(tint)));
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle), edgeMaterial()));
  return group;
}

function thinLine(a, b, color, opacity = 1) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), edgeMaterial(color, opacity));
}

// A small always-camera-facing text label (three.js Sprite from a canvas
// texture) — position inherits from its parent (so an axis-tip label
// mounted on the body rotates with it), but a Sprite's own orientation
// always faces the camera regardless of parent rotation, so the text stays
// legible through the whole animation without any per-frame math.
function makeLabel(text, color) {
  const fontSize = 48;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `600 ${fontSize}px 'JetBrains Mono', ui-monospace, monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  const h = Math.ceil(fontSize * 1.5);
  canvas.width = w;
  canvas.height = h;
  ctx.font = `600 ${fontSize}px 'JetBrains Mono', ui-monospace, monospace`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  // World-units per texture pixel. UNVERIFIED against an actual render —
  // sized so "NADIR" (the longest label) comes out to roughly a fifth of
  // AXIS_LEN (1.1), small relative to the ~1-unit bus rather than dominating
  // it; check this by eye and retune if it reads too big or too small.
  const SCALE = 0.003;
  sprite.scale.set(w * SCALE, h * SCALE, 1);
  return sprite;
}


// Binary-search the sample bracketing t, return interpolation fraction and
// the count of samples at-or-before t (for the charts' "drawn so far" cut).
function findFrame(t, tv) {
  const n = t.length;
  if (tv <= t[0]) return { i0: 0, i1: 0, frac: 0 };
  if (tv >= t[n - 1]) return { i0: n - 1, i1: n - 1, frac: 0 };
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tv) lo = mid;
    else hi = mid;
  }
  return { i0: lo, i1: hi, frac: (tv - t[lo]) / (t[hi] - t[lo]) };
}

// --------------------------------------------------------------------------
// Live SVG line chart: axes/ticks built once, four polylines redrawn each
// tick to include only samples up to the current time — the "line drawing
// itself" effect, sharing the same clock as the 3D scene rather than a
// separately-timed animation.
// --------------------------------------------------------------------------
const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_W = 600,
  CHART_H = 300;
const CHART_MARGIN = { l: 68, r: 20, t: 14, b: 30 };
let chartId = 0;

function buildChart(container, t, seriesArrays, title, colors = CHART_COLORS) {
  const tMax = t[t.length - 1];
  const plotW = CHART_W - CHART_MARGIN.l - CHART_MARGIN.r;
  const plotH = CHART_H - CHART_MARGIN.t - CHART_MARGIN.b;
  function rangeThrough(lastIndex) {
    let lo = Infinity, hi = -Infinity;
    seriesArrays.forEach((series) => {
      for (let i = 0; i <= lastIndex; i++) {
        lo = Math.min(lo, series[i]);
        hi = Math.max(hi, series[i]);
      }
    });
    const pad = (hi - lo) * 0.08 || 50;
    return { lo: lo - pad, hi: hi + pad };
  }
  const earlyRange = rangeThrough(findFrame(t, T_SPLIT_SIM).i1);
  const fullRange = rangeThrough(t.length - 1);
  const fullSpan = fullRange.hi - fullRange.lo;
  const earlyScaleY = fullSpan / (earlyRange.hi - earlyRange.lo);
  const bottom = CHART_MARGIN.t + plotH;
  const earlyOffsetY = bottom + (earlyRange.lo - fullRange.lo) * plotH / (earlyRange.hi - earlyRange.lo);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title);
  svg.style.fontFamily = "'JetBrains Mono', ui-monospace, monospace";

  // Draw every series once and reveal it with one shared clip rectangle. The
  // old update rebuilt four increasingly long point strings several times a
  // second, doing thousands of number formats and DOM attribute replacements.
  const clipName = `cmg-chart-clip-${++chartId}`;
  const defs = document.createElementNS(SVG_NS, "defs");
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipName);
  const clipRect = document.createElementNS(SVG_NS, "rect");
  clipRect.setAttribute("x", CHART_MARGIN.l);
  clipRect.setAttribute("y", CHART_MARGIN.t);
  clipRect.setAttribute("width", "0");
  clipRect.setAttribute("height", plotH);
  clip.appendChild(clipRect);
  defs.appendChild(clip);
  svg.appendChild(defs);

  function line(x1, y1, x2, y2, color) {
    const el = document.createElementNS(SVG_NS, "line");
    el.setAttribute("x1", x1);
    el.setAttribute("y1", y1);
    el.setAttribute("x2", x2);
    el.setAttribute("y2", y2);
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", "1");
    svg.appendChild(el);
    return el;
  }
  function text(x, y, str, anchor) {
    const el = document.createElementNS(SVG_NS, "text");
    el.setAttribute("x", x);
    el.setAttribute("y", y);
    el.setAttribute("text-anchor", anchor);
    el.setAttribute("font-size", "12");
    el.setAttribute("fill", "#b8b3b0");
    el.textContent = str;
    svg.appendChild(el);
    return el;
  }

  line(CHART_MARGIN.l, CHART_MARGIN.t, CHART_MARGIN.l, CHART_MARGIN.t + plotH, "#3d3a39");
  line(CHART_MARGIN.l, CHART_MARGIN.t + plotH, CHART_MARGIN.l + plotW, CHART_MARGIN.t + plotH, "#3d3a39");

  const yLabels = Array.from({ length: 5 }, (_, i) => {
    const yy = bottom - (i / 4) * plotH;
    line(CHART_MARGIN.l - 4, yy, CHART_MARGIN.l, yy, "#3d3a39");
    return text(CHART_MARGIN.l - 8, yy + 3, "", "end");
  });
  const xLabels = Array.from({ length: 6 }, (_, i) => {
    const xx = CHART_MARGIN.l + (i / 5) * plotW;
    line(xx, CHART_MARGIN.t + plotH, xx, CHART_MARGIN.t + plotH + 4, "#3d3a39");
    return text(xx, CHART_MARGIN.t + plotH + 16, "", i === 5 ? "end" : "middle");
  });
  const xTitle = text(CHART_MARGIN.l + plotW / 2, CHART_H - 4, "time (s)", "middle");

  // One set of points survives the entire loop. Scale about the left edge,
  // with clipping in screen coordinates and constant stroke thickness.
  const clipped = document.createElementNS(SVG_NS, "g");
  clipped.setAttribute("clip-path", `url(#${clipName})`);
  const traces = document.createElementNS(SVG_NS, "g");
  clipped.appendChild(traces);
  svg.appendChild(clipped);

  seriesArrays.forEach((series, i) => {
    const el = document.createElementNS(SVG_NS, "polyline");
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", colors[i]);
    el.setAttribute("stroke-width", "1.4");
    el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("vector-effect", "non-scaling-stroke");
    let points = "";
    for (let k = 0; k < t.length; k++) {
      points += `${((t[k] / tMax) * plotW).toFixed(6)},${(-((series[k] - fullRange.lo) / fullSpan) * plotH).toFixed(6)} `;
    }
    el.setAttribute("points", points);
    traces.appendChild(el);
  });
  const nowLine = line(CHART_MARGIN.l, CHART_MARGIN.t, CHART_MARGIN.l, CHART_MARGIN.t + plotH, "#8a8380");
  nowLine.setAttribute("stroke-dasharray", "2,2");

  container.replaceChildren(svg);

  let lastZoom = -1;
  let scaleX = 1;
  return function update(simTime, zoom = simTime <= T_SPLIT_SIM ? 0 : 1) {
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      const eased = zoom * zoom * (3 - 2 * zoom);
      scaleX = (tMax / T_SPLIT_SIM) * (1 - eased) + eased;
      const scaleY = earlyScaleY * (1 - eased) + eased;
      const offsetY = earlyOffsetY * (1 - eased) + bottom * eased;
      traces.setAttribute("transform", `translate(${CHART_MARGIN.l} ${offsetY}) scale(${scaleX} ${scaleY})`);
      const yLo = fullRange.lo + (offsetY - bottom) * fullSpan / (plotH * scaleY);
      const ySpan = fullSpan / scaleY;
      yLabels.forEach((label, i) => {
        label.textContent = (yLo + (i / 4) * ySpan).toLocaleString(undefined, { maximumFractionDigits: 1 });
      });
      xLabels.forEach((label, i) => {
        label.textContent = (zoom === 1 ? i * 3 : (i / 5) * tMax / scaleX)
          .toLocaleString(undefined, { maximumFractionDigits: 1 });
      });
      xTitle.textContent = zoom === 1 ? "orbits" : "time (s)";
    }
    const xx = CHART_MARGIN.l + clamp((simTime / tMax) * scaleX, 0, 1) * plotW;
    clipRect.setAttribute("width", Math.max(0, xx - CHART_MARGIN.l));
    nowLine.setAttribute("x1", xx);
    nowLine.setAttribute("x2", xx);
  };
}

// Keep the original slow rate (35 simulation seconds per 8 playback seconds)
// through the first 100 s, covering retargeting and the subsequent settling.
// Both plots retain their 0–100 s window until this slow segment ends.
const T_SPLIT_SIM = 100;
const DUR_SLOW = T_SPLIT_SIM * (8 / 35); // about 22.9 wall-clock seconds
const DUR_FAST = 45 * 1.5; // RW playback at two-thirds of its previous speed
const CHART_ZOOM_SECONDS = 2;
const LOOP_SECONDS = DUR_SLOW + CHART_ZOOM_SECONDS + DUR_FAST;
const END_HOLD_SECONDS = 1;

// wallT in [0, LOOP_SECONDS] -> real sim time, piecewise-linear per above.
function simTimeFromWall(wallT, tMax) {
  if (wallT <= DUR_SLOW) return (wallT / DUR_SLOW) * T_SPLIT_SIM;
  if (wallT <= DUR_SLOW + CHART_ZOOM_SECONDS) return T_SPLIT_SIM;
  const frac = (wallT - DUR_SLOW - CHART_ZOOM_SECONDS) / DUR_FAST;
  return T_SPLIT_SIM + frac * (tMax - T_SPLIT_SIM);
}

function playbackTime(elapsedSeconds, tMax) {
  const phase = elapsedSeconds % (LOOP_SECONDS + END_HOLD_SECONDS);
  return simTimeFromWall(Math.min(phase, LOOP_SECONDS), tMax);
}

function chartZoomFromWall(elapsedSeconds) {
  const phase = elapsedSeconds % (LOOP_SECONDS + END_HOLD_SECONDS);
  return clamp((phase - DUR_SLOW) / CHART_ZOOM_SECONDS, 0, 1);
}

export async function initCmgScene({ canvas, dataUrl, offDataUrl, chartOnEl, chartOffEl, chartGimbalEl, chartSingularityEl, chartTorqueEl, hudEl }) {
  if (!canvas) return;

  const [rawData, rawOffData] = await Promise.all([loadCsv(dataUrl), loadCsv(offDataUrl)]);
  // The new MATLAB exports use SI units and contain all diagnostics on one
  // time grid. Keep the visual's existing km and RPM readouts at this boundary.
  const data = { ...rawData }, offData = { ...rawOffData };
  if (rawData.omega_fw1) {
    for (const axis of ["rx", "ry", "rz"]) data[axis] = rawData[axis].map((v) => v / 1000);
    for (let k = 1; k <= 4; k++) {
      data[`Omega${k}`] = rawData[`omega_fw${k}`].map((v) => v * 60 / (2 * Math.PI));
      offData[`Omega${k}`] = rawOffData[`omega_fw${k}`].map((v) => v * 60 / (2 * Math.PI));
    }
  }
  const t = data.t;
  const tMax = t[t.length - 1];

  const onSeries = [1, 2, 3, 4].map((k) => data[`Omega${k}`]);
  const offSeries = [1, 2, 3, 4].map((k) => offData[`Omega${k}`]);
  const updateChartOn = chartOnEl ? buildChart(chartOnEl, t, onSeries, "Flywheel speed, MTQ desaturation on") : null;
  await yieldToPage();
  const updateChartOff = chartOffEl ? buildChart(chartOffEl, offData.t, offSeries, "Flywheel speed, MTQ desaturation off") : null;
  await yieldToPage();
  const diagnosticUpdates = [];
  if (chartGimbalEl && rawData.delta_dot1) {
    diagnosticUpdates.push(buildChart(chartGimbalEl, t,
      [1, 2, 3, 4].map((k) => rawData[`delta_dot${k}`]), "Gimbal rates versus time, radians per second"));
    await yieldToPage();
  }
  if (chartSingularityEl && rawData.S_RW && rawData.S_CMG) {
    diagnosticUpdates.push(buildChart(chartSingularityEl, t,
      [rawData.S_RW, rawData.S_CMG], "S_RW and S_CMG singularity parameters versus time", ["#64ffe1", "#c9b46a"]));
    await yieldToPage();
  }
  if (chartTorqueEl && rawData.tau_dist_x && rawData.tau_mtq_x) {
    const magnitude = (prefix) => t.map((_, i) =>
      Math.hypot(rawData[`${prefix}_x`][i], rawData[`${prefix}_y`][i], rawData[`${prefix}_z`][i]) * 1e6);
    diagnosticUpdates.push(buildChart(chartTorqueEl, t,
      [magnitude("tau_dist"), magnitude("tau_mtq")], "Disturbance and MTQ torque magnitudes versus time, micronewton meters", ["#c9b46a", "#64ffe1"]));
    await yieldToPage();
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  // Box half-diagonal is ~1.03 units and the axis/nadir indicators reach
  // ~1.3 — at this 32deg FOV that needs distance >~5.9 to clear all of it at
  // any rotation (half-frustum height = dist*tan(16deg)).
  const CAM_DIST = 6.2;
  camera.position.set(0, 0, CAM_DIST);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !LOW_POWER,
    alpha: true,
    powerPreference: "default",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const budget = createRenderBudget(1000000, 1.4);
  const pixelRatioFor = (w, h) => budget.ratio(w, h);

  // ---- the bus: real 12U proportions (240 x 230 x 360mm), long axis local Z.
  const bodyGroup = new THREE.Group();
  bodyGroup.add(solidPart(new THREE.BoxGeometry(1.0, 0.958, 1.5), 0xffffff, EDGE_CLEAN));

  // ---- body axes, real/simulation colours + labels (see file header).
  const AXIS_LEN = 1.1;
  [
    { dir: new THREE.Vector3(AXIS_LEN, 0, 0), color: AXIS_COLORS.x, label: "X_B" },
    { dir: new THREE.Vector3(0, AXIS_LEN, 0), color: AXIS_COLORS.y, label: "Y_B" },
    { dir: new THREE.Vector3(0, 0, AXIS_LEN), color: AXIS_COLORS.z, label: "Z_B" },
  ].forEach(({ dir, color, label }) => {
    bodyGroup.add(thinLine(new THREE.Vector3(), dir, color));
    const sprite = makeLabel(label, color);
    sprite.position.copy(dir).multiplyScalar(1.12);
    bodyGroup.add(sprite);
  });

  scene.add(bodyGroup);

  // Exported ECI coordinates, with one Earth radius per scene unit. The
  // homepage Earth has procedural geography; its surface orientation is
  // illustrative, not an epoch-aligned geographic ground track.
  const EARTH_RADIUS_KM = 6371;
  const orbitScene = new THREE.Scene();
  const orbitCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);
  orbitCamera.up.set(0, 0, 1);
  // Slightly larger than the nominal unit sphere so the globe reads clearly
  // in the widened right rail while the LEO trajectory still clears its limb.
  const earth = await createEarthModel(renderer, 1.05);
  earth.planet.uniforms.uBrightness.value = 0.48;
  earth.clouds.uniforms.uFade.value = 0.45;
  earth.group.rotation.x = Math.PI / 2; // model north (+Y) -> ECI north (+Z)
  orbitScene.add(earth.group);

  const orbitPositions = new Float32Array(t.length * 3);
  let orbitExtent = 1;
  for (let i = 0; i < t.length; i++) {
    const x = data.rx[i] / EARTH_RADIUS_KM;
    const y = data.ry[i] / EARTH_RADIUS_KM;
    const z = data.rz[i] / EARTH_RADIUS_KM;
    orbitPositions[i * 3] = x;
    orbitPositions[i * 3 + 1] = y;
    orbitPositions[i * 3 + 2] = z;
    orbitExtent = Math.max(orbitExtent, Math.hypot(x, y, z));
  }
  // Keep only a small framing margin so the Earth fills the overview and the
  // gap before the aligned MTQ plot does not become visually empty.
  orbitExtent += 0.08;
  const trajectoryGeometry = new LineGeometry();
  trajectoryGeometry.setPositions(orbitPositions);
  const trajectoryMaterial = new LineMaterial({
    color: 0x9adbd4, linewidth: 2.2, transparent: true, opacity: 0.75, depthWrite: false,
  });
  orbitScene.add(new Line2(trajectoryGeometry, trajectoryMaterial));
  // The brighter trace grows with the charts and exposes the playback position.
  const travelledGeometry = trajectoryGeometry.clone();
  const travelledMaterial = new LineMaterial({
    color: 0x64ffe1, linewidth: 3.2, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const travelled = new Line2(travelledGeometry, travelledMaterial);
  orbitScene.add(travelled);
  // The same 12U bus as the close-up, enlarged for legibility while its
  // center follows the real orbit. Its attitude uses the same quaternion.
  const positionMarker = bodyGroup.children[0].clone();
  positionMarker.scale.setScalar(0.065);
  // Independent materials keep the close-up's original appearance intact.
  positionMarker.children[0].material = [0xe6d49d, 0xbda569, 0xf5e6bf, 0x9d8856, 0xd5bd80, 0xc8b175]
    .map((color) => new THREE.MeshBasicMaterial({ color }));
  orbitScene.add(positionMarker);
  const positionReticle = new THREE.Mesh(
    new THREE.RingGeometry(0.078, 0.088, 40),
    new THREE.MeshBasicMaterial({ color: 0x64ffe1, side: THREE.DoubleSide, depthWrite: false })
  );
  orbitScene.add(positionReticle);
  // Oblique perspective exposes depth and front/back occlusion. Dragging
  // changes only the observer's view, never the simulated coordinates.
  const firstDirection = orbitPoints[0].clone().normalize();
  const planeSample = orbitPoints.find((point) =>
    new THREE.Vector3().crossVectors(firstDirection, point.clone().normalize()).length() > 0.2);
  const orbitNormal = new THREE.Vector3().crossVectors(firstDirection, planeSample || orbitPoints[1]).normalize();
  orbitCamera.position.copy(orbitNormal).multiplyScalar(3).addScaledVector(firstDirection, 4);
  orbitCamera.lookAt(0, 0, 0);
  const orbitControls = new OrbitControls(orbitCamera, canvas.parentElement.querySelector(".cmg-orbit-controls"));
  orbitControls.enablePan = false;
  orbitControls.enableZoom = false;
  orbitControls.enableDamping = false;
  orbitControls.rotateSpeed = 0.65;

  // ---- nadir direction — real orbital position, inertial/world frame (NOT
  // a child of bodyGroup, same as the body-fixed axes above vs. the
  // reference animate_satellite.m's fixed-frame nadir arrow).
  const NADIR_LEN = 1.3;
  const nadirArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, 0),
    NADIR_LEN,
    NADIR_COLOR,
    0.06,
    0.035
  );
  scene.add(nadirArrow);
  const nadirLabel = makeLabel("NADIR", NADIR_COLOR);
  scene.add(nadirLabel);

  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  const rVec = new THREE.Vector3();

  function update(simTime) {
    const { i0, i1, frac } = findFrame(t, simTime);

    q0.set(data.Ex[i0], data.Ey[i0], data.Ez[i0], data.n[i0]);
    q1.set(data.Ex[i1], data.Ey[i1], data.Ez[i1], data.n[i1]);
    bodyGroup.quaternion.copy(q0).slerp(q1, frac);

    const rx = data.rx[i0] + (data.rx[i1] - data.rx[i0]) * frac;
    const ry = data.ry[i0] + (data.ry[i1] - data.ry[i0]) * frac;
    const rz = data.rz[i0] + (data.rz[i1] - data.rz[i0]) * frac;
    positionMarker.position.set(rx, ry, rz).divideScalar(EARTH_RADIUS_KM);
    positionMarker.quaternion.copy(bodyGroup.quaternion);
    positionReticle.position.copy(positionMarker.position);
    travelledGeometry.instanceCount = i0;
    rVec.set(rx, ry, rz).normalize().negate();
    nadirArrow.setDirection(rVec);
    nadirLabel.position.copy(rVec).multiplyScalar(NADIR_LEN + 0.15);
  }

  // ---- position/time HUD (see file header — Krittin: "add satellite
  // location label of xyz"). Real ECI position, same km units web_export.m
  // exported; throttled with the charts since text doesn't need 60fps.
  function updateHud(simTime) {
    if (!hudEl) return;
    const { i0, i1, frac } = findFrame(t, simTime);
    const rx = data.rx[i0] + (data.rx[i1] - data.rx[i0]) * frac;
    const ry = data.ry[i0] + (data.ry[i1] - data.ry[i0]) * frac;
    const rz = data.rz[i0] + (data.rz[i1] - data.rz[i0]) * frac;
    hudEl.textContent =
      `ECI · t = ${simTime.toFixed(1)} s\n` +
      `X ${rx.toFixed(1).padStart(9)} km\n` +
      `Y ${ry.toFixed(1).padStart(9)} km\n` +
      `Z ${rz.toFixed(1).padStart(9)} km`;
  }

  // Two scissored views share one WebGL context and the same simulation clock.
  let views = [];
  let shadersReady = false;
  let canvasVisible = !("IntersectionObserver" in window);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      canvasVisible = entries[entries.length - 1].isIntersecting;
      if (canvasVisible) renderViews();
    }).observe(canvas);
  }
  function renderViews() {
    if (!shadersReady || !canvasVisible || document.hidden) return;
    // Both views use the same ECI camera basis. Recenter the close-up on
    // the bus while preserving the orbit camera's orientation, so -r (nadir)
    // has the same screen direction as satellite -> Earth in the overview.
    // Apply before every render, including first paint, resize and dragging.
    // Keep the exported attitude intact: +Y_B slews toward nadir in this run.
    camera.quaternion.copy(orbitCamera.quaternion);
    camera.up.copy(orbitCamera.up);
    camera.position.set(0, 0, CAM_DIST / Math.min(1, camera.aspect))
      .applyQuaternion(orbitCamera.quaternion);
    positionReticle.quaternion.copy(orbitCamera.quaternion);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    for (const view of views) {
      renderer.setViewport(view.x, view.y, view.w, view.h);
      renderer.setScissor(view.x, view.y, view.w, view.h);
      renderer.render(view.scene, view.camera);
    }
    renderer.setScissorTest(false);
  }

  // ---- resize: the canvas fills whatever box style.css gives it
  // (.detail-media-inner), same approach as js/system-scene.js's resize().
  function resize() {
    const w = canvas.clientWidth;
    const stacked = canvas.dataset.layout === "stacked" || w <= 680;
    canvas.parentElement.classList.toggle("cmg-animation--stacked", stacked);
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const contentH = h - 110;
    const panelH = stacked ? contentH / 2 : contentH;
    const viewH = panelH - 56;
    const orbitW = stacked ? w : Math.floor(w * 0.60);
    const attitudeW = stacked ? w : w - orbitW;
    trajectoryMaterial.resolution.set(orbitW, viewH);
    travelledMaterial.resolution.set(orbitW, viewH);
    camera.aspect = attitudeW / viewH;
    // Fit the full axes at narrow widths as well as in the desktop split.
    camera.position.setLength(CAM_DIST / Math.min(1, camera.aspect));
    camera.updateProjectionMatrix();
    orbitCamera.aspect = orbitW / viewH;
    const limitingAngle = Math.atan(Math.tan(19 * Math.PI / 180) * Math.min(1, orbitCamera.aspect));
    orbitCamera.position.setLength(orbitExtent / Math.sin(limitingAngle));
    orbitCamera.updateProjectionMatrix();
    orbitControls.update();
    // In the thesis composition the close-up occupies the upper half and the
    // Earth/orbit overview the lower half, so the satellite is visibly on top
    // of Earth in the right-hand rail.
    views = [
      { scene, camera, x: stacked ? 0 : orbitW, y: stacked ? h - panelH : h - panelH, w: attitudeW, h: viewH },
      { scene: orbitScene, camera: orbitCamera, x: 0, y: stacked ? 110 : h - panelH, w: orbitW, h: viewH },
    ];
    renderer.setPixelRatio(pixelRatioFor(w, h));
    renderer.setSize(w, h, false);
    renderViews();
  }

  await prepareShaders(renderer, scene, camera);
  await prepareShaders(renderer, orbitScene, orbitCamera);
  shadersReady = true;
  update(0); // settle to a pose before the first paint either way
  updateChartOn && updateChartOn(0);
  updateChartOff && updateChartOff(0);
  diagnosticUpdates.forEach((updateChart) => updateChart(0));
  updateHud(0);
  resize();
  window.addEventListener("resize", resize);
  // The canvas no longer has a fixed height on thesis.html — it fills the two
  // grid rows it spans, so a webfont landing or a chart's SVG being inserted
  // changes it with no window resize to hear about. Watch the element itself.
  // `setSize(w, h, false)` never writes the canvas's CSS size back, so this
  // cannot feed itself.
  if ("ResizeObserver" in window) new ResizeObserver(() => resize()).observe(canvas);
  // Direct redraw also keeps dragging usable with reduced motion enabled.
  orbitControls.addEventListener("change", renderViews);

  // Static settle, no loop — same rule every scene on this site follows.
  if (REDUCED) return;

  let visible = false;
  let lastChartUpdate = 0;
  let previousTick = null;
  let elapsedSeconds = 0;
  let previousSimTime = 0;
  let previousZoom = 0;

  function tick(now) {
    // Start at zero when first visible and pause the clock offscreen.
    if (previousTick !== null) elapsedSeconds += (now - previousTick) / 1000;
    previousTick = now;
    const simTime = playbackTime(elapsedSeconds, tMax);
    const chartZoom = chartZoomFromWall(elapsedSeconds);
    const zoomChanged = chartZoom !== previousZoom;
    previousZoom = chartZoom;
    const chartBoundary = simTime < previousSimTime ||
      (previousSimTime <= T_SPLIT_SIM && simTime > T_SPLIT_SIM) ||
      (previousSimTime < tMax && simTime === tMax);
    const poseChanged = simTime !== previousSimTime;
    previousSimTime = simTime;

    if (poseChanged) {
      update(simTime);
      renderViews();
    }

    // Animate the scale transition at the scene's 30 Hz, then return to the
    // inexpensive chart/HUD cadence. The series points are never rebuilt.
    if (chartBoundary || zoomChanged || now - lastChartUpdate > 160) {
      lastChartUpdate = now;
      updateChartOn && updateChartOn(simTime, chartZoom);
      updateChartOff && updateChartOff(simTime, chartZoom);
      diagnosticUpdates.forEach((updateChart) => updateChart(simTime, chartZoom));
      updateHud(simTime);
    }
  }
  const loop = createFrameLoop(tick, {
    fps: LOW_POWER ? 20 : 30,
    onSlow: () => { budget.reduce(); resize(); },
  });
  const start = () => loop.start();
  function stop() {
    previousTick = null;
    loop.stop();
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
    // Charts now continue down a side column. Keep their shared clock active
    // while any part of the thesis workspace is visible, not just the canvas.
    io.observe(canvas.closest(".thesis-workspace") || canvas);
  } else {
    visible = true;
    start();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (visible) start();
  });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", () => { if (visible) start(); });
}
