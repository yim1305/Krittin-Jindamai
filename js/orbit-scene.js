// ==========================================================================
// Home hero 3D scene.
//
//   - Solid, procedurally shaded Earth: blue oceans, green landmasses, ice
//     caps, a drifting cloud shell and a thin atmosphere rim. Continents are
//     generated in the fragment shader from domain-warped fBm value noise,
//     so there are no texture files to ship and it still reads as a planet
//     rather than a noise ball.
//   - A graticule (meridians/parallels + orange equator) is kept ON TOP of
//     the solid surface at low opacity so the globe still reads as an
//     instrument, not a stock 3D earth.
//   - A real 3D starfield sits behind everything and rotates with the
//     camera, which is what actually sells the depth when you drag.
//   - Drag orbits the camera; it keeps drifting slowly on its own when
//     you let go. Each cubesat runs its own orbit continuously.
//   - The scene is pinned across BOTH the hero and About, and the camera
//     descends from far orbit to a low pass as you scroll — at the bottom the
//     globe's limb lies across the foot of About as a horizon, with the
//     cubesats rising and setting behind it. Driven by window.__descentP,
//     which main.js publishes; see the descent block further down.
//   - Labels are plain HTML positioned every frame from the cubesat's real
//     3D position, so they stay upright and never distort.
//   - Everything animated here is skipped or frozen under
//     prefers-reduced-motion.
// ==========================================================================

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Straight from the design tokens in css/style.css — keep them in sync.
const CARBON = 0x1d1a18;
const ASH = 0x3d3a39;
const GRAPHITE = 0x4d4947;
const WARM_GRANITE = 0x8a8380;
const PALE_STONE = 0xb8b3b0;
const BONE = 0xeeeeee;
const ORANGE = 0xee6018;
const GREEN = 0xa0ca92;

const GLOBE_R = 1.5;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A DPR-only cap is misleading on laptop panels: 1440x900 at DPR 2 asks the
// integrated GPU to shade 5.2 million pixels every frame, while a larger HDMI
// monitor at DPR 1 may cost less than half as much. Keep the canvas crisp, but
// bound the actual framebuffer so high-density displays do not become the
// slowest way to view the site.
const MAX_RENDER_PIXELS = 2200000;
function renderPixelRatio(width, height, ceiling = 2) {
  const pixelBudgetRatio = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
  return Math.max(0.75, Math.min(window.devicePixelRatio || 1, ceiling, pixelBudgetRatio));
}

const SATELLITES = [
  { id: "home",       label: "home",              href: "#home",       radius: 1.95, tilt: -10, incl: 18,  speed: 0.13, phase: 150, color: GREEN  },
  { id: "about",      label: "about",             href: "#about",      radius: 2.35, tilt: 8,   incl: 12,  speed: 0.10, phase: 0,   color: ORANGE },
  { id: "experience", label: "experience",        href: "#experience", radius: 2.75, tilt: -22, incl: -20, speed: 0.07, phase: 95,  color: GREEN  },
  { id: "projects",   label: "projects & papers", href: "#projects",   radius: 3.15, tilt: 16,  incl: 30,  speed: 0.05, phase: 200, color: ORANGE },
];

// How far the constellation actually reaches, so the camera can be placed as
// close as possible — the globe should fill the frame, but nothing may leave
// it. Horizontal extent is just the orbit radius; vertical extent is smaller
// because the orbit planes are only tilted, never edge-on.
const MAX_ORBIT_R = Math.max(...SATELLITES.map((s) => s.radius));
const MAX_ORBIT_Y = Math.max(
  ...SATELLITES.map(({ radius, tilt, incl }) => {
    const t = (tilt * Math.PI) / 180;
    const i = (incl * Math.PI) / 180;
    return radius * Math.hypot(Math.sin(t), Math.sin(i) * Math.cos(t));
  })
);

