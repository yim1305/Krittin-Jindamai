// ==========================================================================
// Page-wide behavior.
//
//   - Name typing animation (two lines, cursor follows the active line).
//   - Eased smooth-scrolling, used by the nav and by the hero's cubesats.
//     Native `scroll-behavior:smooth` is turned off in favour of this so the
//     long jumps between sections ease instead of snapping.
//   - Scroll-reveal for every [data-reveal] element, staggered per group.
//   - Sliding nav indicator + scroll progress hairline.
//   - Descent progress across the pinned home+about scene, published for both
//     the stylesheet and the 3D hero to read.
//   - Starfield drift/parallax and the occasional meteor.
//   - Live UTC readout in the hero status strip.
//
// The 3D hero scene lives in orbit-scene.js and is wired up separately from
// index.html (it's only needed on the home page).
// ==========================================================================

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const LOW_POWER = Boolean(
  (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  navigator.connection?.saveData
);
document.documentElement.classList.toggle("low-power", LOW_POWER);
let NAV_H = 64;
const COMPACT_LAYOUT = window.matchMedia("(max-width: 1239px), (hover: none) and (max-width: 1400px)");

function initResponsiveLayout() {
  const nav = document.querySelector(".topnav");
  const scene = document.getElementById("hero-scene");
  const sceneHome = scene?.parentElement;
  const sceneNext = scene?.nextSibling;
  const heroSlot = document.querySelector(".hero-right");
  const info = document.getElementById("proj-info");
  const infoHome = info?.parentElement;
  const infoNext = info?.nextSibling;
  const field = document.querySelector(".proj-field");
  const projectScene = document.querySelector(".proj-scene");

  function sync() {
    if (nav) NAV_H = nav.offsetHeight;
    if (scene && heroSlot) {
      if (COMPACT_LAYOUT.matches) {
        if (scene.parentElement !== heroSlot) heroSlot.appendChild(scene);
      } else if (scene.parentElement !== sceneHome) {
        sceneHome.insertBefore(scene, sceneNext);
      }
    }
    if (info && field && projectScene) {
      if (COMPACT_LAYOUT.matches) {
        if (info.parentElement !== field) field.insertBefore(info, projectScene.nextSibling);
      } else if (info.parentElement !== infoHome) {
        infoHome.insertBefore(info, infoNext);
      }
    }
  }
  sync();
  // Register before scene resizing/descent measurements, so they read the
  // new container after an orientation or breakpoint change.
  window.addEventListener("resize", sync);
  if (COMPACT_LAYOUT.addEventListener) COMPACT_LAYOUT.addEventListener("change", sync);
  else COMPACT_LAYOUT.addListener(sync);
  if (nav && "ResizeObserver" in window) {
    new ResizeObserver(() => { NAV_H = nav.offsetHeight; }).observe(nav);
  }
}

// --------------------------------------------------------------------------
// Eased scrolling. Exposed on window so the ES-module hero scene can call it
// without a second copy of the easing code.
// --------------------------------------------------------------------------
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

let scrollAnim = null;
let scrollController = null;

function smoothScrollTo(target) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;

  const maxTop = document.documentElement.scrollHeight - window.innerHeight;
  // getBoundingClientRect, not offsetTop: sections are position:relative, so
  // offsetTop on a nested target (the skills strip inside About) would be
  // measured against its section rather than the document.
  const docTop = el.getBoundingClientRect().top + window.scrollY;
  const to = Math.max(0, Math.min(el.id === "home" ? 0 : docTop - NAV_H + 1, maxTop));
  const from = window.scrollY;
  const delta = to - from;

  if (scrollAnim) cancelAnimationFrame(scrollAnim);
  scrollController?.abort();
  scrollAnim = null;

  if (REDUCED || Math.abs(delta) < 2) {
    window.scrollTo(0, to);
    return;
  }

  // Longer trips get a longer ride, but never a sluggish one.
  const duration = Math.min(800, Math.max(420, Math.abs(delta) * 0.38));
  const start = performance.now();
  if (scrollAnim) cancelAnimationFrame(scrollAnim);

  // Any real scroll input from the user wins immediately. One controller for
  // all three listeners means a single `abort()` unhooks all of them, rather
  // than each exit path having to remove three listeners by hand.
  let cancelled = false;
  const ac = new AbortController();
  scrollController = ac;
  const cancel = () => { cancelled = true; };
  window.addEventListener("wheel", cancel, { passive: true, once: true, signal: ac.signal });
  window.addEventListener("touchstart", cancel, { passive: true, once: true, signal: ac.signal });
  window.addEventListener("keydown", cancel, { once: true, signal: ac.signal });

  function step(now) {
    if (cancelled) { scrollAnim = null; ac.abort(); return; }
    const p = Math.min((now - start) / duration, 1);
    window.scrollTo(0, from + delta * easeInOutCubic(p));
    if (p < 1) {
      scrollAnim = requestAnimationFrame(step);
    } else {
      scrollAnim = null;
      ac.abort();
    }
  }
  scrollAnim = requestAnimationFrame(step);
}

