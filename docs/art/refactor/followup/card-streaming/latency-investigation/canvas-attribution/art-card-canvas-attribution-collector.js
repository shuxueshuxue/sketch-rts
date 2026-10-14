/** Diagnostic only. Captures existing Canvas-miss readbacks without adding a
 * draw/read or replacing their return values. Replay starts after GPU teardown.
 * The capture cycle has observer allocation overhead and is not a benchmark. */
const sourceRoot = __BENCHMARK_SOURCE_ROOT__;
const [{ World3DLayer }, { PaintedCardBatches }] = await Promise.all([
  import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/world-layer.ts`),
  import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/painted-card-batches.ts`),
]);
if (window.cardCanvasAttribution) throw new Error('Canvas collector already installed');

const records = [], keys = new Set(), batchLabels = new WeakMap(), liveLayers = new Set();
const frameCounts = new Map(), canvases = new Map(), paintedKeyCounts = new Map(), errors = [], skipped = {};
let config, activeDraw = null, activeRaster = null, capturing = false, sealed = false;
let draws = 0, rasterCalls = 0, actualRasterReadbacks = 0, originalReadCopies = 0, ownedOriginalBytes = 0, peakOriginalBytes = 0;
let replayBaselineBytes = 0, peakReplayBaselineBytes = 0, experimentCalls = 0;
const originals = { create: World3DLayer.create, draw: World3DLayer.prototype.draw,
  dispose: World3DLayer.prototype.dispose, raster: PaintedCardBatches.prototype.raster,
  getImageData: CanvasRenderingContext2D.prototype.getImageData };
const bump = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
const cacheState = batch => ({ hits: batch.rasterCache.hits, misses: batch.rasterCache.misses,
  bypass: batch.rasterCache.bypass, paintMs: batch.rasterStages.paintMs,
  uploads: batch.mipUploader.layerUpdates });