// --------------------------------------------------------------------------
// Shared GLSL: 3D value noise + fBm. Cheap, dependency-free, and with one
// domain-warp pass the coastlines stop looking grid-aligned.
// --------------------------------------------------------------------------
const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p){
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
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
`;

// --------------------------------------------------------------------------
// Surface bake.
//
// The continent field costs ~24 fBm evaluations per fragment. Running that
// every frame across a full-screen globe is far too expensive on integrated
// graphics, so it's rendered ONCE into an equirectangular texture and then
// just sampled. RGB carries the surface albedo, A carries cloud density.
//
// The direction reconstruction below mirrors THREE.SphereGeometry's own UV
// convention exactly, so the bake lines up with the mesh with no seam.
// --------------------------------------------------------------------------
function bakeSurfaceTexture(renderer, width = 768) {
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

      // Discrete bands, not gradients. Posterising the elevation is what
      // makes this read as a chart of a planet rather than a photo of one,
      // which is the whole point of the house style.
      const float SEA = 0.524;

      void main(){
        float theta = (1.0 - vUv.y) * 3.14159265;
        float phi = vUv.x * 6.28318531;
        vec3 n = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));

        // Domain warp first, then sample elevation. The warp is what turns
        // blobby noise islands into something with plausible coastlines.
        vec3 warp = vec3(
          fbm(n * 2.1 + 13.7),
          fbm(n * 2.1 + 41.3),
          fbm(n * 2.1 + 67.9)
        ) - 0.5;
        float h = fbm(n * 2.6 + warp * 1.35);

        // --- ocean: three flat depth bands ---
        vec3 abyssal = vec3(0.063, 0.129, 0.176);
        vec3 basin   = vec3(0.106, 0.239, 0.322);
        vec3 shelf   = vec3(0.180, 0.376, 0.463);
        vec3 ocean = abyssal;
        ocean = mix(ocean, basin, step(0.400, h));
        ocean = mix(ocean, shelf, step(0.482, h));

        // --- land: three flat elevation bands, topping out at --green ---
        vec3 lowland  = vec3(0.290, 0.420, 0.310);
        vec3 midland  = vec3(0.427, 0.573, 0.408);
        vec3 highland = vec3(0.627, 0.792, 0.573);   // #a0ca92, the design green
        vec3 land = lowland;
        land = mix(land, midland,  step(0.575, h));
        land = mix(land, highland, step(0.640, h));

        vec3 base = mix(ocean, land, step(SEA, h));

        // --- coastline: the hairline rule, applied to the globe ---
        float coast = 1.0 - smoothstep(0.0, 0.0075, abs(h - SEA));
        base = mix(base, vec3(0.541, 0.678, 0.722), coast * 0.85);

        // --- ice caps: flat, hard-edged, with a hairline at the ice margin.
        // n.y is the cosine of the polar angle, so this threshold is a cap of
        // about 20° angular radius — keep it high, 0.8 gives a cap that
        // swallows a third of the globe.
        float polar = step(0.938, abs(n.y));
        float polarEdge = 1.0 - smoothstep(0.0, 0.010, abs(abs(n.y) - 0.938));
        base = mix(base, vec3(0.851, 0.855, 0.859), polar * 0.94);
        base = mix(base, vec3(0.678, 0.694, 0.706), polarEdge * 0.7);

        // Cloud density rides in the alpha channel — different noise
        // coordinates so the weather doesn't trace the coastlines. Quantised
        // to two flat levels so it reads as an overlay on a chart rather
        // than as volumetric cloud.
        float c = fbm(n * 3.4 + 91.2);
        float cloud = step(0.560, c) * 0.55 + step(0.625, c) * 0.45;

        gl_FragColor = vec4(base, cloud);
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

  return target.texture;
}

// --------------------------------------------------------------------------
// Planet surface and cloud shell share this pass-through vertex shader (both
// just need vUv/vWorldN for their fragment shader) and the same uSurface/
// uLight/uFade uniform shape — hoisted once rather than written out twice.
// --------------------------------------------------------------------------
const SURFACE_VERTEX_GLSL = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldN;
  void main(){
    vUv = uv;
    vWorldN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function surfaceUniforms(surfaceTex) {
  return {
    uSurface: { value: surfaceTex },
    uLight: { value: new THREE.Vector3(0.55, 0.42, 0.72).normalize() },
    uFade: { value: REDUCED ? 1 : 0 },
    uBrightness: { value: 1 },
  };
}

// --------------------------------------------------------------------------
// Planet surface — cheap now: one texture fetch plus lighting.
// --------------------------------------------------------------------------
function buildPlanet(surfaceTex) {
  const uniforms = surfaceUniforms(surfaceTex);

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: SURFACE_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSurface;
      uniform vec3 uLight;
      uniform float uFade;
      uniform float uBrightness;
      varying vec2 vUv;
      varying vec3 vWorldN;

      void main(){
        vec4 surf = texture2D(uSurface, vUv);
        vec3 N = normalize(vWorldN);
        vec3 L = normalize(uLight);

        // Terminator quantised into four flat steps. Smooth falloff and a
        // specular highlight both read as photography; stepped shading reads
        // as a contour chart, which is what the rest of the site looks like.
        // The bands are curves across the sphere, so they land as deliberate
        // structure rather than as banding artefacts.
        float day = smoothstep(-0.22, 0.44, dot(N, L));
        day = floor(day * 4.0 + 0.5) / 4.0;

        gl_FragColor = vec4(surf.rgb * (0.16 + 0.84 * day) * uBrightness, uFade);
      }
    `,
  });

  return { mesh: new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R, 96, 64), material), uniforms };
}

// Reuse the homepage's exact surface, clouds and grid in project scenes.
// This factory does not initialize the hero, its animation, or its controls.
export function createEarthModel(renderer, radius = 1) {
  const texture = bakeSurfaceTexture(renderer, 512);
  const planet = buildPlanet(texture);
  const clouds = buildClouds(texture);
  planet.uniforms.uFade.value = 1;
  clouds.uniforms.uFade.value = 1;
  // The project globe is fully visible from its first frame; make its surface
  // opaque so orbital paths and spacecraft behind it are properly occluded.
  planet.mesh.material.transparent = false;
  const group = new THREE.Group();
  group.scale.setScalar(radius / GLOBE_R);
  group.add(planet.mesh, clouds.mesh, buildGraticule(GLOBE_R * 1.004));
  return { group, planet, clouds };
}