window.smoothScrollTo = smoothScrollTo;

// --------------------------------------------------------------------------
// Hero name typing
// --------------------------------------------------------------------------
function initTypingName() {
  const el = document.querySelector("[data-typing-name]");
  if (!el) return;

  // "KRITTIN|JINDAMAI" — the pipe is the line break.
  const lines = (el.getAttribute("data-typing-name") || "").split("|").filter(Boolean);
  el.textContent = "";

  const lineEls = lines.map(() => {
    const span = document.createElement("span");
    span.className = "name-line";
    el.appendChild(span);
    return span;
  });

  const cursor = document.createElement("span");
  cursor.className = "cursor";

  if (REDUCED) {
    lineEls.forEach((span, i) => { span.textContent = lines[i]; });
    lineEls[lineEls.length - 1].appendChild(cursor);
    return;
  }

  const SPEED = 58; // ms per character
  let line = 0;
  let i = 0;

  function typeNext() {
    if (line >= lines.length) return;

    lineEls[line].textContent = lines[line].slice(0, i);
    lineEls[line].appendChild(cursor);

    if (i < lines[line].length) {
      i++;
      setTimeout(typeNext, SPEED);
    } else if (line < lines.length - 1) {
      line++;
      i = 0;
      setTimeout(typeNext, SPEED * 3); // beat between lines
    }
  }
  setTimeout(typeNext, 320);
}

// --------------------------------------------------------------------------
// Projects index typing — the same terminal-boot-log gesture as the hero
// name, but sequential across all six .proj-index rows and triggered on
// scroll-into-view rather than on page load, since the section starts off
// screen. Krittin: "add typing animation liek space scifi theme." Reuses
// .cursor (see style.css) so it's the same orange block-cursor language as
// the hero, not a second one.
// --------------------------------------------------------------------------
function initIndexTyping() {
  const links = Array.from(document.querySelectorAll(".proj-index a"));
  if (!links.length) return;

  // Each row is <a><span.proj-title>…</span><span.proj-year>…</span>[<span.
  // proj-status>…</span>][<span.proj-program>…</span>]</a> — status only on
  // the "in progress" rows, program only on the two research rows (USP,
  // thesis). Only the title is typed; year/status/program are separate
  // spans that fade in once the row finishes, so they read as metadata
  // settling in rather than part of the name being typed out. Bail on any
  // row missing the title span rather than typing over the markup and
  // destroying the year.
  const rows = links.map((a) => ({
    title: a.querySelector(".proj-title"),
    year: a.querySelector(".proj-year"),
    status: a.querySelector(".proj-status"),
    program: a.querySelector(".proj-program"),
  }));
  if (rows.some((r) => !r.title)) return;

  const titles = rows.map((r) => r.title.textContent);

  const cursor = document.createElement("span");
  cursor.className = "cursor";

  function finish(row) {
    if (row.year) row.year.classList.remove("is-pending");
    if (row.status) row.status.classList.remove("is-pending");
    if (row.program) row.program.classList.remove("is-pending");
  }

  if (REDUCED || COMPACT_LAYOUT.matches) {
    rows.forEach(finish);
    rows[rows.length - 1].title.appendChild(cursor);
    return;
  }

  rows.forEach((r) => {
    r.title.textContent = "";
    if (r.year) r.year.classList.add("is-pending");
    if (r.status) r.status.classList.add("is-pending");
    if (r.program) r.program.classList.add("is-pending");
  });

  const SPEED = 32; // ms per character — faster than the hero name; six lines add up
  let started = false;

  function type() {
    if (started) return;
    started = true;
    let line = 0;
    let i = 0;
    function next() {
      if (line >= rows.length) return;
      rows[line].title.textContent = titles[line].slice(0, i);
      rows[line].title.appendChild(cursor);
      if (i < titles[line].length) {
        i++;
        setTimeout(next, SPEED);
      } else {
        finish(rows[line]);
        if (line < rows.length - 1) {
          line++;
          i = 0;
          setTimeout(next, SPEED * 4); // beat between lines
        }
      }
    }
    next();
  }

  if (!("IntersectionObserver" in window)) { type(); return; }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        type();
        observer.disconnect();
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
  );
  observer.observe(links[0].parentElement);
}

