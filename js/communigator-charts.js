/* Static flight-data charts for projects/rocket-software.html.
   The workbook is converted once to assets/data/communigator-flight-data.json;
   this page intentionally draws no animation or playback clock. */
(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const W = 600;
  const H = 300;
  const M = { l: 68, r: 20, t: 14, b: 30 };
  const COLORS = { altitude: "#64ffe1", velocity: "#c9b46a" };

  function makeSvg(points, key, title, unit) {
    const plotW = W - M.l - M.r;
    const plotH = H - M.t - M.b;
    const tMax = points[points.length - 1].t || 1;
    const values = points.map((p) => p[key]);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    const span = hi - lo || 1;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", title);
    svg.style.fontFamily = "'JetBrains Mono', ui-monospace, monospace";

    const line = (x1, y1, x2, y2, color = "#3d3a39") => {
      const el = document.createElementNS(SVG_NS, "line");
      el.setAttribute("x1", x1); el.setAttribute("y1", y1);
      el.setAttribute("x2", x2); el.setAttribute("y2", y2);
      el.setAttribute("stroke", color); el.setAttribute("stroke-width", "1");
      svg.appendChild(el);
      return el;
    };
    const text = (x, y, value, anchor = "middle") => {
      const el = document.createElementNS(SVG_NS, "text");
      el.setAttribute("x", x); el.setAttribute("y", y);
      el.setAttribute("text-anchor", anchor); el.setAttribute("font-size", "12");
      el.setAttribute("fill", "#b8b3b0"); el.textContent = value;
      svg.appendChild(el);
      return el;
    };
    const bottom = M.t + plotH;
    line(M.l, M.t, M.l, bottom);
    line(M.l, bottom, M.l + plotW, bottom);
    for (let i = 0; i < 5; i++) {
      const y = bottom - (i / 4) * plotH;
      line(M.l - 4, y, M.l, y);
      const value = lo + (i / 4) * span;
      text(M.l - 8, y + 3, value.toLocaleString(undefined, { maximumFractionDigits: 1 }), "end");
    }
    for (let i = 0; i < 6; i++) {
      const x = M.l + (i / 5) * plotW;
      line(x, bottom, x, bottom + 4);
      text(x, bottom + 16, (tMax * i / 5).toLocaleString(undefined, { maximumFractionDigits: 1 }), i === 5 ? "end" : "middle");
    }
    text(M.l + plotW / 2, H - 4, "time (s)");
    const yLabel = text(14, M.t + plotH / 2, unit, "middle");
    yLabel.setAttribute("transform", `rotate(-90 14 ${M.t + plotH / 2})`);

    const path = document.createElementNS(SVG_NS, "path");
    const stride = Math.max(1, Math.ceil(points.length / 1600));
    let d = "";
    for (let i = 0; i < points.length; i += stride) {
      const x = M.l + (points[i].t / tMax) * plotW;
      const y = bottom - ((points[i][key] - lo) / span) * plotH;
      d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    const last = points[points.length - 1];
    d += `L${(M.l + plotW).toFixed(2)} ${(bottom - ((last[key] - lo) / span) * plotH).toFixed(2)}`;
    path.setAttribute("d", d);
    path.setAttribute("fill", "none"); path.setAttribute("stroke", COLORS[key]);
    path.setAttribute("stroke-width", "1.4"); path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(path);
    return svg;
  }

  async function init() {
    const charts = document.querySelector("[data-flight-charts]");
    if (!charts) return;
    try {
      const response = await fetch("../assets/data/communigator-flight-data.json");
      if (!response.ok) throw new Error(`flight data ${response.status}`);
      const points = await response.json();
      const configs = [
        ["altitude", "Filtered altitude versus time", "altitude (m)"],
        ["velocity", "Filtered velocity versus time", "velocity (m/s)"],
      ];
      configs.forEach(([key, title, unit]) => {
        const target = charts.querySelector(`[data-flight-chart="${key}"]`);
        if (target) target.prepend(makeSvg(points, key, title, unit));
      });
    } catch (error) {
      charts.textContent = "flight data unavailable";
      console.error("Communigator flight charts failed", error);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