// --------------------------------------------------------------------------
// Cloud shell — reads the alpha channel of the same bake. The mesh carries
// its own UVs, so rotating it drifts the weather over the surface.
// --------------------------------------------------------------------------
function buildClouds(surfaceTex) {
  const uniforms = surfaceUniforms(surfaceTex);

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
        // Flat --chalk at low opacity: a weather overlay on the chart, not
        // volumetric cloud. Two quantised levels come from the bake.
        float day = step(0.0, dot(normalize(vWorldN), normalize(uLight)));
        gl_FragColor = vec4(vec3(0.980, 0.980, 0.980), a * 0.15 * (0.25 + 0.75 * day) * uFade);
      }
    `,
  });

  return { mesh: new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 1.016, 64, 48), material), uniforms };
}

// --------------------------------------------------------------------------
// Limb ring.
//
// This replaced a fresnel atmosphere shell. A glow is exactly the effect the
// house style rules out, so the limb is marked with a hairline instead — the
// same 1px treatment every border on the site gets. The ring is billboarded
// to the camera and sits just outside the globe's apparent silhouette, so it
// reads as an instrument reticle around the planet.
// --------------------------------------------------------------------------
function buildLimbRing(radius, segments = 192) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(radius * Math.cos(t), radius * Math.sin(t), 0));
  }
  const material = new THREE.LineBasicMaterial({
    color: PALE_STONE, transparent: true, opacity: 0, depthWrite: false,
  });
  return {
    line: new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material),
    material,
  };
}

// The ring used to carry four orange cardinal ticks. They were removed at
// Krittin's request — the limb is a plain hairline now. Orange survives in the
// scene only on the equator ring and the cubesat status markers.

// --------------------------------------------------------------------------
// Graticule kept over the solid globe. depthTest on so the far side is
// correctly hidden by the planet; depthWrite off so the lines don't fight
// each other where they cross.
// --------------------------------------------------------------------------
function buildGraticule(radius) {
  const group = new THREE.Group();
  const gridMat = new THREE.LineBasicMaterial({
    color: PALE_STONE, transparent: true, opacity: 0.14, depthWrite: false,
  });
  const equatorMat = new THREE.LineBasicMaterial({
    color: ORANGE, transparent: true, opacity: 0.6, depthWrite: false,
  });

  // Build the neutral grid as one LineSegments geometry instead of nineteen
  // separate LineLoop draw calls. At hairline width, 64 segments per circle
  // remain visually smooth while substantially reducing vertices and draws.
  const SEG = 64;
  const gridPoints = [];
  const addLoop = (points) => {
    for (let i = 0; i < points.length - 1; i++) gridPoints.push(points[i], points[i + 1]);
  };
  const meridians = 12;
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

  const parallels = 8;
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

  const eqPts = [];
  for (let a = 0; a <= SEG; a++) {
    const t = (a / SEG) * Math.PI * 2;
    eqPts.push(new THREE.Vector3(radius * Math.cos(t), 0, radius * Math.sin(t)));
  }
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(eqPts), equatorMat));

  return group;
}

// --------------------------------------------------------------------------
// Starfield. Points on a big shell, three colour temperatures, per-star
// twinkle phase so they don't pulse in lockstep.
// --------------------------------------------------------------------------
function buildStarfield(count = 2200) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);

  const palette = [
    new THREE.Color(0xffffff),
    new THREE.Color(0xcfe0f5),
    new THREE.Color(0x9fb6d6),
    new THREE.Color(0xf2d9c2),
  ];

  for (let i = 0; i < count; i++) {
    // Uniform direction on the sphere, pushed out to a random shell radius.
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 42 + Math.random() * 34;

    positions[i * 3] = r * s * Math.cos(theta);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(theta);

    // Heavily skewed so most stars are faint and a few are bright.
    const mag = Math.pow(Math.random(), 3.2);
    sizes[i] = 0.8 + mag * 3.0;
    seeds[i] = Math.random();

    const c = palette[Math.random() < 0.72 ? 0 : 1 + Math.floor(Math.random() * 3)];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uFade: { value: REDUCED ? 1 : 0 },
    uPixelRatio: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vTwinkle;
      void main(){
        vColor = aColor;
        vTwinkle = 0.55 + 0.45 * sin(uTime * 0.7 + aSeed * 6.2831);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor;
      varying float vTwinkle;
      void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        float m = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(vColor, m * vTwinkle * uFade);
      }
    `,
  });

  return { points: new THREE.Points(geo, material), uniforms };
}

