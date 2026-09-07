// Hardware hints are optional (Firefox/Safari may omit deviceMemory).
// Runtime frame measurements handle devices whose hints overstate capacity.
export const LOW_POWER = Boolean(
  (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  navigator.connection?.saveData
);

export function createRenderBudget(maxPixels, ceiling = 1.5) {
  let scale = 1;
  return {
    ratio(width, height) {
      // No DPR floor: it would defeat the area limit on 4K/ultrawide screens.
      return Math.min(window.devicePixelRatio || 1, LOW_POWER ? 1 : ceiling,
        Math.sqrt(maxPixels * (LOW_POWER ? 0.55 : 1) / Math.max(1, width * height))) * scale;
    },
    reduce() {
      scale = Math.max(0.6, scale * 0.8);
    },
  };
}

export const yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0));

// These simulation exports contain numeric columns, without quoted fields.
export async function loadNumericCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load simulation data: ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((header) => header.trim());
  const columns = Object.fromEntries(headers.map((header) => [header, new Array(lines.length - 1)]));
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    for (let j = 0; j < headers.length; j++) columns[headers[j]][i - 1] = parseFloat(values[j]);
    // Release parsed strings and let input/painting run between chunks.
    lines[i] = "";
    if (i % 256 === 0) await yieldToPage();
  }
  return columns;
}

export async function prepareShaders(renderer, scene, camera) {
  await yieldToPage();
  // r160 supports this extension-backed path. The synchronous fallback still
  // yields between startup stages on drivers without parallel compilation.
  if (renderer.extensions.has("KHR_parallel_shader_compile")) {
    await renderer.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }
  await yieldToPage();
}

// Sleep between low-frequency draws instead of waking at the display's full
// refresh rate just to skip frames. rAF keeps the actual draw aligned to paint.
export function createFrameLoop(draw, { fps = 30, continuous = true, onSlow } = {}) {
  let running = false;
  let timer = null;
  let frame = null;
  let previous = 0;
  let deadline = 0;
  let samples = 0;
  let slow = 0;
  let reductions = 0;

  function schedule() {
    if (!running || document.hidden || timer !== null || frame !== null) return;
    const delay = deadline - performance.now() - 8;
    if (delay > 8) {
      timer = setTimeout(() => {
        timer = null;
        if (running && !document.hidden) frame = requestAnimationFrame(tick);
      }, delay);
    } else {
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    frame = null;
    if (!running || document.hidden) return;
    if (now + 1 < deadline) { schedule(); return; }
    const rate = typeof fps === "function" ? fps() : fps;
    const interval = 1000 / (rate / (1 + reductions * 0.5));
    const elapsed = previous ? now - previous : interval;
    const started = performance.now();
    draw(now, Math.min(elapsed, 100) / 1000);
    // Ignore the first frame after resuming and isolated startup/resize stalls.
    if (previous && continuous && onSlow && reductions < 2) {
      samples++;
      if (elapsed > interval * 1.65 || performance.now() - started > interval * 0.8) slow++;
      if (samples >= 90) {
        if (slow / samples > 0.3) { reductions++; onSlow(); }
        samples = slow = 0;
      }
    }
    previous = now;
    deadline = deadline ? Math.max(now, deadline + interval) : now + interval;
    if (continuous) schedule();
    else running = false;
  }

  return {
    start() {
      if (running || document.hidden) return;
      running = true;
      previous = deadline = samples = slow = 0;
      schedule();
    },
    stop() {
      running = false;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      timer = frame = null;
      previous = 0;
    },
  };
}
