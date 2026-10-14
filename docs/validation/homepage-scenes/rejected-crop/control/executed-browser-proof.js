// External observation module. Imports and executes the actual source painters.
import { RasterCache } from '/src/client/art/raster-cache.ts';
import { drawAtlasCorpse, drawAtlasUnit, drawAtlasModel, drawAtlasProp,
  canvasArtCacheStats, clearCanvasArtCache } from '/src/client/atlas-art.ts';
import { createPirateBoarding } from '/src/client/menu-pirate-boarding.ts';
import { CORE_SCENERY } from '/src/client/art/scenery.ts';

const scene = createPirateBoarding();
const ids = new WeakMap();
let serial = 0, activeTrace = null;
const idOf = object => {
  if (!ids.has(object)) ids.set(object, ++serial);
  return ids.get(object);
};
const nativeGet = RasterCache.prototype.get;
RasterCache.prototype.get = function (key, density, paint, tileSize = 128) {
  const before = this.stats();
  const result = nativeGet.call(this, key, density, paint, tileSize);
  if (activeTrace) activeTrace.push({ key, requestedDensity: density, tileSize,
    cacheId: idOf(this), canvasId: idOf(result.canvas),
    hit: this.stats().hits > before.hits,
    canvas: result.canvas, x: result.x, y: result.y, density: result.density });
  return result;
};

function encode(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16384)
    binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return btoa(binary);
}
function alphaSummary(bytes, width, height) {
  let opaque = 0, translucent = 0, transparent = 0, sumAlpha = 0;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = bytes[(y * width + x) * 4 + 3];
    sumAlpha += alpha;
    if (alpha === 0) transparent++;
    else {
      alpha === 255 ? opaque++ : translucent++;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { opaque, translucent, transparent, sumAlpha,
    bounds: right < left ? null : { left, top, right, bottom } };
}
function capture(canvas, anchor = null) {
  const ctx = canvas.getContext('2d');
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, anchor,
    contextAttributes: ctx.getContextAttributes?.() ?? null,
    alpha: alphaSummary(rgba, canvas.width, canvas.height), rgbaBase64: encode(rgba) };
}
function outerCanvas(spec) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = spec.tileSize * spec.density;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.resetTransform(); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.scale(spec.density, spec.density);
  ctx.translate(spec.tileSize / 2, spec.tileSize / 2);
  return { canvas, ctx };
}
function paintCase(spec, ctx) {
  if (spec.type === 'corpse') {
    const model = scene.models?.(spec.modelKey);
    if (!model?.remains) throw new Error('Actual scene corpse model missing: ' + spec.modelKey);
    // Exact callback coordinates, tile, density, scale and appearance used by WorldLayer.
    drawAtlasCorpse(ctx, spec.kind, { x: 0, y: -7 }, 1, spec.variant,
      model, spec.modelKey, spec.color, spec.presentation);
  } else if (spec.type === 'model') {
    const model = scene.models?.(spec.modelKey);
    if (!model) throw new Error('Actual scene model missing: ' + spec.modelKey);
    drawAtlasModel(ctx, spec.modelKey, model, { x: 0, y: 0 }, 1,
      spec.color, spec.facing, spec.pose, spec.presentation);
  } else if (spec.type === 'unit') {
    drawAtlasUnit(ctx, spec.kind, { x: 0, y: 0 }, 1, spec.color,
      spec.facing, spec.pose, spec.presentation);
  } else if (spec.type === 'environment') {
    const painter = CORE_SCENERY[spec.kind];
    if (!painter) throw new Error('Actual scenery painter missing: ' + spec.kind);
    drawAtlasProp(ctx, 'proof:' + spec.kind + ':' + (spec.state ?? ''),
      brush => painter(brush, spec.state), { x: 0, y: 0 }, 1, false);
  } else throw new Error('Unknown case type: ' + spec.type);
}
function serialTrace(trace) {
  return trace.map(({ canvas, ...rest }) => ({ ...rest, width: canvas.width,
    height: canvas.height, contextAttributes: canvas.getContext('2d').getContextAttributes?.() ?? null }));
}
function inspectTrace(trace) {
  const unique = new Map();
  for (const event of trace) if (!unique.has(event.canvasId)) unique.set(event.canvasId, event);
  return [...unique.values()].map(event => ({ canvasId: event.canvasId, key: event.key,
    ...capture(event.canvas, { x: event.x, y: event.y, density: event.density }) }));
}

window.__rasterProof = {
  ready: true,
  runtime: {
    userAgent: navigator.userAgent, platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio,
    screen: { width: innerWidth, height: innerHeight },
    contextReset: typeof CanvasRenderingContext2D.prototype.reset,
    noGameLoop: true, canvasFactory: 'document.createElement(canvas), native browser factory'
  },
  runCase(spec) {
    clearCanvasArtCache();
    const trace = [], outputs = [];
    activeTrace = trace;
    try {
      // No crop readback between cold and warm draws: instrumentation must not
      // migrate a baseline crop to a CPU store before its warm draw.
      for (const temperature of ['cold', 'warm']) {
        const { canvas, ctx } = outerCanvas(spec);
        paintCase(spec, ctx); ctx.restore();
        outputs.push({ temperature, ...capture(canvas) });
      }
    } finally { activeTrace = null; }
    const stats = canvasArtCacheStats();
    const metadata = serialTrace(trace), crops = inspectTrace(trace);
    if (metadata.length !== 2 || metadata[0].hit || !metadata[1].hit)
      throw new Error('Expected one actual cold miss then warm hit: ' + spec.id);
    if (!metadata.every(event => event.canvasId === metadata[0].canvasId))
      throw new Error('Warm draw did not use the same cached crop: ' + spec.id);
    if (!outputs.every(output => output.alpha.opaque + output.alpha.translucent > 0))
      throw new Error('Painter produced an empty output: ' + spec.id);
    return { spec, outputs, crops, trace: metadata, stats };
  },
  runPoolCase(spec) {
    // Real RasterCache eviction/recycle path, not a replacement cache or painter.
    // Unique keys share identical actual crate art, making the recycled crop
    // dimensions exactly equal and allowing the spare canvas to be selected.
    const cache = new RasterCache(12 * 1024 * 1024, 1);
    const trace = [], outputs = [], records = [];
    activeTrace = trace;
    try {
      for (const step of ['A', 'B', 'C', 'D']) {
        const raster = cache.get('proof:pool:' + step, spec.density,
          brush => CORE_SCENERY.crate(brush, undefined), spec.tileSize);
        records.push({ step, canvasId: idOf(raster.canvas), x: raster.x,
          y: raster.y, density: raster.density,
          width: raster.canvas.width, height: raster.canvas.height });
        const { canvas, ctx } = outerCanvas(spec);
        ctx.drawImage(raster.canvas, raster.x, raster.y,
          raster.canvas.width / raster.density, raster.canvas.height / raster.density);
        ctx.restore(); outputs.push({ temperature: step, ...capture(canvas) });
      }
    } finally { activeTrace = null; }
    if (records[0].canvasId !== records[2].canvasId || records[1].canvasId !== records[3].canvasId)
      throw new Error('Actual crop pool reuse did not occur: ' + spec.id);
    const result = { spec, outputs, crops: inspectTrace(trace), trace: serialTrace(trace),
      records, stats: cache.stats() };
    cache.clear();
    return result;
  }
};