// --------------------------------------------------------------------------
// Scroll reveal. Siblings inside the same parent stagger against each other
// so grids and lists arrive in sequence rather than all at once.
// --------------------------------------------------------------------------
function initReveal() {
  const items = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!items.length) return;

  if (REDUCED || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }

  const groupCounters = new Map();
  items.forEach((el) => {
    const parent = el.parentElement;
    const n = groupCounters.get(parent) || 0;
    groupCounters.set(parent, n + 1);
    el.style.transitionDelay = Math.min(n, 5) * 90 + "ms";
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
  );
  items.forEach((el) => observer.observe(el));
}

// --------------------------------------------------------------------------
// Nav: active highlight, sliding indicator, click-to-eased-scroll
// --------------------------------------------------------------------------
function initNav() {
  const allLinks = document.querySelectorAll(".navlinks a");
  if (!allLinks.length) return;

  // Only same-page fragment links (e.g. "#home") can be scroll-tracked here.
  // Project detail pages link back to "../index.html#home" etc — those are
  // left alone; there's nothing on this page for them to highlight against.
  const links = Array.from(allLinks).filter((a) => (a.getAttribute("href") || "").startsWith("#"));
  if (!links.length) return;

  links.forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (!document.querySelector(href)) return;
      e.preventDefault();
      smoothScrollTo(href);
      history.replaceState(null, "", href);
    });
  });

  const indicator = document.getElementById("nav-indicator");
  function moveIndicator(link) {
    if (!indicator || !link) return;
    indicator.style.width = link.offsetWidth + "px";
    indicator.style.transform = "translateX(" + link.offsetLeft + "px)";
    indicator.classList.add("on");
  }

  const sections = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  if (!sections.length) return;

  // Track which sections are in the band, then pick a single winner. Reacting
  // to entries one at a time lets two sections fight over the indicator when
  // they cross the band in the same callback.
  const visible = new Set();

  function applyActive() {
    let activeId = null;
    let best = Infinity;
    sections.forEach((s) => {
      if (!visible.has(s)) return;
      const top = Math.abs(s.getBoundingClientRect().top);
      if (top < best) { best = top; activeId = "#" + s.id; }
    });
    if (!activeId) return;
    links.forEach((a) => {
      const on = a.getAttribute("href") === activeId;
      a.classList.toggle("active", on);
      if (on) moveIndicator(a);
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      applyActive();
    },
    { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
  );
  sections.forEach((s) => observer.observe(s));

  const remeasure = () => moveIndicator(links.find((a) => a.classList.contains("active")));
  window.addEventListener("resize", remeasure);
  // Link widths shift once JetBrains Mono swaps in, so re-measure then too.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
}

// --------------------------------------------------------------------------
// Descent: how far through the pinned home+about scene the reader has come.
//
// Published two ways — as the `--descent` custom property, which drives the
// hero copy's lift-off in CSS, and as window.__descentP, which orbit-scene.js
// reads inside its own render loop. A shared value rather than a callback
// because this file runs from <head> and the scene is an ES module that loads
// later; neither has to know whether the other exists, and project pages have
// neither.
//
// Progress runs 0 -> 1 over the hero's own height, so the camera reaches low
// orbit exactly as About's top meets the nav. The descent therefore costs no
// extra scroll length of its own — nothing is pinned open to make room for it.
//
// It also publishes `--sky-color`, which fades the nebula's colour out over the
// hero, so every section past it is plain black and white stars.
// --------------------------------------------------------------------------

// How much of the nebula's colour Projects gets back. Deliberately under the
// hero's 1: the hero is still the most coloured piece of sky on the page, and
// the Earth/Moon scene has enough going on in front of it that a full-strength
// backdrop would crowd it.
const PROJECT_SKY = 0.8;

// One page-wide scroll scheduler. Descent and progress used to install their
// own listeners and queue separate animation frames for the same scroll event.
const scrollUpdates = new Set();
let scrollFrame = 0;
let scrollBound = false;

function subscribeToScroll(update) {
  scrollUpdates.add(update);
  if (scrollBound) return;
  scrollBound = true;
  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      scrollUpdates.forEach((fn) => fn());
    });
  }, { passive: true });
}