// --------------------------------------------------------------------------
// Cubesats
// --------------------------------------------------------------------------
function buildCubesat(color) {
  const group = new THREE.Group();

  // Flat per-face fills straight out of the site palette, rather than a lit
  // material. Smooth shading reads as a render; six fixed values read as a
  // technical illustration, which is the look everything else here has. The
  // faces still step light-to-dark top-to-bottom, so the form is legible
  // without any actual lighting — and being mid-greys rather than near-black
  // they no longer punch a hole through the planet behind them.
  // BoxGeometry group order is +X, -X, +Y, -Y, +Z, -Z.
  const FACES = [GRAPHITE, ASH, WARM_GRANITE, CARBON, GRAPHITE, ASH];
  const bodyGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  const bodyFill = new THREE.Mesh(
    bodyGeo,
    FACES.map((c) => new THREE.MeshBasicMaterial({ color: c }))
  );
  const bodyEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(bodyGeo),
    new THREE.LineBasicMaterial({ color: BONE })
  );
  group.add(bodyFill, bodyEdges);

  // Solar arrays: flat carbon fill, hairline outline, and two internal cell
  // dividers so they read as arrays instead of blank rectangles.
  const PANEL_W = 0.23;
  const PANEL_H = 0.13;
  const panelGeo = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
  const panelEdgeMat = new THREE.LineBasicMaterial({ color: BONE });
  const panelRuleMat = new THREE.LineBasicMaterial({ color: PALE_STONE, transparent: true, opacity: 0.45 });
  const panelFillMat = new THREE.MeshBasicMaterial({ color: CARBON, side: THREE.DoubleSide });

  const dividerPts = [];
  [-1, 1].forEach((k) => {
    const x = (k * PANEL_W) / 6;
    dividerPts.push(new THREE.Vector3(x, -PANEL_H / 2, 0), new THREE.Vector3(x, PANEL_H / 2, 0));
  });
  const dividerGeo = new THREE.BufferGeometry().setFromPoints(dividerPts);

  [-1, 1].forEach((side) => {
    const x = side * 0.29;
    const fill = new THREE.Mesh(panelGeo, panelFillMat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(panelGeo), panelEdgeMat);
    const rules = new THREE.LineSegments(dividerGeo, panelRuleMat);
    fill.position.x = x;
    edges.position.x = x;
    rules.position.x = x;
    group.add(fill, edges, rules);
  });

  // Antenna boom — a hairline, same as everything else.
  const boom = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.13, 0),
      new THREE.Vector3(0, 0.27, 0),
    ]),
    new THREE.LineBasicMaterial({ color: PALE_STONE })
  );
  group.add(boom);

  // The one saturated element, and it is a status indicator — which is the
  // only role orange and green are allowed to play in this system.
  const dot = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.05),
    new THREE.MeshBasicMaterial({ color })
  );
  dot.position.set(0, 0.29, 0);
  group.add(dot);

  return group;
}

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

