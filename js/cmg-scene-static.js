// --------------------------------------------------------------------------
// thesis.html's CMG animation, old-browser fallback.
//
// cmg-scene.js imports OrbitControls/Line2/LineGeometry/LineMaterial from
// three.js's examples/jsm addons, and its own createEarthModel (from
// orbit-scene.js) needs the OrbitControls addon too — every one of those
// addon FILES contains its own internal `import * as THREE from "three"`, a
// bare specifier that only resolves through <script type="importmap">, which
// Safari didn't support before 16.4 (Mar 2023). An iPad frozen on an older
// iPadOS can't run any of that at all: the import throws and the whole
// module — animation AND the five charts it also draws — never loads.
//
// Krittin: "for older and unsupported browsers make the plot static and no
// need animation for satellite and earth as well just make it shows up as
// static". This file is that fallback. It imports ONLY three.js's core
// build, by its absolute CDN URL — no addons, no bare specifiers, no import
// map needed, so it loads on any browser that runs ES modules at all (Safari
// since 2017). It draws the real charts (via cmg-charts.js, itself
// three.js-free) and ONE real frame of the actual simulation data — the run's
// settled end state, not a fabricated scene — with no animation loop and no
// drag interaction.
//
// The small model-building helpers below are copied from cmg-scene.js rather
// than shared with it: a shared file would import three.js itself, and
// whichever of the two callers didn't already have a THREE in scope would
// end up loading a SECOND, separate three.js instance alongside the
// addon-resolved one — worse than a little duplication.
// --------------------------------------------------------------------------

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.min.js";
import { loadNumericCsv as loadCsv } from "./scene-performance.js?v=20260907a";
import { buildChart } from "./cmg-charts.js?v=20260907a";

const COMPACT_LAYOUT = window.matchMedia("(max-width: 1239px), (hover: none) and (max-width: 1400px)");

const CARBON = 0x1d1a18;
const ASH = 0x3d3a39;
const GRAPHITE = 0x4d4947;
const WARM_GRANITE = 0x8a8380;
const BONE = 0xeeeeee;
const AXIS_COLORS = { x: "#e74c3c", y: "#2ecc71", z: "#3498db" };
const NADIR_COLOR = "#1abc9c";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- flat per-vertex banded shading — see js/system-scene.js / cmg-scene.js.
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

// Same always-camera-facing canvas-texture label as cmg-scene.js's makeLabel.
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
  const SCALE = 0.003;
  sprite.scale.set(w * SCALE, h * SCALE, 1);
  return sprite;
}

const EARTH_RADIUS_KM = 6371;