// Shared by initDescent and initScrollProgress. `measure` recomputes cached
// layout numbers; `update` writes styles from them.
function wireRemeasure(measure, update) {
  subscribeToScroll(update);

  const remeasure = () => { measure(); update(); };
  window.addEventListener("resize", remeasure);
  window.addEventListener("load", remeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  remeasure();
}

function initDescent() {
  const root = document.documentElement;
  const hero = document.getElementById("home");
  const wrap = document.getElementById("descent");

  // Project detail pages have none of this, and they sit past the coloured sky
  // entirely — they are only ever reached from Projects, where it has already
  // faded out, so arriving on one must not put it back.
  if (!hero || !wrap) {
    root.style.setProperty("--sky-color", "0");
    return;
  }

  // Measured on resize/load rather than inside the scroll handler. offsetHeight
  // and getBoundingClientRect force a synchronous layout, and this runs in a
  // rAF alongside code that writes styles — reading them per frame is the
  // classic read/write thrash. It also stops the numbers shifting underfoot
  // when an Experience row unfolds on hover and nudges the wrapper's height.
  // The Projects section, which gets the nebula BACK — see the sky note in
  // update(). Absent on the project detail pages, which return above, and
  // guarded anyway so the whole mechanism degrades to "hero only".
  const projects = document.getElementById("projects");

  let heroH = 0;
  let riseMax = 0;
  let active = false;
  let projTop = Infinity;

  function measure() {
    // Below the breakpoint, and under reduced motion, the scene is boxed back
    // into the hero by style.css and there is nothing to descend through.
    active = !REDUCED && !COMPACT_LAYOUT.matches;
    heroH = hero.offsetHeight;

    // Where the sticky scene unpins: the document position of .descent's
    // bottom, one viewport up. Taken from the live box rather than assuming
    // the wrapper starts exactly NAV_H down the page.
    const wrapBottom = wrap.getBoundingClientRect().bottom + window.scrollY;
    riseMax = Math.max(0, wrapBottom - window.innerHeight - heroH);

    projTop = projects ? projects.getBoundingClientRect().top + window.scrollY : Infinity;
  }

  function update() {
    const y = window.scrollY;

    // Runs over the hero's own height, and ends at the horizon — there is no
    // second leg of camera movement. The globe settles at the foot of About.
    const p = active && heroH > 0 ? Math.min(Math.max(y / heroH, 0), 1) : 0;
    root.style.setProperty("--descent", p.toFixed(4));
    window.__descentP = p;

    // Past that point the globe simply rides the scroll. This is a pixel
    // offset, not a progress fraction, and the scene applies it to the frustum
    // 1:1 — so the planet travels at exactly the speed of the page and reads
    // as part of it rather than as a camera doing something of its own. That
    // is what carries the underside of the globe up to the top of Experience
    // and keeps the two sections looking like one piece of sky.
    //
    // It has to STOP exactly where the sticky scene unpins, which is the point
    // its own box starts scrolling away at that same 1:1 rate. Let it run past
    // there and the two add up, and the globe leaves at double the speed of
    // the page. `riseMax` is derived from .descent's own box in measure(),
    // rather than guessed at from section heights.
    window.__risePx = active ? Math.min(Math.max(y - heroH, 0), riseMax) : 0;

    // ---- the nebula's colour ------------------------------------------
    //
    // It drains over the descent, so About and Experience are plain black with
    // white star dots, and then it comes BACK for Projects — Krittin: "add
    // nebula to this page as well". Projects and Awards share one canvas and
    // one piece of sky (the globe spills from one into the other), so the
    // colour rises once as Projects arrives and simply stays up to the foot of
    // the page rather than fading out again between them.
    //
    // Computed even under reduced motion and on the stacked layout: this is a
    // function of scroll position rather than an animation, and skipping it
    // would leave the colour sitting behind every section.
    //
    // Both terms are derived from scroll DIRECTLY rather than from p, so they
    // still fade smoothly where the descent itself is switched off — p is
    // pinned at 0 there, and reusing it would snap the colour away on the
    // first pixel.
    const heroSky = heroH > 0 ? 1 - Math.min(Math.max(y / heroH, 0), 1) : 1;
    // Starts the moment Projects' top edge enters the viewport and takes about
    // three quarters of a screen to arrive, so the colour is already up by the
    // time the section is actually being looked at.
    const vh = window.innerHeight;
    const projSky =
      projTop === Infinity ? 0 : PROJECT_SKY * Math.min(Math.max((y + vh - projTop) / (vh * 0.75), 0), 1);
    root.style.setProperty("--sky-color", Math.max(heroSky, projSky).toFixed(4));
  }

  // Also re-measures after load: a fragment navigation (arriving at
  // index.html#projects from a project page) applies its scroll after
  // DOMContentLoaded, and the first update would otherwise have measured the
  // top of the document. Fonts matter too — the sections reflow when
  // JetBrains Mono swaps in.
  wireRemeasure(measure, update);
}

// --------------------------------------------------------------------------
// Scroll progress hairline under the nav
// --------------------------------------------------------------------------
function initScrollProgress() {
  const bar = document.getElementById("scroll-progress");
  if (!bar) return;

  // Cached for the same reason as the descent's measurements: scrollHeight is
  // a layout read, and this handler writes a style straight after it.
  let max = 0;

  function measure() {
    max = document.documentElement.scrollHeight - window.innerHeight;
  }
  function update() {
    const p = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
  }

  wireRemeasure(measure, update);
}

// --------------------------------------------------------------------------
// Starfield: slow drift + bounded scroll parallax. Only compositor transforms
// are written here. Updating background-position on these oversized,
// multi-gradient layers forced Chromium to repaint millions of pixels per
// frame on high-density laptop panels.
// --------------------------------------------------------------------------
function initStarfield() {
  const root = document.getElementById("stars");
  const nebula = document.getElementById("nebula");
  if (!root) return;

  // One mid-depth layer is enough over the star-bearing nebula image. The old
  // trio rasterized and composited three 140%-viewport gradient surfaces.
  const layers = Array.from(root.querySelectorAll(".star-mid")).map((el) => ({
    el,
    depth: parseFloat(el.dataset.depth) || 0.1,
    drift: parseFloat(el.dataset.drift) || 12, // px per second, leftward
  }));
  const dynamicBackdrop = Boolean(document.getElementById("home")) && !LOW_POWER;
  if (!dynamicBackdrop) document.documentElement.classList.add("static-backdrop");

  // ---- continuity across navigations ----
  // Scroll resets on a new page, so the bounded parallax offset is carried
  // through sessionStorage. The shared clock also preserves every layer's
  // oscillation phase through cross-document view transitions.
  const KEY = "krj-backdrop";
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch (e) {
    saved = null; // private mode, or someone put junk in the key
  }

  const baseStarY =
    saved && Array.isArray(saved.starY) && saved.starY.length === layers.length
      ? saved.starY
      : layers.map(() => 0);
  const nebBase = saved && typeof saved.nebY === "number" ? saved.nebY : 0;
  const clock0 = saved && typeof saved.clock === "number" ? saved.clock : 0;

  // Live values, kept here so pagehide can persist exactly what is on screen.
  const live = { starY: [...baseStarY], nebY: nebBase, clock: clock0 };

  function paint() {
    layers.forEach((l, i) => {
      if (REDUCED) {
        l.el.style.transform = "none";
        return;
      }

      // Match the old drift speed with long, bounded oscillations. Keeping
      // each layer inside its overscan lets Chromium reuse a composited layer
      // instead of rasterizing its radial gradients again on every update.
      const phase = i * 2.17;
      const xAmp = 24 - i * 4;
      const yAmp = 14 + i * 3;
      const xRate = (l.drift / 10) / xAmp;
      const yRate = (l.drift / 40) / yAmp;
      const dx = Math.sin(live.clock * xRate + phase) * xAmp;
      const dy = Math.cos(live.clock * yRate + phase * 0.7) * yAmp + live.starY[i];
      l.el.style.transform =
        "translate3d(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px,0)";
    });
    // REDUCED: leave the inline transform unset so .nebula's own
    // `transform:none` (under prefers-reduced-motion in style.css) applies —
    // paint() still runs once on load to restore the starfield's position,
    // and without this guard that single call would freeze the nebula at
    // one arbitrary point in the drift cycle instead of dead centre.
    if (nebula && dynamicBackdrop && !REDUCED) {
      // Slow bounded translation keeps the nebula alive without continuously
      // rescaling a large compositor surface. Compact screens use half the
      // excursion so the smaller 1.22 overscan still covers every edge.
      const t = live.clock;
      const compact = window.innerWidth < 700;
      const dx = Math.sin(t / 11) * (compact ? 24 : 48);
      const dy = Math.cos(t / 15) * (compact ? 12 : 24);
      nebula.style.transform =
        "translate3d(" + dx.toFixed(1) + "px," + (live.nebY + dy).toFixed(1) + "px,0) scale(1.22)";
    }
  }

  function persist() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ starY: live.starY, nebY: live.nebY, clock: live.clock }));
    } catch (e) {
      /* storage unavailable — the backdrop just restarts, nothing breaks */
    }
  }
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });

  // Paint the restored position immediately: main.js runs before first paint,
  // and the view-transition snapshot of the incoming page is taken right
  // after, so the backdrop must already be in the right place.
  paint();
  // Detail pages use a static star layer. Their nebula is invisible, so a
  // continuous backdrop loop cannot contribute a visible pixel there.
  if (REDUCED || !dynamicBackdrop) return;

  // These are compositor-only writes now. The drift is slow enough that 20
  // updates per second still looks continuous without doing needless work on
  // high-refresh displays.
  const FRAME_MS = 1000 / 20;
  let lastFrame = 0;
  let frameId = null;
  let timer = null;
  function frame(now) {
    frameId = null;
    if (document.hidden) return;
    const dt = lastFrame ? Math.min(now - lastFrame, 100) / 1000 : 0;
    lastFrame = now;
    const sy = window.scrollY;

    live.clock += dt;
    layers.forEach((l, i) => {
      // Bounded to the layer's overscan, unlike the old unbounded background
      // offset. Mutating in place avoids short-lived arrays in this loop.
      live.starY[i] = Math.max(-52, Math.min(52, baseStarY[i] - sy * l.depth * 0.06));
    });
    // Clamped: unlike the star layers this image does not tile, and the base
    // accumulates across every page visit in the session.
    live.nebY = Math.max(-30, Math.min(30, nebBase - sy * 0.006));

    paint();
    timer = setTimeout(() => {
      timer = null;
      frameId = requestAnimationFrame(frame);
    }, FRAME_MS - 8);
  }
  function stopBackdrop() {
    clearTimeout(timer);
    cancelAnimationFrame(frameId);
    timer = frameId = null;
    lastFrame = 0;
  }
  function startBackdrop() {
    if (!document.hidden && timer === null && frameId === null) frameId = requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => document.hidden ? stopBackdrop() : startBackdrop());
  window.addEventListener("pagehide", stopBackdrop);
  window.addEventListener("pageshow", startBackdrop);
  startBackdrop();

  scheduleMeteor(root);
}

