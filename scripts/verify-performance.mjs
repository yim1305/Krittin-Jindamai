import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { test, afterEach } from "node:test";

const source = await readFile(new URL("../js/scene-performance.js", import.meta.url), "utf8");
const original = new Map(["window", "document", "navigator", "performance", "fetch",
  "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"]
  .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
function install(values) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
}
afterEach(() => {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
let moduleId = 0;
async function load(hints = {}) {
  install({ window: { devicePixelRatio: 2 }, navigator: hints, document: { hidden: false } });
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleId++}`);
}

function fakeClock(hz = 60) {
  let now = 0, id = 0, callbacks = 0;
  const pending = new Map();
  const queue = (fn, at) => { pending.set(++id, { fn, at }); return id; };
  install({
    performance: { now: () => now },
    setTimeout: (fn, delay = 0) => queue(fn, now + delay),
    clearTimeout: (key) => pending.delete(key),
    requestAnimationFrame: (fn) => queue(fn, (Math.floor((now + 0.001) / (1000 / hz)) + 1) * (1000 / hz)),
    cancelAnimationFrame: (key) => pending.delete(key),
  });
  return {
    advance(ms) {
      const end = now + ms;
      while (pending.size) {
        const [key, entry] = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
        if (entry.at > end) break;
        pending.delete(key);
        now = Math.max(now, entry.at);
        assert.ok(++callbacks < 100000, "scheduler must not spin");
        entry.fn(now);
      }
      now = Math.max(now, end);
    },
    consume(ms) { now += ms; },
    get pending() { return pending.size; },
    get callbacks() { return callbacks; },
  };
}

test("pixel budgets hold on laptop, 4K and ultrawide displays, with optional hardware hints", async () => {
  for (const hints of [{}, { hardwareConcurrency: 4 }, { deviceMemory: 4 }, { connection: { saveData: true } }]) {
    const { createRenderBudget, LOW_POWER } = await load(hints);
    const budget = createRenderBudget(1600000);
    for (const [w, h] of [[1440, 836], [3840, 2160], [7680, 4320], [5120, 2304]]) {
      const ratio = budget.ratio(w, h);
      assert.ok(w * h * ratio ** 2 <= 1600000 * (LOW_POWER ? 0.55 : 1) + 1);
      assert.ok(ratio > 0);
    }
    const before = budget.ratio(1920, 1080);
    budget.reduce();
    assert.ok(budget.ratio(1920, 1080) < before);
  }
});

test("frame caps work at 60/90/120/144/165 Hz without duplicate loops", async () => {
  const { createFrameLoop } = await load();
  for (const hz of [60, 90, 120, 144, 165]) {
    for (const fps of [12, 20, 30, 60]) {
      const clock = fakeClock(hz);
      const times = [];
      const loop = createFrameLoop((now) => times.push(now), { fps });
      loop.start();
      loop.start();
      clock.advance(10000);
      assert.ok(times.length <= fps * 10 + 1, `${hz} Hz exceeded ${fps} FPS: ${times.length}`);
      assert.ok(times.length >= fps * 9.8, `${hz} Hz undershot ${fps} FPS: ${times.length}`);
      loop.stop();
      assert.equal(clock.pending, 0);
      const count = times.length;
      clock.advance(10000);
      assert.equal(times.length, count);
    }
  }
});

test("ambient loops sleep between draws; hidden tabs and static scenes do not spin", async () => {
  const { createFrameLoop } = await load();
  const clock = fakeClock(165);
  let frames = 0;
  const loop = createFrameLoop(() => frames++, { fps: 12 });
  loop.start();
  clock.advance(10000);
  assert.ok(clock.callbacks < 400, `too many ambient callbacks: ${clock.callbacks}`);
  loop.stop();
  document.hidden = true;
  loop.start();
  assert.equal(clock.pending, 0);
  document.hidden = false;
  const staticLoop = createFrameLoop(() => frames++, { continuous: false });
  const before = frames;
  staticLoop.start();
  clock.advance(10000);
  assert.equal(frames, before + 1);
  assert.equal(clock.pending, 0);
  staticLoop.start();
  clock.advance(100);
  assert.equal(frames, before + 2, "static scenes redraw on interaction");
});

test("resume does not advance animation through hidden time or reduce quality", async () => {
  const { createFrameLoop } = await load();
  const clock = fakeClock();
  let reductions = 0;
  let dt = 0;
  const loop = createFrameLoop((now, delta) => { dt = delta; }, { fps: 30, onSlow: () => reductions++ });
  for (let i = 0; i < 100; i++) {
    loop.start();
    clock.advance(40);
    loop.stop();
    clock.advance(60000);
    assert.ok(dt < 0.04);
  }
  assert.equal(reductions, 0);
});

test("sustained slow frames reduce quality, while isolated stalls do not", async () => {
  const { createFrameLoop } = await load();
  const clock = fakeClock();
  let reductions = 0, frames = 0;
  let slow = false;
  const loop = createFrameLoop(() => {
    frames++;
    if (slow || frames === 5) clock.consume(45);
  }, { fps: 60, onSlow: () => reductions++ });
  loop.start();
  clock.advance(4000);
  assert.equal(reductions, 0);
  slow = true;
  clock.advance(20000);
  assert.equal(reductions, 2);
  loop.stop();
});

test("chunked CSV parsing preserves every exported simulation value", async () => {
  const { loadNumericCsv } = await load();
  for (const name of ["sim_data_mtq_on.csv", "sim_data_mtq_off.csv", "cbf-run2.csv", "spiral_geometry2.csv", "walls2.csv"]) {
    const text = await readFile(new URL(`../assets/data/${name}`, import.meta.url), "utf8");
    install({ fetch: async () => ({ ok: true, text: async () => text }) });
    const actual = await loadNumericCsv(name);
    const [header, ...rows] = text.trim().split(/\r?\n/);
    const keys = header.split(",").map((key) => key.trim());
    const expected = Object.fromEntries(keys.map((key) => [key, []]));
    for (const row of rows) row.split(",").forEach((value, i) => expected[keys[i]].push(parseFloat(value)));
    assert.deepEqual(actual, expected, name);
  }
  install({ fetch: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(() => loadNumericCsv("missing.csv"), /404/);
});

test("shader preparation uses the supported compilation path", async () => {
  const { prepareShaders } = await load();
  for (const parallel of [true, false]) {
    const calls = [];
    const renderer = {
      extensions: { has: () => parallel },
      compileAsync: async () => calls.push("async"),
      compile: () => calls.push("sync"),
    };
    await prepareShaders(renderer, {}, {});
    assert.deepEqual(calls, [parallel ? "async" : "sync"]);
  }
});

test("project videos pause offscreen and hidden, resume, and respect user pause/reduced motion", async () => {
  const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
  const code = main.slice(main.indexOf("function initVideoVisibility()"), main.indexOf("function scheduleMeteor("));
  for (const reduced of [false, true]) {
    const listeners = new Map(), documentEvents = new Map(), windowEvents = new Map();
    let observe;
    const timers = [];
    const video = {
      dataset: { playDelay: "1000" }, paused: true,
      addEventListener: (name, fn) => listeners.set(name, fn),
      play() { this.paused = false; listeners.get("play")?.(); return Promise.resolve(); },
      pause() { this.paused = true; listeners.get("pause")?.(); },
    };
    const doc = {
      hidden: false, querySelectorAll: () => [video],
      addEventListener: (name, fn) => documentEvents.set(name, fn),
    };
    runInNewContext(`const REDUCED = ${reduced}; ${code}; initVideoVisibility();`, {
      document: doc, navigator: {},
      window: { IntersectionObserver: true, addEventListener: (name, fn) => windowEvents.set(name, fn) },
      IntersectionObserver: class { constructor(fn) { observe = fn; } observe() {} },
      setTimeout: (fn) => timers.push(fn),
    });
    observe([{ isIntersecting: true }]);
    assert.equal(video.paused, true, "wait for the requested delay");
    timers.forEach((fn) => fn());
    assert.equal(video.paused, reduced);
    if (reduced) video.play(); // Native play remains available.
    observe([{ isIntersecting: false }]);
    assert.equal(video.paused, true);
    observe([{ isIntersecting: true }]);
    assert.equal(video.paused, false);
    doc.hidden = true;
    documentEvents.get("visibilitychange")();
    assert.equal(video.paused, true);
    doc.hidden = false;
    documentEvents.get("visibilitychange")();
    assert.equal(video.paused, false);
    video.pause(); // User pause must survive visibility changes.
    observe([{ isIntersecting: false }]);
    observe([{ isIntersecting: true }]);
    assert.equal(video.paused, true);
    video.play();
    windowEvents.get("pagehide")();
    assert.equal(video.paused, true);
    windowEvents.get("pageshow")();
    assert.equal(video.paused, false);
  }
});

test("all site scripts parse and changed assets resolve with current cache versions", async () => {
  const root = new URL("../", import.meta.url);
  const pages = ["index.html", ...(await readdir(new URL("projects/", root)))
    .filter((name) => name.endsWith(".html")).map((name) => `projects/${name}`)];
  const check = (input, label) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--check"], { input, encoding: "utf8" });
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  };
  for (const name of (await readdir(new URL("js/", root))).filter((name) => name.endsWith(".js"))) {
    check(await readFile(new URL(`js/${name}`, root), "utf8"), name);
  }
  for (const page of pages) {
    const url = new URL(page, root);
    const html = await readFile(url, "utf8");
    for (const [, attrs, script] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (attrs.includes("importmap")) JSON.parse(script);
      else if (script.trim()) check(script, page);
    }
    for (const [asset] of html.matchAll(/(?:\.\.\/|\.\/)?(?:css|js)\/(?:style\.css|main\.js|(?:orbit|system|cmg|cbf)-scene\.js)\?v=[\w]+/g)) {
      assert.ok(asset.endsWith("?v=20260907a"), asset);
      await access(new URL(asset.split("?")[0], url));
    }
  }
});

test("compact layout moves existing scenes below text and restores desktop order", async () => {
  const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
  const start = main.indexOf("function initResponsiveLayout()");
  const code = main.slice(start, main.indexOf("// --------------------------------------------------------------------------", start));
  class Element {
    children = [];
    parentElement = null;
    get nextSibling() {
      return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null;
    }
    appendChild(child) { this.insertBefore(child, null); }
    insertBefore(child, next) {
      if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
      const index = next ? this.children.indexOf(next) : this.children.length;
      assert.ok(index >= 0);
      this.children.splice(index, 0, child);
      child.parentElement = this;
    }
  }
  const [scene, sceneHome, sceneNext, heroSlot, info, projectScene, infoNext, field, index] =
    Array.from({ length: 9 }, () => new Element());
  sceneHome.appendChild(scene); sceneHome.appendChild(sceneNext);
  projectScene.appendChild(info); projectScene.appendChild(infoNext);
  field.appendChild(projectScene); field.appendChild(index);
  const nav = { offsetHeight: 92 };
  const selectors = { ".topnav": nav, ".hero-right": heroSlot, ".proj-field": field, ".proj-scene": projectScene };
  const events = {};
  const compact = { matches: true, addEventListener: (name, callback) => { events.change = callback; } };
  const context = {
    document: { querySelector: (selector) => selectors[selector], getElementById: (id) => id === "hero-scene" ? scene : info },
    COMPACT_LAYOUT: compact,
    window: { addEventListener: (name, callback) => { events[name] = callback; } },
  };
  runInNewContext(`let NAV_H = 64; ${code}; initResponsiveLayout(); globalThis.navHeight = () => NAV_H;`, context);
  for (let i = 0; i < 3; i++) {
    assert.equal(scene.parentElement, heroSlot);
    assert.deepEqual(field.children, [projectScene, info, index]);
    assert.equal(context.navHeight(), 92);
    compact.matches = false; nav.offsetHeight = 64; events.resize();
    assert.deepEqual(sceneHome.children, [scene, sceneNext]);
    assert.deepEqual(projectScene.children, [info, infoNext]);
    assert.equal(context.navHeight(), 64);
    compact.matches = true; nav.offsetHeight = 92; events.change();
  }
});

test("compact project framing contains both complete planets from 320px phones to iPad landscape", async () => {
  const system = await readFile(new URL("../js/system-scene.js", import.meta.url), "utf8");
  const literal = system.match(/const COMPACT_LAYOUTS = (\[[\s\S]*?\n\]);/)[1];
  const layouts = runInNewContext(literal);
  const radii = [1, 0.8];
  const tan = Math.tan(22 * Math.PI / 360);
  for (const viewport of [320, 360, 375, 390, 414, 600, 768, 820, 834, 1024, 1194, 1366]) {
    const width = viewport - (viewport <= 600 ? 40 : 48);
    const height = Math.max(420, Math.min(660, viewport));
    const aspect = width / height;
    const layout = layouts.find((item) => aspect >= item.min);
    const visibleH = Math.max(layout.fh, layout.fw / aspect);
    const distance = visibleH * layout.fit / (2 * tan);
    for (const [i, body] of [layout.earth, layout.moon].entries()) {
      const shift = i ? ((0.8 * 2) / layout.fw) / 5 : 0;
      const x = (body[0] + shift - 0.5) * layout.fw;
      const y = (0.5 - body[1]) * layout.fh;
      const radius = radii[i] * 1.075;
      // Conservative sphere bounds use the nearest depth for every vertex.
      assert.ok((Math.abs(x) + radius) / ((distance - radius) * tan * aspect) < 1, `${viewport}px horizontal body ${i}`);
      assert.ok((Math.abs(y) + radius) / ((distance - radius) * tan) < 1, `${viewport}px vertical body ${i}`);
    }
  }
});

test("HCMG camera setup runs against its exported trajectory without stale references", async () => {
  const { loadNumericCsv } = await load();
  const csv = await readFile(new URL("../assets/data/sim_data_mtq_on.csv", import.meta.url), "utf8");
  install({ fetch: async () => ({ ok: true, text: async () => csv }) });
  const data = await loadNumericCsv("simulation.csv");
  for (const axis of ["rx", "ry", "rz"]) data[axis] = data[axis].map((n) => n / 1000);
  class Vector3 {
    x = 0; y = 0; z = 0;
    fromArray(a, i) { [this.x, this.y, this.z] = [a[i], a[i + 1], a[i + 2]]; return this; }
    copy(v) { [this.x, this.y, this.z] = [v.x, v.y, v.z]; return this; }
    lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
    normalize() { return this.multiplyScalar(1 / (Math.sqrt(this.lengthSq()) || 1)); }
    multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
    addScaledVector(v, k) { this.x += v.x * k; this.y += v.y * k; this.z += v.z * k; return this; }
    crossVectors(a, b) {
      [this.x, this.y, this.z] = [a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x];
      return this;
    }
  }
  const cmg = await readFile(new URL("../js/cmg-scene.js", import.meta.url), "utf8");
  const positions = cmg.slice(cmg.indexOf("  const orbitPositions ="), cmg.indexOf("  const trajectoryGeometry ="));
  const camera = cmg.slice(cmg.indexOf("  const firstDirection ="), cmg.indexOf("  const orbitControls ="));
  const context = { data, t: data.t, EARTH_RADIUS_KM: 6371, THREE: { Vector3 }, orbitCamera: { position: new Vector3(), lookAt() {} } };
  runInNewContext(`${positions}\n${camera}\nglobalThis.result = { orbitPositions, orbitExtent, firstDirection, orbitNormal };`, context);
  const { orbitPositions, orbitExtent, firstDirection, orbitNormal } = context.result;
  assert.equal(orbitPositions.length, data.t.length * 3);
  assert.ok(orbitPositions.every(Number.isFinite));
  assert.ok(orbitExtent > 1);
  assert.ok(Math.abs(orbitNormal.lengthSq() - 1) < 1e-10);
  const dot = firstDirection.x * orbitNormal.x + firstDirection.y * orbitNormal.y + firstDirection.z * orbitNormal.z;
  assert.ok(Math.abs(dot) < 1e-10);
  assert.ok(Math.abs(context.orbitCamera.position.lengthSq() - 25) < 1e-8);
});

test("HCMG chart resizing retains playback and makes phone axes readable", async () => {
  const cmg = await readFile(new URL("../js/cmg-scene.js", import.meta.url), "utf8");
  const code = cmg.slice(cmg.indexOf("function buildChart("), cmg.indexOf("// Keep the original slow rate"));
  class Node {
    children = []; attributes = {}; style = {}; clientWidth = 600;
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  const target = new Node();
  let resize;
  let pending;
  const context = {
    document: { createElementNS: () => new Node() },
    window: { ResizeObserver: true },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} },
    setTimeout: (callback) => { pending = callback; }, clearTimeout() {},
    CHART_W: 600, CHART_H: 300, SVG_NS: "svg", CHART_COLORS: ["white"],
    CHART_MARGIN: { l: 68, r: 20, t: 14, b: 30 }, T_SPLIT_SIM: 100,
    findFrame: () => ({ i1: 1 }), clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
    target,
  };
  runInNewContext(`let chartId = 0; ${code}; globalThis.draw = buildChart(target, [0, 100, 1000], [[0, 20, 100]], "test");`, context);
  context.draw(50, 1);
  assert.equal(target.children[0].attributes.viewBox, "0 0 600 300");
  target.clientWidth = 280;
  resize(); pending();
  assert.equal(target.children.length, 1);
  assert.equal(target.children[0].attributes.viewBox, "0 0 320 300");
  const nodes = (node) => [node, ...node.children.flatMap(nodes)];
  const clip = nodes(target).find((node) => node.attributes.height === 256);
  assert.ok(Math.abs(clip.attributes.width - (320 - 68 - 20) * 0.05) < 1e-8);
  assert.ok(12 * 280 / 320 >= 10, "axis text remains at least 10 screen pixels at 320px viewport");
});