const hashBytes = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
function encode(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 32768)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(parts.join(''));
}
function decode(value) {
  const text = atob(value), bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
function compare(a, b) {
  if (a.length !== b.length) return { passed: false, changedChannels: null, maximum: null,
    expectedBytes: a.length, actualBytes: b.length };
  let changedChannels = 0, maximum = 0;
  for (let i = 0; i < a.length; i++) {
    const difference = Math.abs(a[i] - b[i]);
    if (difference) { changedChannels++; maximum = Math.max(maximum, difference); }
  }
  return { passed: changedChannels === 0, changedChannels, maximum, comparedBytes: a.length };
}

function create(...args) {
  const layer = originals.create.apply(this, args);
  if (layer) { liveLayers.add(layer); batchLabels.set(layer.cards, 'cards'); batchLabels.set(layer.remainsCards, 'remains'); }
  return layer;
}
function draw(frame) {
  const previous = activeDraw, rawN = frame.now * 60 / 1000, n = Math.round(rawN);
  const eligible = capturing && Math.abs(rawN - n) < .00001 && config.captureNs.includes(n);
  activeDraw = eligible ? { n, rawN, now: frame.now, tick: frame.snapshot.tick, drawIndex: draws,
    units: new Map(frame.snapshot.units.map(unit => [unit.id, unit])) } : null;
  draws++;
  try { return originals.draw.call(this, frame); }
  finally { activeDraw = previous; }
}
function dispose(...args) {
  const value = originals.dispose.apply(this, args);
  liveLayers.delete(this); return value;
}
function raster(...args) {
  const previous = activeRaster, request = args[0], frame = activeDraw;
  let candidate;
  if (frame && records.length < config.maxSamples && !keys.has(request.key)
    && (frameCounts.get(frame.n) ?? 0) < config.quotas[String(frame.n)]) {
    const old = this.cards.get(request.key), before = cacheState(this), unit = frame.units.get(request.id);
    candidate = { index: records.length, key: request.key, poseKey: request.key, id: request.id,
      density: request.density, tileSize: request.tileSize, size: request.tileSize * request.density,
      requestedBaseMip: args[2], batch: batchLabels.get(this) ?? 'unregistered',
      n: frame.n, rawN: frame.rawN, now: frame.now, tick: frame.tick, drawIndex: frame.drawIndex,
      rasterCallIndex: rasterCalls, callback: request.paint, callbackSource: String(request.paint),
      matrix: Array.from(request.matrix.elements), foot: request.foot, opacity: request.opacity,
      unit: unit ? { id: unit.id, kind: unit.kind, owner: unit.owner, variant: unit.variant ?? null,
        x: unit.x, y: unit.y, hp: unit.hp, radius: unit.radius } : null,
      before: { ...before, existingGpuCard: !!old, existingBaseMip: old?.baseMip ?? null,
        encodedCpuEntryPresent: this.rasterCache.entries.has(request.key),
        priorActualCanvasPaintsForKey: paintedKeyCounts.get(request.key) ?? 0,
        needsRaster: !old || old.baseMip > args[2] }, original: null };
  }
  rasterCalls++;
  activeRaster = { request, candidate };
  let success = false;
  try { const result = originals.raster.apply(this, args); success = true; return result; }
  finally {
    activeRaster = previous;
    if (candidate?.original && success) {
      const after = cacheState(this);
      candidate.actual = { cacheHits: after.hits - candidate.before.hits,
        cacheMisses: after.misses - candidate.before.misses,
        paintSubmissionMs: after.paintMs - candidate.before.paintMs,
        uploadedLayers: after.uploads - candidate.before.uploads,
        actualCanvasMiss: after.misses > candidate.before.misses,
        firstActualCanvasPaintForKey: candidate.before.priorActualCanvasPaintsForKey === 0,
        originalReadbackCopied: true, noExtraReadback: true,
        rgbaCopiedBeforeProductionRowFlip: true };
      records.push(candidate); keys.add(candidate.key);
      frameCounts.set(candidate.n, (frameCounts.get(candidate.n) ?? 0) + 1);
      ownedOriginalBytes += candidate.original.byteLength;
      peakOriginalBytes = Math.max(peakOriginalBytes, ownedOriginalBytes);
    } else if (candidate) bump(success ? 'gpu-reuse-or-cpu-cache-no-original-read' : 'raster-failed');
  }
}
function getImageData(...args) {
  // The production call and its returned ImageData are left intact. Capture a
  // separate copy now: production subsequently flips this original in place.
  const image = originals.getImageData.apply(this, args), call = activeRaster, candidate = call?.candidate;
  const size = call ? call.request.tileSize * call.request.density : null;
  if (call && args[0] === 0 && args[1] === 0 && args[2] === size && args[3] === size
    && image.width === size && image.height === size) {
    paintedKeyCounts.set(call.request.key, (paintedKeyCounts.get(call.request.key) ?? 0) + 1);
    actualRasterReadbacks++;
  }
  if (candidate && !candidate.original && args[0] === 0 && args[1] === 0
    && args[2] === candidate.size && args[3] === candidate.size
    && image.width === candidate.size && image.height === candidate.size) {
    const started = performance.now();
    candidate.original = new Uint8Array(image.data.length); candidate.original.set(image.data);
    candidate.observerCopyMs = performance.now() - started;
    candidate.contextAttributes = typeof this.getContextAttributes === 'function' ? this.getContextAttributes() : null;
    candidate.originalReadOrdinal = originalReadCopies++;
  }
  return image;
}
World3DLayer.create = create; World3DLayer.prototype.draw = draw;
World3DLayer.prototype.dispose = dispose; PaintedCardBatches.prototype.raster = raster;
CanvasRenderingContext2D.prototype.getImageData = getImageData;

function guardReplay() {
  if (!sealed || capturing || liveLayers.size || activeDraw || activeRaster)
    throw new Error('Canvas replay requires sealed capture and fully disposed World layers');
  if (ownedOriginalBytes !== 0) throw new Error('Export and release every original RGBA before replay');
}
function describe(record) {
  const { callback, original, ...metadata } = record;
  return { ...metadata, width: record.size, height: record.size, format: 'RGBA8',
    rowOrientation: 'top-down', maskFlipYForCanvasMiss: true,
    callbackProvenance: 'Original Request.paint received by production PaintedCardBatches.raster; callback identity and raster arguments are unchanged.',
    rgbaProvenance: 'Copy of that raster\'s existing full-domain getImageData result, before its production mask/rowFlip/upload.',
    sourceCallbackLocation: `src/client/world3d/world-layer.ts:${record.batch === 'remains' ? 'remainsCards.add' : 'cards.add'}` };
}
function points(bytes, size) {
  const pixel = (x, y) => Array.from(bytes.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
  let interior = null, fallback = null;
  for (let y = 0; y < size && !interior; y++) for (let x = 0; x < size; x++) {
    if (!bytes[(y * size + x) * 4 + 3]) continue;
    fallback ??= { x, y, rgba: pixel(x, y), criterion: 'nonzero-alpha' };
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1 || bytes[(y * size + x) * 4 + 3] !== 255) continue;
    let opaque = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (bytes[((y + dy) * size + x + dx) * 4 + 3] < 102) opaque = false;
    if (opaque) { interior = { x, y, rgba: pixel(x, y), criterion: 'opaque-center-with-3x3-covered-neighbors' }; break; }
  }
  interior ??= fallback;
  const corners = [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]];
  const corner = corners.find(([x, y]) => pixel(x, y).every(value => value === 0));
  return { interior, transparentCorner: corner ? { x: corner[0], y: corner[1], rgba: pixel(...corner), criterion: 'four-rgba-components-zero' } : null,
    interiorUnavailableReason: interior ? null : 'No alpha-positive pixel in actual original RGBA',
    transparentCornerUnavailableReason: corner ? null : 'None of the four corner pixels has zero RGBA' };
}
function acquire(size) {
  const started = performance.now(); let pooled = canvases.get(size), firstCanvasDraw = false;
  if (!pooled) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D context unavailable');
    pooled = { canvas, context, draws: 0 }; canvases.set(size, pooled); firstCanvasDraw = true;
  }
  return { pooled, firstCanvasDraw, canvasAcquireMs: performance.now() - started };
}
async function baselineFor(index, base64) {
  guardReplay(); const record = records[index];
  if (!record?.originalSha256) throw new Error('Unknown or unexported original sample');
  const started = performance.now(), bytes = decode(base64), decodeMs = performance.now() - started;
  if (bytes.byteLength !== record.size ** 2 * 4 || await hashBytes(bytes) !== record.originalSha256)
    throw new Error('Host baseline differs from original captured RGBA');
  replayBaselineBytes = bytes.byteLength; peakReplayBaselineBytes = Math.max(peakReplayBaselineBytes, replayBaselineBytes);
  return { record, bytes, decodeMs };
}
const orders = [['A', 'B', 'D', 'C'], ['C', 'D', 'B', 'A'], ['B', 'C', 'A', 'D'], ['D', 'A', 'C', 'B']];
async function mode(record, baseline, arm, round, phase) {
  const selectedPoint = arm === 'B' ? record.points.interior : arm === 'C' ? record.points.transparentCorner : null;
  if ((arm === 'B' || arm === 'C') && !selectedPoint) return { index: record.index, key: record.key, arm, round, phase,
    status: 'unavailable', reason: arm === 'B' ? record.points.interiorUnavailableReason : record.points.transparentCornerUnavailableReason };
  const { pooled, firstCanvasDraw, canvasAcquireMs } = acquire(record.size);
  // Exactly the production setup, including a getContext call on the pooled
  // canvas. It is never resized between modes or samples of the same size.
  const t0 = performance.now(), ctx = pooled.canvas.getContext('2d', { willReadFrequently: true });
  ctx.resetTransform(); ctx.clearRect(0, 0, record.size, record.size); ctx.save();
  ctx.scale(record.density, record.density); ctx.translate(record.tileSize / 2, record.tileSize / 2);
  try { record.callback(ctx); } finally { ctx.restore(); }
  const t1 = performance.now(); let small, first, last, t2 = t1, t3;
  if (selectedPoint) { small = ctx.getImageData(selectedPoint.x, selectedPoint.y, 1, 1); t2 = performance.now(); }
  first = ctx.getImageData(0, 0, record.size, record.size); t3 = performance.now();
  if (arm === 'D') last = ctx.getImageData(0, 0, record.size, record.size);
  else last = first;
  const t4 = arm === 'D' ? performance.now() : t3;
  const row = { index: record.index, key: record.key, arm, round, phase, status: 'measured',
    firstCanvasDraw, firstCallbackReplay: phase === 'initial-replay', canvasAcquireMs,
    paintSubmissionMs: t1 - t0, smallReadMs: t2 - t1, fullRead1Ms: t3 - t2,
    fullRead2Ms: t4 - t3, allReadWallMs: t4 - t1, paintAndAllReadsWallMs: t4 - t0,
    measuredFrom: 'Before production getContext/reset/clear/save/scale/translate',
    measuredUntil: 'Return of the final complete-domain getImageData',
    fullReadCount: arm === 'D' ? 2 : 1, smallReadCount: selectedPoint ? 1 : 0,
    fullReadAllocatedBytes: record.size ** 2 * 4 * (arm === 'D' ? 2 : 1),
    smallReadAllocatedBytes: selectedPoint ? 4 : 0,
    firstReadHeldUntilFinalRead: arm === 'D', point: selectedPoint,
    fullReadIncludes: 'Deferred Canvas execution, synchronous flush, pixel conversion/copy and the API-owned output allocation; these cannot be split by public API timing alone.' };
  pooled.draws++; experimentCalls++;
  // Byte scans and async SHA are after every measured region. D validates both
  // outputs and retains full1 until full2 has completed, as reported above.
  row.firstRgbaComparison = compare(baseline, first.data);
  row.finalRgbaComparison = arm === 'D' ? compare(baseline, last.data) : row.firstRgbaComparison;
  row.firstSha256 = await hashBytes(first.data);
  row.finalSha256 = arm === 'D' ? await hashBytes(last.data) : row.firstSha256;
  row.smallRgbaComparison = small ? compare(selectedPoint.rgba, small.data) : null;
  row.passed = row.firstRgbaComparison.passed && row.finalRgbaComparison.passed
    && row.firstSha256 === record.originalSha256 && row.finalSha256 === record.originalSha256
    && (!small || row.smallRgbaComparison.passed);
  return row;
}