// Keep the continuously translating skills strip paused until it is actually
// visible. CSS animations otherwise keep their compositor layer active while
// the reader is on the hero, Projects, or another page section.
function initMarqueeVisibility() {
  const marquees = Array.from(document.querySelectorAll(".marquee"));
  if (!marquees.length || REDUCED) return;
  if (!("IntersectionObserver" in window)) {
    marquees.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.target.classList.toggle("is-visible", entry.isIntersecting));
  }, { rootMargin: "80px" });
  marquees.forEach((el) => observer.observe(el));
}

// Keep native controls usable, and never override an explicit user pause.
function initVideoVisibility() {
  document.querySelectorAll("video[data-auto-play]").forEach((video) => {
    let visible = !("IntersectionObserver" in window);
    let ready = false;
    let userPaused = false;
    let automaticPause = false;
    let resumeManual = false;
    const autoAllowed = !REDUCED && !navigator.connection?.saveData;
    const delay = Number(video.dataset.playDelay) || 0;
    video.controls = true;

    function sync() {
      if (visible && !document.hidden && ready && !userPaused && (autoAllowed || resumeManual)) {
        if (video.paused) video.play().catch(() => {});
      } else if (!video.paused) {
        resumeManual = true;
        automaticPause = true;
        video.pause();
      }
    }
    video.addEventListener("pause", () => {
      if (automaticPause) automaticPause = false;
      else userPaused = true;
    });
    video.addEventListener("play", () => {
      userPaused = false;
      // A pending play() can resolve after the observer has paused the video.
      if (!visible || document.hidden) sync();
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        sync();
      }).observe(video);
    }
    setTimeout(() => { ready = true; sync(); }, delay);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", () => {
      if (!video.paused) { automaticPause = true; resumeManual = true; video.pause(); }
    });
    window.addEventListener("pageshow", sync);
  });
}

