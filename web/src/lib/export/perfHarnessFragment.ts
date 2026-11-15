/**
 * Performance-capture harness emitted into every exported game (#10013,
 * operation `performance.FR-3.OP-01`).
 *
 * DORMANT unless armed: a normal player never loads it into action. It arms when
 * the page URL carries `?forgePerf=1` (optionally `forgePerfWarmupMs` /
 * `forgePerfCaptureMs`, bounded integers), or when `window.__forgePerfConfig`
 * is set before the script runs. Armed, it defines `window.__forgePerfHooks`,
 * which the export templates call at these points:
 *
 *   initStart()   first line of init — the player's click
 *   backend(v)    the WASM variant actually loaded
 *   wasm(exports) the module exports, for its linear memory
 *   sceneLoad(r)  the engine's answer to load_scene (accepted = queued)
 *   sceneApplied  the engine's SCENE_LOADED event (the scene was applied),
 *                 forwarded by the export's event callback
 *   frame(now)    top of every game-loop frame
 *   fail(err)     init threw
 *
 * It records raw frame timestamps from the first game-loop frame (also the
 * `forge:first-interactive` performance mark) until warm-up + capture have
 * elapsed, then collects the environment (user agent and client-hint versions,
 * device memory, viewport, GPU adapter, JS heap, WASM memory, engine resource
 * timing), sets `window.__forgePerf.status = 'complete'` and dispatches
 * `forge:perf-capture-complete`. No network, no storage, no UI.
 *
 * Windowing and statistics are NOT done here: `lib/perf/exportedCapture.ts`
 * turns `window.__forgePerf` into a report with the same code the editor
 * capture uses, so the arithmetic has one implementation.
 */

/** Bounds for URL-supplied protocol overrides, in milliseconds. */
export const HARNESS_WARMUP_MAX_MS = 600_000;
export const HARNESS_CAPTURE_MIN_MS = 1_000;
export const HARNESS_CAPTURE_MAX_MS = 600_000;

/**
 * Classic-script source for the harness bootstrap. Place it before the module
 * script that boots the engine.
 * @returns Script source (no surrounding tag).
 */
export function generatePerfHarnessBootstrap(): string {
  return `(function () {
  var cfg = window.__forgePerfConfig || null;
  if (!cfg) {
    var q = null;
    try { q = new URLSearchParams(window.location.search); } catch (e) { q = null; }
    if (!q || q.get('forgePerf') !== '1') return;
    cfg = { warmupMs: q.get('forgePerfWarmupMs'), captureMs: q.get('forgePerfCaptureMs') };
  }
  function bounded(v, lo, hi, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = Number(v);
    return isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi ? n : fallback;
  }
  var protocol = {
    warmupMs: bounded(cfg.warmupMs, 0, ${HARNESS_WARMUP_MAX_MS}, 10000),
    captureMs: bounded(cfg.captureMs, ${HARNESS_CAPTURE_MIN_MS}, ${HARNESS_CAPTURE_MAX_MS}, 60000)
  };
  var total = protocol.warmupMs + protocol.captureMs;
  var h = window.__forgePerf = {
    harnessVersion: 1,
    status: 'armed',
    protocol: protocol,
    initStartMs: null,
    firstFrameMs: null,
    frameTimestampsMs: [],
    hiddenDuringCapture: false,
    backend: 'unknown',
    sceneLoad: null,
    sceneApplied: false,
    sceneName: null,
    error: null,
    startedAt: null,
    completedAt: null,
    env: null
  };
  var wasmMemory = null;
  function announce() {
    try { window.dispatchEvent(new CustomEvent('forge:perf-capture-complete', { detail: h })); } catch (e) {}
  }
  function noop() {}
  function collectEnv() {
    var nav = navigator || {};
    var env = {
      userAgent: nav.userAgent || null,
      deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      memory: null,
      wasmMemoryBytes: null,
      resources: [],
      fullVersionList: null,
      gpu: null
    };
    try {
      if (performance.memory) env.memory = { usedJSHeapSize: performance.memory.usedJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit };
    } catch (e) {}
    try { if (wasmMemory && wasmMemory.buffer) env.wasmMemoryBytes = wasmMemory.buffer.byteLength; } catch (e) {}
    try {
      var entries = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
      for (var i = 0; i < entries.length; i++) {
        var r = entries[i];
        if (/forge_engine_bg\\.wasm/.test(r.name)) {
          env.resources.push({ name: r.name, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize });
        }
      }
    } catch (e) {}
    var waits = [];
    try {
      if (nav.userAgentData && nav.userAgentData.getHighEntropyValues) {
        waits.push(nav.userAgentData.getHighEntropyValues(['fullVersionList']).then(function (v) { env.fullVersionList = (v && v.fullVersionList) || null; }, noop));
      }
    } catch (e) {}
    try {
      if (h.backend === 'webgpu' && nav.gpu) {
        waits.push(nav.gpu.requestAdapter().then(function (a) {
          if (a && a.info) env.gpu = { vendor: a.info.vendor || '', architecture: a.info.architecture || '', device: a.info.device || '', description: a.info.description || '' };
        }, noop));
      } else if (h.backend === 'webgl2') {
        var gl = document.createElement('canvas').getContext('webgl2');
        if (gl) {
          var dbg = gl.getExtension('WEBGL_debug_renderer_info');
          env.gpu = { renderer: String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) };
          var lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        }
      }
    } catch (e) {}
    return Promise.all(waits).then(function () { return env; });
  }
  function finish() {
    h.status = 'collecting';
    h.completedAt = new Date().toISOString();
    collectEnv().then(function (env) {
      h.env = env;
      h.status = 'complete';
      announce();
    }, function (e) {
      h.error = String(e);
      h.status = 'complete';
      announce();
    });
  }
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && h.status === 'recording') h.hiddenDuringCapture = true;
    });
  } catch (e) {}
  window.__forgePerfHooks = {
    initStart: function () {
      if (h.initStartMs === null) { h.initStartMs = performance.now(); h.startedAt = new Date().toISOString(); }
    },
    backend: function (v) { h.backend = v === 'webgpu' || v === 'webgl2' ? v : 'unknown'; },
    wasm: function (exp) { try { if (exp && exp.memory) wasmMemory = exp.memory; } catch (e) {} },
    sceneLoad: function (res) {
      try { h.sceneLoad = { success: !!(res && res.success), error: res && res.error ? String(res.error) : null }; } catch (e) {}
    },
    sceneApplied: function (name) {
      h.sceneApplied = true;
      h.sceneName = typeof name === 'string' ? name : null;
    },
    fail: function (err) {
      if (h.status === 'complete') return;
      h.status = 'failed';
      h.error = String((err && err.message) || err);
      announce();
    },
    frame: function (now) {
      if ((h.status !== 'armed' && h.status !== 'recording') || typeof now !== 'number' || !isFinite(now)) return;
      var ts = h.frameTimestampsMs;
      if (ts.length && now < ts[ts.length - 1]) return;
      if (h.firstFrameMs === null) {
        h.firstFrameMs = now;
        h.status = 'recording';
        try { performance.mark('forge:first-interactive'); } catch (e) {}
      }
      ts.push(now);
      if (now - h.firstFrameMs >= total) finish();
    }
  };
})();`;
}
