// External observation module. Imports and executes the actual source painters.
import * as THREE from 'three';
import { PaintedCardBatches } from '/src/client/world3d/painted-card-batches.ts';
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

function rawCapture(rgba,width,height,contextAttributes) {
  return {width,height,anchor:null,contextAttributes,
    alpha:alphaSummary(rgba,width,height),rgbaBase64:encode(rgba)};
}
function flippedCopy(rgba,width,height) {
  const top=new Uint8ClampedArray(rgba.length),row=width*4;
  for(let y=0;y<height;y++)top.set(rgba.subarray(y*row,(y+1)*row),(height-1-y)*row);
  return top;
}
window.__rasterProof = {
  ready:true,
  runtime:{userAgent:navigator.userAgent,platform:navigator.platform,
    hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio,
    screen:{width:innerWidth,height:innerHeight},contextReset:typeof CanvasRenderingContext2D.prototype.reset,
    noGameLoop:true,noGpuRenderer:true,
    prepareRasterAvailable:typeof PaintedCardBatches.prototype.prepareRaster==='function'},
  runCase(spec) {
    clearCanvasArtCache();
    const trace=[],outputs=[],gpuBottom=[];
    const warm=typeof PaintedCardBatches.prototype.prepareRaster==='function';
    const batch=warm?new PaintedCardBatches(new THREE.Scene(),1,{pickable:false,transparent:true}):null;
    let preparedStats=null;
    activeTrace=trace;
    try {
      for(const temperature of ['cold','warm']) {
        if(warm) {
          const key='corpse:recipe:'+spec.id;
          batch.prepareRaster(key,spec.density,ctx=>paintCase(spec,ctx),spec.tileSize);
          const bottom=batch.rasterCache.get(key+':'+spec.density+':'+spec.tileSize);
          if(!bottom)throw new Error('Actual prepared raster cache missing: '+spec.id);
          const size=spec.tileSize*spec.density;
          if(bottom.length!==size*size*4)throw new Error('Prepared raster size differs');
          const attributes=batch.canvases.get(size).getContext('2d').getContextAttributes();
          gpuBottom.push({temperature,...rawCapture(bottom,size,size,attributes)});
          const top=flippedCopy(bottom,size,size);
          outputs.push({temperature,...rawCapture(top,size,size,attributes)});
        } else {
          const {canvas,ctx}=outerCanvas(spec);
          paintCase(spec,ctx);ctx.restore();
          outputs.push({temperature,...capture(canvas)});
        }
      }
      if(warm) {
        preparedStats=batch.stats();
        if(preparedStats.preparedRasters!==1)throw new Error('Expected one actual prepared raster then recovery hit');
        if(preparedStats.pages!==0||preparedStats.cards!==0||preparedStats.drawChunks!==0||preparedStats.ownedGpuBytes!==0)
          throw new Error('CPU preparation allocated visible GPU content');
      }
    } finally {activeTrace=null;}
    const stats=canvasArtCacheStats(),metadata=serialTrace(trace),crops=inspectTrace(trace);
    if(warm) {
      if(metadata.length!==1||metadata[0].hit)throw new Error('Actual prepared raster must paint once through a cold Atlas miss');
    } else if(metadata.length!==2||metadata[0].hit||!metadata[1].hit)
      throw new Error('Reference must use original cold miss then warm hit');
    if(crops.length!==1)throw new Error('Expected exactly one actual corpse crop');
    if(!outputs.every(output=>output.alpha.opaque+output.alpha.translucent>0))throw new Error('Empty raster');
    batch?.dispose();
    return {spec,mode:warm?'actual-prepareRaster-cache-recovery':'original-atlas-outer-reference',
      outputs,gpuBottom,crops,trace:metadata,stats,preparedStats};
  }
};