function scheduleMeteor(root) {
  const wait = 7000 + Math.random() * 12000;
  setTimeout(() => {
    spawnMeteor(root);
    scheduleMeteor(root);
  }, wait);
}

function spawnMeteor(root) {
  if (document.hidden) return;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const angle = 18 + Math.random() * 16;
  const rad = (angle * Math.PI) / 180;
  const dist = 320 + Math.random() * 420;

  const x = Math.random() * w * 0.9;
  const y = Math.random() * h * 0.45;
  const dx = Math.cos(rad) * dist;
  const dy = Math.sin(rad) * dist;

  const m = document.createElement("div");
  m.className = "meteor";
  root.appendChild(m);

  const anim = m.animate(
    [
      { transform: `translate(${x}px, ${y}px) rotate(${angle}deg) scaleX(.25)`, opacity: 0 },
      { opacity: 0.9, offset: 0.2 },
      { transform: `translate(${x + dx}px, ${y + dy}px) rotate(${angle}deg) scaleX(1)`, opacity: 0 },
    ],
    { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.25,.6,.35,1)" }
  );
  anim.onfinish = () => m.remove();
  anim.oncancel = () => m.remove();
}

// --------------------------------------------------------------------------
// Projects carousel — experimental, see "Planned: 3D-model project
// carousel" in CLAUDE.md. Six .carousel-item cards sit at fixed 60° steps
// around a cylinder (in CSS, via nth-child); the only thing that actually
// moves is .carousel-track's own `transform`, which this rotates so the
// selected item's step cancels out to 0deg and faces the viewer.
//
// The active index is tracked in JS rather than derived from the current
// angle, so drag and click always agree on exactly which card is "front" —
// reading it back out of a mid-transition transform would be fragile.
// --------------------------------------------------------------------------
function initProjectCarousel() {
  const root = document.getElementById("proj-carousel");
  const track = document.getElementById("carousel-track");
  if (!root || !track) return;

  const items = Array.from(track.querySelectorAll(".carousel-item"));
  if (!items.length) return;
  const descEl = document.getElementById("carousel-desc");
  const prevBtn = document.getElementById("carousel-prev");
  const nextBtn = document.getElementById("carousel-next");
  const STEP = 360 / items.length;

  let index = 0;
  let dragging = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragBaseAngle = 0;

  function apply(angle) {
    track.style.transform = "rotateY(" + (-angle).toFixed(2) + "deg)";
  }

  function setActive(i) {
    index = ((i % items.length) + items.length) % items.length;
    items.forEach((el, n) => el.classList.toggle("active", n === index));
    if (descEl) descEl.textContent = items[index].dataset.desc || "";
    apply(index * STEP);
  }

  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragBaseAngle = index * STEP;
    track.classList.add("dragging");
    track.setPointerCapture(e.pointerId);
  });

  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 4) dragMoved = true;
    apply(dragBaseAngle - dx * 0.5);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    track.classList.remove("dragging");
    const dx = e.clientX - dragStartX;
    setActive(Math.round((dragBaseAngle - dx * 0.5) / STEP));
  }
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  // One capture-phase listener handles both jobs: swallow the synthetic
  // click a real drag leaves behind (it would otherwise either re-select a
  // side card a second time or fire the active link's navigation), and
  // otherwise turn a click on a side card into a select rather than letting
  // it do nothing (its .carousel-link is pointer-events:none in CSS, so the
  // .carousel-item itself is always the real click target there).
  track.addEventListener("click", (e) => {
    if (dragMoved) {
      e.preventDefault();
      e.stopPropagation();
      dragMoved = false;
      return;
    }
    const item = e.target.closest(".carousel-item");
    const i = item ? items.indexOf(item) : -1;
    if (i !== -1 && i !== index) {
      e.preventDefault();
      setActive(i);
    }
    // i === index: leave it alone, the active card's real link navigates.
  }, true);

  if (prevBtn) prevBtn.addEventListener("click", () => setActive(index - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => setActive(index + 1));

  root.setAttribute("tabindex", "0");
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); setActive(index - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setActive(index + 1); }
  });

  setActive(0);
}