// --------------------------------------------------------------------------
export function initOrbitScene({ canvas, labelLayer, displayFrameMs = 1000 / 60, onSelect, onTelemetry }) {
  const container = canvas.parentElement;
  const scene = new THREE.Scene();

  const displayHz = Math.max(30, Math.min(240, 1000 / displayFrameMs));
  const highDensityDesktop =
    window.innerWidth > 900 &&
    (window.devicePixelRatio || 1) > 1.25 &&
    window.matchMedia("(pointer: fine)").matches;

  // Use an integer number of display refreshes per rendered frame. This keeps
  // motion evenly paced: 120 Hz becomes 60, 144 Hz becomes 72, and 165 Hz
  // becomes 82.5. A 90 Hz panel stays at 90 instead of falling into the
  // visibly uneven ~45 Hz cadence produced by elapsed-time frame skipping.
  const frameDivisor = Math.max(1, Math.floor((displayHz + 1) / 60));
  const targetFrameMs = (1000 / displayHz) * frameDivisor;
  const targetFps = 1000 / targetFrameMs;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 1.1, 8);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    // Chromium can otherwise prefer the integrated low-power path even for
    // this site's full-screen interactive WebGL hero. This remains a hint;
    // browsers and single-GPU devices are free to ignore it.
    powerPreference: highDensityDesktop ? "high-performance" : "default",
  });
  renderer.setPixelRatio(renderPixelRatio(container.clientWidth, container.clientHeight));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.rotateSpeed = 0.55;
  controls.enablePan = false;
  controls.enableZoom = false;
  // Zoom is off, so these only need to be wide enough not to clamp the
  // arrival tween — OrbitControls re-clamps the radius on every update().
  controls.minDistance = 3;
  controls.maxDistance = 40;
  // Stop well short of the poles. Straight down the axis the graticule
  // collapses into a spiral, the ice cap fills the middle, and — because a
  // tilted camera projects an orbit at up to its full radius vertically
  // instead of MAX_ORBIT_Y — cubesats get pushed off the top of the frame.
  // ~25° of elevation either way is enough to feel free without costing any
  // globe size (fitDistance is bound by the horizontal fit, not this).
  // Named (and hoisted here from where they used to be declared, further
  // down) because applyDescent() eases the polar range back to these same
  // resting bounds — one pair of constants, not the same two literals twice.
  const REST_MIN_POLAR = Math.PI * 0.36;
  const REST_MAX_POLAR = Math.PI * 0.64;
  controls.minPolarAngle = REST_MIN_POLAR;
  controls.maxPolarAngle = REST_MAX_POLAR;
  controls.autoRotate = !REDUCED;
  controls.autoRotateSpeed = 0.22;

  // The procedural surface is baked once, but its shader is intentionally
  // expensive. 512x256 retains ample detail at the reduced high-DPI canvas
  // resolution and cuts this first-load GPU work by more than half.
  const surfaceTex = bakeSurfaceTexture(renderer, highDensityDesktop ? 512 : 768);
  const planet = buildPlanet(surfaceTex);
  const clouds = buildClouds(surfaceTex);
  const graticule = buildGraticule(GLOBE_R * 1.004);
  const stars = buildStarfield();

  // Comfortably outside the globe's apparent silhouette, which perspective
  // makes slightly larger than GLOBE_R at these camera distances.
  const limb = buildLimbRing(GLOBE_R * 1.075);
  if (REDUCED) {
    // The arrival tween is what normally fades this up.
    limb.material.opacity = 0.4;
  }

  // The planet, its clouds and its graticule share one spin axis, tilted
  // to roughly Earth's obliquity. The atmosphere shell stays put.
  const earth = new THREE.Group();
  earth.rotation.z = (-23.4 * Math.PI) / 180;
  earth.add(planet.mesh, graticule);

  const cloudSpinner = new THREE.Group();
  cloudSpinner.add(clouds.mesh);
  earth.add(cloudSpinner);

  // No lights in this scene at all: every material here is either a custom
  // shader or a flat MeshBasicMaterial, by design.
  scene.add(stars.points, earth, limb.line);

  const satellites = SATELLITES.map((cfg) => {
    const mesh = buildCubesat(cfg.color);
    mesh.userData.satId = cfg.id;
    scene.add(mesh);

    const labelEl = document.createElement("a");
    labelEl.className = "cubesat-label";
    labelEl.href = cfg.href;
    labelEl.innerHTML = `<span class="cl-name">${cfg.label}</span>`;
    labelEl.addEventListener("click", (e) => {
      e.preventDefault();
      onSelect && onSelect(cfg.id);
    });
    labelLayer.appendChild(labelEl);

    return { cfg, mesh, labelEl, scale: 1, anomaly: 0, half: { w: 0, h: 0 }, sx: 0, sy: 0 };
  });

  // Built once. The hover test raycasts against this every frame, and mapping
  // it there allocated a fresh array sixty times a second for no reason.
  const satMeshes = satellites.map((s) => s.mesh);

  // O(1) hit -> satellite lookup for the raycast below, instead of re-walking
  // every cubesat's ~10-node subtree (body, panels, edges, boom, dot) on every
  // hovered frame. Keyed by each descendant's own numeric `.id`, which is what
  // a raycast hit resolves to.
  const satByObjectId = new Map();
  satellites.forEach((s) => s.mesh.traverse((obj) => satByObjectId.set(obj.id, s)));

  function positionSatellite(sat, t, dt) {
    const { radius, tilt, incl, speed, phase } = sat.cfg;
    const deg = phase + t * speed * 40;
    sat.anomaly = ((deg % 360) + 360) % 360;

    const angle = (deg * Math.PI) / 180;
    const tiltRad = (tilt * Math.PI) / 180;
    const inclRad = (incl * Math.PI) / 180;

    let px = radius * Math.cos(angle);
    let py = 0;
    let pz = radius * Math.sin(angle);

    // inclination: rotate orbit plane about the x-axis
    const y2 = py * Math.cos(inclRad) - pz * Math.sin(inclRad);
    const z2 = py * Math.sin(inclRad) + pz * Math.cos(inclRad);
    py = y2; pz = z2;

    // tilt: rotate orbit plane about the z-axis
    const x3 = px * Math.cos(tiltRad) - py * Math.sin(tiltRad);
    const y3 = px * Math.sin(tiltRad) + py * Math.cos(tiltRad);
    px = x3; py = y3;

    sat.mesh.position.set(px, py, pz);
    if (!REDUCED) sat.mesh.rotation.y += 0.004 * dt * 60; // refresh-rate independent
  }

  // ---- pointer -----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  let pointerInside = false;
  let pointerDownPos = null;
  // Two independent hover sources: the 3D cubesat under the cursor, and its
  // HTML label (which sits in its own layer above the canvas). Either one
  // lighting up counts as hovering that satellite.
  //
  // Both are recomputed from the stored pointer position every frame rather
  // than driven by pointerenter/pointerleave on the labels. The labels move
  // under a stationary cursor, and browsers do not reliably re-fire
  // enter/leave for an element that moves itself — which left a label stuck
  // in the hovered state after it slid out from under the pointer.
  let canvasHoverId = null;
  let labelHoverId = null;
  let hoveredId = null;
  let cursorHoverId = null;
  const pointerLocal = { x: 0, y: 0 }; // container-relative

  function updatePointer(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerLocal.x = e.clientX - rect.left;
    pointerLocal.y = e.clientY - rect.top;
    pointerNDC.x = (pointerLocal.x / rect.width) * 2 - 1;
    pointerNDC.y = -(pointerLocal.y / rect.height) * 2 + 1;
  }

  function satFromObject(obj) {
    return satByObjectId.get(obj.id) || null;
  }

  // Shared by the click handler and the per-frame hover test below — both
  // just need "what satellite, if any, is under the pointer right now."
  function raycastSat() {
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(satMeshes, true);
    return hits.length ? satFromObject(hits[0].object) : null;
  }

  // Label widths only change when the font swaps in or the layout resizes,
  // so they're measured then rather than read every frame (reading offsetWidth
  // mid-loop would force a reflow, and the loop writes transforms).
  function measureLabels() {
    satellites.forEach((s) => {
      s.half.w = s.labelEl.offsetWidth / 2;
      s.half.h = s.labelEl.offsetHeight / 2;
    });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureLabels);
  measureLabels();

  // On the container, not the canvas: the labels sit above the canvas and
  // would otherwise swallow the move events over themselves.
  container.addEventListener("pointermove", (e) => {
    pointerInside = true;
    updatePointer(e);
  });
  container.addEventListener("pointerleave", () => {
    pointerInside = false;
    canvasHoverId = null;
    labelHoverId = null;
  });
  renderer.domElement.addEventListener("pointerdown", (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    pointerDownPos = null;
    if (Math.hypot(dx, dy) > 6) return; // treat as a drag, not a click

    updatePointer(e);
    const sat = raycastSat();
    if (sat) onSelect && onSelect(sat.cfg.id);
  });

  let autoRotateResume = null;
  controls.addEventListener("start", () => {
    renderer.domElement.classList.add("dragging");
    controls.autoRotate = false;
    if (autoRotateResume) clearTimeout(autoRotateResume);
  });
  controls.addEventListener("end", () => {
    renderer.domElement.classList.remove("dragging");
    if (REDUCED) return;
    // Let the damping settle before the idle drift picks back up, otherwise
    // the handoff reads as a jolt.
    autoRotateResume = setTimeout(() => { controls.autoRotate = true; }, 1400);
  });

  // The canvas now spans the whole hero, but the globe should still read as
  // sitting in the right two-thirds, clear of the text column. Rather than
  // shrinking the canvas (which is what used to slice cubesats in half), the
  // camera's frustum is offset so the scene centre lands at this fraction of
  // the width. Stacked layouts put it back in the middle.
  const SCENE_CENTER_WIDE = 0.68;
  const STACK_BREAKPOINT = 900;

  // ---- descent -------------------------------------------------------------
  // Driven by main.js through window.__descentP: 0 is the hero's far-orbit
  // framing, 1 is a low pass with the globe's limb lying across the foot of the
  // About section. See the .descent block in style.css for the pinning.
  //
  // The camera comes in to LOW_DISTANCE while the frustum pans down, until the
  // globe's apparent top edge — the horizon — sits on the HORIZON_Y row. The
  // pan is derived from the live distance and field of view rather than being a
  // magic pixel offset, so it lands on the same row at any window size.
  //
  // LOW_DISTANCE is not a free parameter. The outermost orbit is at 3.5, and
  // coming closer than this puts a cubesat's nearest pass right on top of the
  // camera. At 5.6 those near passes project BELOW the visible band (the pan
  // has put the globe's centre off the bottom of the screen), so the payloads
  // that cross the reading area are the ones on the far side of their orbits,
  // which stay small and sit behind the globe — they rise and set over the
  // horizon on their own, with no extra code.
  const LOW_DISTANCE = 5.6;
  // Row the globe's top edge — the horizon — settles on. Lower means more
  // planet on screen. It has to stay in step with --horizon-band in
  // style.css, which is the matching space reserved at the foot of About.
  const HORIZON_Y = 0.70;
  let descent = 0; // hero -> About: down to the horizon, and that is the end of it
  let rise = 0;    // px the globe has ridden up past that, straight off the scroll

  // There was a second leg that carried the camera on over the planet so the
  // next section arrived with its underside overhead. Krittin took it out. What
  // replaces it is not a camera move at all: past the horizon the frustum takes
  // `rise` — a pixel offset main.js reads directly off the scroll — and applies
  // it 1:1. The planet travels at exactly the speed of the page, so it reads as
  // part of the page rather than as a camera doing something of its own, and it
  // arrives at Experience with its underside across the top of the section.
  //
  // `rise` is deliberately NOT eased. Every other value here is, but a lag of
  // even a few frames on this one shows up as the globe sliding against the
  // content it is supposed to be locked to.

  // Vertical frustum shift, in pixels, that lands the globe's top edge on a
  // given row of the viewport, leaving the planet hanging below it.
  function horizonPan(distance, h) {
    const theta = Math.asin(Math.min(GLOBE_R / distance, 1)); // globe's angular radius
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);   // half-height at unit depth
    const edge = Math.atan((2 * HORIZON_Y - 1) * halfTan);    // angle of the target row
    return (Math.tan(edge + theta) / halfTan / 2) * h;
  }

  // Closest the camera can sit while the whole constellation still fits.
  // Recomputed on resize so a narrow viewport pulls back instead of cropping
  // the outer cubesats.
  let camDistance = 8;
  let viewW = 0;
  let viewH = 0;
  let stacked = false;
  const qualityKey = "krj-orbit-quality:" + (highDensityDesktop ? "hidpi" : "standard");
  // Preserve smooth 90 Hz motion by trading a little internal resolution for
  // the extra frames. The square root keeps total shaded pixels per second
  // close to the same budget as the 60 Hz path.
  let qualityScale = highDensityDesktop ? 0.8 * Math.min(1, Math.sqrt(60 / targetFps)) : 1;
  try {
    const remembered = Number(localStorage.getItem(qualityKey));
    if (Number.isFinite(remembered) && remembered >= 0.6 && remembered <= 1) {
      qualityScale = Math.min(qualityScale, remembered);
    }
  } catch (e) {
    /* Storage unavailable; adaptive quality still works for this visit. */
  }

  function rememberQuality() {
    try {
      localStorage.setItem(qualityKey, qualityScale.toFixed(3));
    } catch (e) {
      /* Storage unavailable. */
    }
  }

  function applyRenderQuality() {
    const pixelRatio = Math.max(0.75, renderPixelRatio(viewW, viewH) * qualityScale);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(viewW, viewH, false);
    stars.uniforms.uPixelRatio.value = pixelRatio;
  }

  function fitDistance(aspect, centerX) {
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    // Offsetting the centre to the right leaves less room on that side, and
    // that shorter side is what has to fit the outermost orbit.
    const rightRoom = (1 - centerX) / 0.5;
    // MAX_ORBIT_Y is measured at the resting elevation; tilting the camera
    // within the allowed polar range grows it. The margin covers that as well
    // as the label hanging ~30px below its cubesat.
    const byHeight = (MAX_ORBIT_Y * 1.3) / tan;
    const byWidth = (MAX_ORBIT_R * 1.10) / (tan * aspect * rightRoom);
    return Math.min(Math.max(Math.max(byHeight, byWidth), 5), 16);
  }

  // Places the camera and the frustum for the current descent progress.
  function applyDescent() {
    const p = descent;

    // fitDistance still owns the resting framing and keeps its 5–16 clamp; the
    // descent target deliberately bypasses that clamp, but never pulls the
    // camera FURTHER out than it already sits on a narrow viewport.
    const low = Math.min(LOW_DISTANCE, camDistance);
    const d = camDistance + (low - camDistance) * p;
    if (introDone) camera.position.setLength(d);

    // Level the horizon out as it arrives. Held at the resting elevation the
    // limb lands at an angle, which reads as a tilted planet rather than as
    // ground; at p = 1 both bounds meet at the equator and it lies flat.
    controls.minPolarAngle = REST_MIN_POLAR + (Math.PI / 2 - REST_MIN_POLAR) * p;
    controls.maxPolarAngle = REST_MAX_POLAR + (Math.PI / 2 - REST_MAX_POLAR) * p;

    // Drag stays live the whole way down. The globe is the site's navigation,
    // not just a hero ornament, so it has to keep working once you are on
    // About — Krittin asked for exactly that. It does not fight the scroll:
    // OrbitControls only owns rotation, the descent only writes the radius
    // (which OrbitControls preserves) and the frustum offset, and zoom is off.
    controls.enabled = introDone;

    // Centred by the time it lands: the globe starts in the right two-thirds
    // to leave the hero copy its column, and comes back to the middle as it
    // settles.
    const centerX = stacked ? 0.5 : SCENE_CENTER_WIDE + (0.5 - SCENE_CENTER_WIDE) * p;

    // Down to the horizon, then straight up with the scroll. The stacked
    // layout has neither (main.js pins both at 0 below the same breakpoint),
    // but the globe still has to clear the name stacked above it, so it gets a
    // fixed downward shift instead.
    const panY = stacked ? viewH * 0.16 : horizonPan(d, viewH) * p - rise;

    if (centerX === 0.5 && panY === 0) {
      camera.clearViewOffset(); // also calls updateProjectionMatrix
    } else {
      // A negative x renders a window to the LEFT of the virtual frame, which
      // moves the scene to the right on screen; a negative y renders one ABOVE
      // it, which moves the scene down.
      camera.setViewOffset(viewW, viewH, -(centerX - 0.5) * viewW, -panY, viewW, viewH);
    }
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    viewW = w;
    viewH = h;
    applyRenderQuality();

    // Keyed off innerWidth, not the container: this has to flip at exactly
    // the same point as the `max-width: 900px` rule that stacks the hero, and
    // a scrollbar makes the container a little narrower than the viewport.
    stacked = window.innerWidth <= STACK_BREAKPOINT;

    camDistance = fitDistance(camera.aspect, stacked ? 0.5 : SCENE_CENTER_WIDE);
    applyDescent();
    measureLabels();
  }

  // ---- arrival -----------------------------------------------------------
  // Camera eases in from far out while the planet and stars fade up, so the
  // hero resolves instead of just appearing.
  const INTRO_MS = REDUCED ? 0 : 1100;
  let introStart = null;
  let introDone = REDUCED;

  window.addEventListener("resize", resize);
  resize();

  if (!REDUCED) {
    controls.enabled = false;
    camera.position.setLength(camDistance * 2.6);
  }

  // ---- loop --------------------------------------------------------------
  const tmpVec = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  let t = 0;
  let telemetryAccum = 0;

  // The canvas spans two sections now rather than just the hero, so it is
  // worth not drawing it once it has scrolled away entirely.
  let onScreen = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => { onScreen = entries[entries.length - 1].isIntersecting; },
      { threshold: 0 }
    ).observe(container);
  }

  // The display was sampled before WebGL startup. Count actual refreshes
  // instead of using an elapsed-time threshold, which gives high-refresh
  // laptop panels a stable cadence rather than irregular frame skips.
  let lastFrame = 0;
  let displayFrame = 0;
  let perfSamples = 0;
  let slowSamples = 0;
  let qualityReductions = 0;

  function animate(now) {
    if (!onScreen) {
      requestAnimationFrame(animate);
      return;
    }

    displayFrame++;
    if (displayFrame % frameDivisor !== 0) {
      requestAnimationFrame(animate);
      return;
    }
    const elapsed = lastFrame ? now - lastFrame : targetFrameMs;
    lastFrame = now;

    // A weak GPU presents as sustained long frame intervals. Step down the
    // internal framebuffer after a representative sample instead of forcing
    // every visitor to accept lower quality. At most two reductions are made,
    // and the 0.75 floor remains considerably sharper than a CSS fallback.
    if (!document.hidden && qualityReductions < 2) {
      perfSamples++;
      if (elapsed > targetFrameMs * 1.45) slowSamples++;
      if (perfSamples >= 45) {
        if (slowSamples / perfSamples > 0.28) {
          qualityScale = Math.max(0.6, qualityScale * 0.8);
          qualityReductions++;
          rememberQuality();
          applyRenderQuality();
        }
        perfSamples = 0;
        slowSamples = 0;
      }
    }

    // Capped so a tab coming back from being backgrounded (or the debugger
    // pausing) doesn't dump one giant catch-up step into the orbits.
    const dt = Math.min(elapsed, 100) / 1000;
    t += dt;

    // Ease toward the scroll-driven target rather than tracking it directly:
    // a fast wheel delivers the scroll in large jumps, and applying those to
    // the camera one-for-one makes the descent move in steps.
    const descentTarget = window.__descentP || 0;
    const riseTarget = window.__risePx || 0;
    if (Math.abs(descentTarget - descent) > 0.0002 || riseTarget !== rise) {
      descent += (descentTarget - descent) * 0.12;
      rise = riseTarget; // taken whole, not eased — see the note where it is declared
      applyDescent();
    }

    if (!introDone) {
      if (introStart === null) introStart = now;
      const p = Math.min((now - introStart) / INTRO_MS, 1);
      const from = camDistance * 2.6;
      camera.position.setLength(from + (camDistance - from) * easeOutCubic(p));

      const fade = easeOutCubic(Math.min(p * 1.5, 1));
      planet.uniforms.uFade.value = fade;
      clouds.uniforms.uFade.value = fade;
      stars.uniforms.uFade.value = fade;
      limb.material.opacity = fade * 0.4;
      labelLayer.style.opacity = String(Math.max(0, (p - 0.55) / 0.45));

      if (p >= 1) {
        introDone = true;
        controls.enabled = true;
        labelLayer.style.opacity = "1";
      }
    }

    if (!REDUCED) {
      earth.rotation.y += 0.0009 * dt * 60;
      cloudSpinner.rotation.y += 0.00035 * dt * 60; // clouds drift relative to the surface
      stars.points.rotation.y += 0.00004 * dt * 60;
      stars.uniforms.uTime.value = t;
    }

    // Billboard the limb reticle so it always traces the globe's silhouette
    // from wherever the camera has been dragged to.
    limb.line.quaternion.copy(camera.quaternion);

    satellites.forEach((sat) => positionSatellite(sat, t, dt));

    // Hover test — done here rather than per pointermove so it costs one
    // raycast per frame at most. Live at every scroll position, because the
    // cubesats stay clickable navigation all the way down.
    if (introDone && pointerInside && !pointerDownPos) {
      const sat = raycastSat();
      canvasHoverId = sat ? sat.cfg.id : null;

      // Label hit test against last frame's projected positions. One frame of
      // lag is imperceptible, and it means no DOM reads inside the loop.
      const onLabel = satellites.find(
        (s) =>
          s.labelVisible &&
          Math.abs(pointerLocal.x - s.sx) <= s.half.w &&
          Math.abs(pointerLocal.y - s.sy) <= s.half.h
      );
      labelHoverId = onLabel ? onLabel.cfg.id : null;
    }
    const nextHoveredId = canvasHoverId || labelHoverId;
    if (nextHoveredId !== hoveredId) {
      hoveredId = nextHoveredId;
      satellites.forEach((sat) => sat.labelEl.classList.toggle("is-hot", sat.cfg.id === hoveredId));
    }
    if (canvasHoverId !== cursorHoverId) {
      cursorHoverId = canvasHoverId;
      renderer.domElement.style.cursor = canvasHoverId ? "pointer" : "";
    }

    satellites.forEach((sat) => {
      const target = sat.cfg.id === hoveredId ? 1.55 : 1;
      sat.scale += (target - sat.scale) * 0.15;
      // Payloads shrink as the camera drops to the limb — at full size a near
      // pass is a cubesat the width of the bio column drifting across it. Not
      // so far that they stop reading as targets, though: they are still the
      // way you pick a section from the About page.
      sat.mesh.scale.setScalar(sat.scale * (1 - 0.45 * descent));
    });

    controls.update();
    renderer.render(scene, camera);

    // ---- HTML labels tracking their cubesats ----
    // viewW/viewH, not container.clientWidth/Height: those are layout reads,
    // and this loop writes transforms straight afterwards, so reading them here
    // forces a reflow every frame. resize() already caches the same numbers —
    // the same rule the label widths follow.
    satellites.forEach((sat) => {
      // Projected in place. tmpVec exists to avoid allocating, and cloning it
      // here threw away the point of it — four Vector3s a frame, for ever.
      sat.mesh.getWorldPosition(tmpVec).project(camera);
      const behindCamera = tmpVec.z > 1;
      const x = (tmpVec.x * 0.5 + 0.5) * viewW;
      const y = (-(tmpVec.y * 0.5) + 0.5) * viewH;
      sat.labelEl.style.transform = `translate(-50%, -50%) translate(${x}px, ${y + 30}px)`;
      sat.labelEl.style.opacity = behindCamera ? "0" : "";

      // Cached for next frame's label hit test.
      sat.sx = x;
      sat.sy = y + 30;
      sat.labelVisible = !behindCamera;
    });

    // ---- telemetry readout, throttled to ~8 Hz ----
    if (onTelemetry) {
      telemetryAccum += dt;
      if (telemetryAccum > 0.125) {
        telemetryAccum = 0;
        spherical.setFromVector3(camera.position);
        onTelemetry({
          az: ((THREE.MathUtils.radToDeg(spherical.theta) % 360) + 360) % 360,
          el: 90 - THREE.MathUtils.radToDeg(spherical.phi),
          range: spherical.radius,
          tracking: hoveredId,
          sats: satellites.map((s) => ({
            id: s.cfg.id,
            label: s.cfg.label,
            radius: s.cfg.radius,
            anomaly: s.anomaly,
          })),
        });
      }
    }

    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return { scene, camera, renderer, controls };
}