window.cardCanvasAttribution = {
  installed: true,
  begin(options = {}) {
    if (config || sealed) throw new Error('Collector supports one capture lifetime');
    const captureNs = options.captureNs ?? [116, 135, 158], maxSamples = options.maxSamples ?? 36;
    const quotas = options.quotas ?? { 116: 8, 135: 20, 158: 8 };
    if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 40
      || captureNs.some(n => !Number.isInteger(n) || !Number.isInteger(quotas[n]) || quotas[n] < 1))
      throw new Error('Invalid finite capture limits');
    config = { ...options, captureNs, maxSamples, quotas }; capturing = true;
    return config;
  },
  seal() {
    capturing = false;
    if (liveLayers.size || activeDraw || activeRaster) throw new Error('World/upload lifetime still active');
    for (const [object, key, hook, original] of [[World3DLayer, 'create', create, originals.create],
      [World3DLayer.prototype, 'draw', draw, originals.draw], [World3DLayer.prototype, 'dispose', dispose, originals.dispose],
      [PaintedCardBatches.prototype, 'raster', raster, originals.raster],
      [CanvasRenderingContext2D.prototype, 'getImageData', getImageData, originals.getImageData]]) {
      if (object[key] !== hook) throw new Error(`Collector hook changed: ${key}`);
      object[key] = original;
    }
    sealed = true;
    return { samples: records.length, config, draws, rasterCalls, actualRasterReadbacks, originalReadCopies,
      byN: Object.fromEntries(frameCounts), skipped, errors, liveWorldLayers: liveLayers.size,
      ownedOriginalRgbaBytes: ownedOriginalBytes, peakOriginalRgbaBytes: peakOriginalBytes,
      noExtraPaintsOrReadbacksDuringCapture: true, captureIsFormalTiming: false,
      sourceKindCoverage: [...new Set(records.map(record => record.unit?.kind).filter(Boolean))],
      gpuTeardown: 'Fixture completes its GPU waits, disposes WorldPresentation and its World3DLayer; production renderer.dispose/forceContextLoss is retained. Harness calls viewportReview.teardown before replay.' };
  },
  async exportOriginal(index) {
    if (!sealed) throw new Error('Seal and dispose before exporting originals');
    const record = records[index]; if (!record?.original) throw new Error('Original RGBA already exported or sample missing');
    record.originalSha256 = await hashBytes(record.original); record.points = points(record.original, record.size);
    const result = { sample: describe(record), rgbaBase64: encode(record.original) };
    ownedOriginalBytes -= record.original.byteLength; record.original = null;
    return result;
  },
  async runSample(index, baselineBase64, round = -1) {
    const { record, bytes, decodeMs } = await baselineFor(index, baselineBase64), rows = [];
    try {
      const phase = round < 0 ? 'initial-replay' : 'balanced-round';
      for (const arm of round < 0 ? ['A'] : orders[round % orders.length]) rows.push(await mode(record, bytes, arm, round, phase));
      return { index, round, phase, baselineDecodeMsOutsideTimers: decodeMs, rows,
        passed: rows.filter(row => row.status === 'measured').every(row => row.passed) };
    } finally { replayBaselineBytes = 0; }
  },
  async allocationControl(index, baselineBase64, repeats = 4) {
    const { record, bytes, decodeMs } = await baselineFor(index, baselineBase64), rows = [];
    try {
      for (let repeat = 0; repeat < repeats; repeat++) {
        const t0 = performance.now(), output = new Uint8ClampedArray(bytes.length), t1 = performance.now();
        output.set(bytes); const t2 = performance.now();
        rows.push({ index, repeat, allocateMs: t1 - t0, copyAndTouchMs: t2 - t1,
          allocationAndCopyWallMs: t2 - t0, bytes: output.length, comparison: compare(bytes, output) });
      }
      return { index, baselineDecodeMsOutsideTimers: decodeMs, rows,
        scope: 'Separate control AFTER every Canvas mode round. Allocation may reserve lazy zero pages; set() also touches/commits memory. Not subtracted from getImageData or added to its already-inclusive timing.',
        passed: rows.every(row => row.comparison.passed) };
    } finally { replayBaselineBytes = 0; }
  },
  state() { return { sealed, capturing, samples: records.length, liveWorldLayers: liveLayers.size,
    ownedOriginalRgbaBytes: ownedOriginalBytes, peakOriginalRgbaBytes: peakOriginalBytes,
    replayBaselineBytes, peakReplayBaselineBytes, experimentCalls,
    canvasDomains: [...canvases].map(([size, pooled]) => ({ size, draws: pooled.draws, willReadFrequently: true,
      backingRgbaByteEstimate: size ** 2 * 4 })),
    callbackRetention: 'Original callbacks remain alive for replay and may retain source snapshots or model objects. GPU disposal and no submissions do not imply zero game-related memory.',
    meaning: 'Canvas-only attribution diagnostic, not game performance or a proof that a 1px read flushes the whole canvas.' }; },
  release() { guardReplay(); for (const pooled of canvases.values()) pooled.canvas.width = pooled.canvas.height = 0;
    canvases.clear(); for (const record of records) record.callback = null; return true; },
};