// --------------------------------------------------------------------------
// Page transitions.
//
// The cross-fade itself is pure CSS (`@view-transition` in style.css). All
// this does is name the two elements that should MORPH rather than fade: the
// project card's media well and title, which become the detail page's hero
// media and title. Only one card may carry those names at a time, so they're
// applied to the card being navigated to (or returned from) and removed
// again afterwards.
//
// Browsers without cross-document view transitions get a short exit fade
// instead — deliberately exit-only, so a failure can never leave someone
// looking at a blank page.
// --------------------------------------------------------------------------
function initPageTransitions() {
  if (LOW_POWER) {
    window.addEventListener("pageswap", (e) => e.viewTransition?.skipTransition());
    window.addEventListener("pagereveal", (e) => e.viewTransition?.skipTransition());
    return;
  }
  const supported = "startViewTransition" in document && "onpagereveal" in window;

  // Four generations of Projects markup can carry a project href: .proj-label
  // (the 3D scene's HTML labels), .proj-obj (the scatter field before it),
  // .carousel-link (the carousel experiment) and .proj-card (the flat grid
  // before that). Querying all four keeps the morph working whichever one is
  // live, without this needing to know which.
  //
  // Right now NONE of them are: the scene's labels were removed and its
  // projects are navigated by clicking the 3D models themselves, which cannot
  // be snapshotted for a shared-element transition. cardFor() therefore
  // returns null and those navigations simply cross-fade — which is correct,
  // not a bug. The selectors stay because the labels are expected back.
  function cardFor(url) {
    const m = String(url || "").match(/projects\/([a-z0-9-]+)\.html/i);
    if (!m) return null;
    return document.querySelector(
      '.proj-label[href$="' + m[1] + '.html"], ' +
      '.proj-obj[href$="' + m[1] + '.html"], ' +
      '.proj-card[href$="' + m[1] + '.html"], ' +
      '.carousel-link[href$="' + m[1] + '.html"]'
    );
  }

  function tag(card, on) {
    if (!card) return;
    const media = card.querySelector(".proj-obj-model, .proj-media, .carousel-model");
    // A scene label has no inner title element — the label IS the title, so it
    // tags itself. It has no media half at all: the "media" on the index side
    // is a 3D object inside a shared canvas, which cannot be snapshotted on
    // its own, so these navigations morph the title and cross-fade the rest.
    const title =
      card.querySelector(".proj-obj-label, .proj-title, .carousel-title") ||
      (card.classList.contains("proj-label") ? card : null);
    if (media) media.style.viewTransitionName = on ? "proj-media" : "";
    if (title) title.style.viewTransitionName = on ? "proj-title" : "";
  }

  // Going into a project page is "forward", returning is "back". The flag
  // has to be set on BOTH documents: the outgoing page's stylesheet drives
  // ::view-transition-old, the incoming page's drives ::view-transition-new.
  const isProject = (url) => /\/projects\/[a-z0-9-]+\.html/i.test(String(url || ""));
  function setDirection(fromUrl, toUrl) {
    let dir = "forward";
    if (isProject(fromUrl) && !isProject(toUrl)) dir = "back";
    document.documentElement.dataset.vt = dir;
  }

  // Tags the morphing card for one view transition, given the OTHER end's
  // URL (the page being navigated to, on the way out; the page navigated
  // from, on the way back in) — pageswap and pagereveal both need exactly
  // this, just with a different URL and a different ViewTransition object.
  function tagForTransition(url, viewTransition) {
    if (!viewTransition) return;
    const card = cardFor(url);
    if (!card) return;
    tag(card, true);
    // `finished` REJECTS when the transition is skipped — a reload, or a
    // navigation that gets interrupted. Untag either way, and handle the
    // rejection so it doesn't surface as an unhandled AbortError.
    const untag = () => tag(card, false);
    viewTransition.finished.then(untag, untag);
  }

  if (supported) {
    // Leaving: flag the direction and tag the card we're navigating into.
    window.addEventListener("pageswap", (e) => {
      // Direction first, unconditionally — it costs nothing and must not be
      // coupled to whether a transition happens to be running.
      const to = e.activation && e.activation.entry && e.activation.entry.url;
      setDirection(location.href, to);
      tagForTransition(to, e.viewTransition);
    });

    // Arriving: flag the direction and tag the card we came back from.
    window.addEventListener("pagereveal", (e) => {
      const from = window.navigation && navigation.activation && navigation.activation.from;
      setDirection(from && from.url, location.href);
      tagForTransition(from && from.url, e.viewTransition);
    });
    return;
  }

  if (REDUCED) return;

  // Fallback: fade out, then navigate.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;

    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    // Same document — that's the eased in-page scroll's job, not this.
    if (url.pathname === location.pathname && url.search === location.search) return;

    e.preventDefault();
    document.body.style.transition = "opacity .2s var(--ease)";
    document.body.style.opacity = "0";
    setTimeout(() => { location.href = a.href; }, 120);
  });
}

