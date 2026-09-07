// --------------------------------------------------------------------------
// Hand-built SVG line charts for thesis.html's five simulation plots — pulled
// out of cmg-scene.js so it has NO three.js dependency at all. cmg-scene.js
// (the live, animated experience) still imports buildChart/findFrame from
// here unchanged; js/cmg-scene-static.js (the old-browser fallback, see its
// header) imports the exact same functions to draw the same real data as
// plain static SVG, without ever touching three.js or its addons.
// --------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Binary-search the sample bracketing t, return interpolation fraction and
// the count of samples at-or-before t (for the charts' "drawn so far" cut).
export function findFrame(t, tv) {
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

export const CHART_COLORS = ["#e74c3c", "#2ecc71", "#3498db", "#c9b46a"];

// Keep the original slow rate (35 simulation seconds per 8 playback seconds)
// through the first 100 s, covering retargeting and the subsequent settling.
// Both plots retain their 0–100 s window until this slow segment ends.
export const T_SPLIT_SIM = 100;

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_W = 600,
  CHART_H = 300;
const CHART_MARGIN = { l: 68, r: 20, t: 14, b: 30 };
let chartId = 0;

export function buildChart(container, t, seriesArrays, title, colors = CHART_COLORS) {
  let width = 0;
  let simTime = 0;
  let zoom = 0;
  let draw = () => {};
  let timer = null;
  function rebuild() {
    const nextWidth = Math.max(320, Math.min(CHART_W, Math.round(container.clientWidth || CHART_W)));
    if (nextWidth === width) return;
    width = nextWidth;
    container.replaceChildren();
    draw = buildChartAtWidth(container, t, seriesArrays, title, colors, width);
    draw(simTime, zoom);
  }
  rebuild();
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      clearTimeout(timer);
      // Rebuild only after width settles, not for every frame of a resize.
      timer = setTimeout(rebuild, 160);
    }).observe(container);
  }
  return (time, nextZoom = 0) => {
    simTime = time;
    zoom = nextZoom;
    draw(time, nextZoom);
  };
}

function buildChartAtWidth(container, t, seriesArrays, title, colors, CHART_W) {
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