export async function initCmgSceneStatic({ canvas, dataUrl, offDataUrl, chartOnEl, chartOffEl, chartGimbalEl, chartSingularityEl, chartTorqueEl, hudEl }) {
  if (!canvas) return;

  const [rawData, rawOffData] = await Promise.all([loadCsv(dataUrl), loadCsv(offDataUrl)]);
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

  // Static: every chart drawn once at its full, final range — no time-cursor,
  // no clip-in animation. (tMax, 1) is buildChart's own "fully zoomed out,
  // fully drawn" state.
  const onSeries = [1, 2, 3, 4].map((k) => data[`Omega${k}`]);
  const offSeries = [1, 2, 3, 4].map((k) => offData[`Omega${k}`]);
  if (chartOnEl) buildChart(chartOnEl, t, onSeries, "Flywheel speed, MTQ desaturation on")(tMax, 1);
  if (chartOffEl) buildChart(chartOffEl, offData.t, offSeries, "Flywheel speed, MTQ desaturation off")(tMax, 1);
  if (chartGimbalEl && rawData.delta_dot1) {
    buildChart(chartGimbalEl, t, [1, 2, 3, 4].map((k) => rawData[`delta_dot${k}`]),
      "Gimbal rates versus time, radians per second")(tMax, 1);
  }
  if (chartSingularityEl && rawData.S_RW && rawData.S_CMG) {
    buildChart(chartSingularityEl, t, [rawData.S_RW, rawData.S_CMG],
      "S_RW and S_CMG singularity parameters versus time", ["#64ffe1", "#c9b46a"])(tMax, 1);
  }
  if (chartTorqueEl && rawData.tau_dist_x && rawData.tau_mtq_x) {
    const magnitude = (prefix) => t.map((_, i) =>
      Math.hypot(rawData[`${prefix}_x`][i], rawData[`${prefix}_y`][i], rawData[`${prefix}_z`][i]) * 1e6);
    buildChart(chartTorqueEl, t, [magnitude("tau_dist"), magnitude("tau_mtq")],
      "Disturbance and MTQ torque magnitudes versus time, micronewton meters", ["#c9b46a", "#64ffe1"])(tMax, 1);
  }

  // ---- one static frame of the real 3D scene, at the run's settled end
  // state (last sample) — matching the thesis's own real finding ("flywheel
  // speed converges back to its nominal operating point").
  const i = t.length - 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const CAM_DIST = 6.2;
  camera.position.set(0, 0, CAM_DIST); // default orientation looks down -Z, i.e. at the origin

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false; // manual clear below — see resize()

  const bodyGroup = new THREE.Group();
  bodyGroup.add(solidPart(new THREE.BoxGeometry(1.0, 0.958, 1.5), 0xffffff, EDGE_CLEAN));
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
  bodyGroup.quaternion.set(data.Ex[i], data.Ey[i], data.Ez[i], data.n[i]);
  scene.add(bodyGroup);

  const NADIR_LEN = 1.3;
  const rx = data.rx[i], ry = data.ry[i], rz = data.rz[i];
  const rVec = new THREE.Vector3(rx, ry, rz).normalize().negate();
  const nadirArrow = new THREE.ArrowHelper(rVec, new THREE.Vector3(0, 0, 0), NADIR_LEN, NADIR_COLOR, 0.06, 0.035);
  scene.add(nadirArrow);
  const nadirLabel = makeLabel("NADIR", NADIR_COLOR);
  nadirLabel.position.copy(rVec).multiplyScalar(NADIR_LEN + 0.15);
  scene.add(nadirLabel);

  // ---- orbit/Earth overview. A plain flat-shaded sphere stands in for the
  // hero's baked-shader globe (js/orbit-scene.js) — that pipeline needs the
  // OrbitControls addon to build, which is exactly what this file avoids.
  const orbitScene = new THREE.Scene();
  const orbitCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);
  orbitCamera.up.set(0, 0, 1);

  orbitScene.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 48, 32), new THREE.MeshBasicMaterial({ color: 0x2b4a63 })));
  orbitScene.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.SphereGeometry(1.052, 24, 16), 20),
    edgeMaterial(WARM_GRANITE, 0.35)
  ));

  const orbitPositions = [];
  let orbitExtent = 1;
  for (let k = 0; k < t.length; k++) {
    const p = new THREE.Vector3(data.rx[k], data.ry[k], data.rz[k]).divideScalar(EARTH_RADIUS_KM);
    orbitPositions.push(p);
    orbitExtent = Math.max(orbitExtent, p.length());
  }
  orbitExtent += 0.08;
  orbitScene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(orbitPositions),
    new THREE.LineBasicMaterial({ color: 0x64ffe1, transparent: true, opacity: 0.85 })
  ));

  const positionMarker = solidPart(new THREE.BoxGeometry(1.0, 0.958, 1.5), 0xe6d49d, EDGE_CLEAN);
  positionMarker.scale.setScalar(0.065);
  positionMarker.position.copy(orbitPositions[i]);
  positionMarker.quaternion.copy(bodyGroup.quaternion);
  orbitScene.add(positionMarker);
  const positionReticle = new THREE.Mesh(
    new THREE.RingGeometry(0.078, 0.088, 40),
    new THREE.MeshBasicMaterial({ color: 0x64ffe1, side: THREE.DoubleSide, depthWrite: false })
  );
  positionReticle.position.copy(positionMarker.position);
  orbitScene.add(positionReticle);

  // Fixed oblique viewing angle — same geometric idea as cmg-scene.js's own
  // camera placement, just never orbited afterward (no OrbitControls here).
  const firstDirection = orbitPositions[0].clone().normalize();
  let orbitNormal = new THREE.Vector3(0, 0, 1);
  for (let k = 1; k < orbitPositions.length; k++) {
    const cross = new THREE.Vector3().crossVectors(firstDirection, orbitPositions[k].clone().normalize());
    if (cross.lengthSq() > 0.04) {
      orbitNormal = cross.normalize();
      break;
    }
  }
  orbitCamera.position.copy(orbitNormal).multiplyScalar(3).addScaledVector(firstDirection, 4);
  orbitCamera.lookAt(0, 0, 0);

  if (hudEl) {
    hudEl.textContent =
      `ECI · t = ${t[i].toFixed(1)} s (settled)\n` +
      `X ${rx.toFixed(1).padStart(9)} km\n` +
      `Y ${ry.toFixed(1).padStart(9)} km\n` +
      `Z ${rz.toFixed(1).padStart(9)} km`;
  }

  // ---- resize + one render. No loop, no drag: this mirrors cmg-scene.js's
  // own prefers-reduced-motion branch ("static settle, no loop"), just
  // permanently rather than conditionally.
  function resize() {
    const w = canvas.clientWidth;
    const stacked = canvas.dataset.layout === "stacked" || w <= 680;
    canvas.parentElement.classList.toggle("cmg-animation--stacked", stacked);
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const hudSpace = COMPACT_LAYOUT.matches ? 0 : 110;
    const contentH = h - hudSpace;
    const panelH = stacked ? contentH / 2 : contentH;
    const viewH = panelH - 56;
    const orbitW = stacked ? w : Math.floor(w * 0.60);
    const attitudeW = stacked ? w : w - orbitW;
    camera.aspect = attitudeW / viewH;
    camera.updateProjectionMatrix();
    orbitCamera.aspect = orbitW / viewH;
    const limitingAngle = Math.atan(Math.tan(19 * Math.PI / 180) * Math.min(1, orbitCamera.aspect));
    orbitCamera.position.setLength(orbitExtent / Math.sin(limitingAngle));
    orbitCamera.updateProjectionMatrix();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
    renderer.setSize(w, h, false);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    const views = [
      { scene, camera, x: stacked ? 0 : orbitW, y: stacked ? h - panelH : h - panelH, w: attitudeW, h: viewH },
      { scene: orbitScene, camera: orbitCamera, x: 0, y: stacked ? hudSpace : h - panelH, w: orbitW, h: viewH },
    ];
    for (const view of views) {
      renderer.setViewport(view.x, view.y, view.w, view.h);
      renderer.setScissor(view.x, view.y, view.w, view.h);
      renderer.render(view.scene, view.camera);
    }
    renderer.setScissorTest(false);
  }

  resize();
  window.addEventListener("resize", resize);
  if ("ResizeObserver" in window) new ResizeObserver(() => resize()).observe(canvas);
}