// --------------------------------------------------------------------------
// Live UTC readout
// --------------------------------------------------------------------------
function initClock() {
  const el = document.getElementById("utc-clock");
  if (!el) return;
  const pad = (n) => String(n).padStart(2, "0");
  function tick() {
    const d = new Date();
    el.textContent = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  }
  tick();
  setInterval(tick, 1000);
}

// --------------------------------------------------------------------------
document.documentElement.classList.add("js-scroll");

// If the fallback exit fade ran and the page comes back out of the bfcache,
// it would otherwise be restored still faded out.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    document.body.style.transition = "";
    document.body.style.opacity = "";
  }
});

// Registered at script execution rather than inside boot(): `pagereveal` is a
// page-lifecycle event that can fire before DOMContentLoaded, and a listener
// added afterwards simply never hears it. This script sits at the end of
// <body>, so the elements it needs are already parsed.
initPageTransitions();

function boot() {
  initResponsiveLayout();
  const syncVisibility = () => document.documentElement.classList.toggle("page-hidden", document.hidden);
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
  initTypingName();
  initIndexTyping();
  initReveal();
  initNav();
  initDescent();
  initScrollProgress();
  initStarfield();
  initMarqueeVisibility();
  initVideoVisibility();
  initClock();
  // The Projects section is one 3D scene now (js/system-scene.js, mounted
  // from index.html's module script) with no DOM objects to stagger in, so
  // initProjectField is gone entirely rather than left as a no-op.
  //
  // Still called, and still a no-op unless the carousel markup is uncommented
  // in index.html — it is one of the revert paths for this section.
  initProjectCarousel();
}

// This script is loaded at the end of <body>, so the DOM is already parsed
// and this normally runs before the first paint — which matters, because
// initStarfield has to restore the carried-over backdrop offset before the
// incoming view-transition snapshot is taken.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
