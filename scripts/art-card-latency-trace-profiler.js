/** Diagnostic wrappers only. Import after the bank entry fixture/overrides have
 * loaded, before creating any layers. No extra stats() calls or card scans.
 * Inclusive timers overlap and cannot be added to estimate a frame cost.
 */
const sourceRoot = __BENCHMARK_SOURCE_ROOT__;
const { World3DLayer } = await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/world-layer.ts`);
const { PaintedCardBatches } = await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/painted-card-batches.ts`);
const { CardMipUploader } = await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/card-mip-uploader.ts`);
if (window.cardLatencyProfiler) throw new Error('Latency profiler already installed');
const traceObserverErrors=[];
function traceMeasure(name,started,ended){
  try{performance.measure(name,{start:started,end:ended});performance.clearMeasures(name);}
  catch(error){traceObserverErrors.push(String(error));}
}
const traceRowName=row=>`cycle=${run?.options.cycle}/hidden=${run?.options.hiddenCount}/row=${row.index}/n=${row.expectedN??(row.now*60/1000)}/tick=${row.tick}`;

const batchMethods = ['finish','raster','slot','compact','draw','recordPeaks','createPage','createChunk','resizeChunk','remove'];
const uploadMethods = ['uploadLayer','copyLayers'];
const rendererMethods = ['initTexture','copyTextureToTexture','render'];
const stages = ['paintMs','readbackMs','cacheMs','pickMaskMs','rowFlipMs','slotMs'];
const batchLabels = new WeakMap(), uploadLabels = new WeakMap(), layerIds = new WeakMap();
const renderWrappers = new WeakMap();
let nextLayerId = 0, active = null, run = null;
const metric = () => ({ calls:0, inclusiveMs:0, maxInclusiveMs:0, errors:0 });
const numeric = value => typeof value === 'number' ? value : null;
function cheapBatch(cards) {
  const cache=cards.rasterCache, upload=cards.mipUploader;
  return {
    cards:cards.cards.size,pages:cards.pages.length,chunks:cards.chunks.length,frame:cards.frame,
    allocatedPixels:cards.allocatedPixels,pending:cards.pending.length,instances:cards.instances.length,
    rasterizations:cards.rasterizations,copiedLayers:cards.copiedLayers,
    maskBytes:cards.maskBytes,pendingMaskBytes:cards.pendingMaskBytes,pendingRgbaBytes:cards.pendingRgbaBytes,
    rasterCacheEntries:cache.entries.size,rasterCacheBytes:cache.bytes,rasterCacheHits:cache.hits,
    rasterCacheMisses:cache.misses,rasterCacheEvictions:cache.evictions,
    rasterCacheWorkMs:cache.workMs,rasterCacheSavedMs:cache.savedMs,
    rasterCacheBackoffs:cache.backoffs,rasterCacheBypass:cache.bypass,
    scratchTextures:upload.scratches.size,mipInitializedPages:upload.initializedPages,
    mipLayerUpdates:upload.layerUpdates,mipCopyCalls:upload.copyCalls,mipCopyBytes:upload.mipCopyBytes,
    compactionLayers:upload.compactionLayers,compactionCopyCalls:upload.compactionCopyCalls,
    scratchUploadBytes:upload.scratchUploadBytes,transferWallMs:upload.transferWallMs,
    rasterStages:Object.fromEntries(stages.map(key=>[key,numeric(cards.rasterStages[key])])),
  };
}
function cheapLayer(layer) {
  return { cards:cheapBatch(layer.cards),remains:cheapBatch(layer.remainsCards),positions:layer.positions.size,
    rendererRenderHookActive:layer.renderer.render===renderWrappers.get(layer.renderer),
    layerFrame:layer.frame,posed:layer.posed,directionVisits:layer.directionVisits };
}
function wrap(object, name, keyFor, observe) {
  const original=object[name];
  if(typeof original!=='function')throw new Error(`Missing profiling method ${name}`);
  function profiled(...args) {
    const row=active;
    if(!row)return original.apply(this,args);
    const key=keyFor(this), bucket=row.calls[key]??(row.calls[key]=metric());
    const started=performance.now();
    let result,failedCall=false;
    try { result=original.apply(this,args); return result; }
    catch(error){failedCall=true;throw error;}
    finally {
      const ended=performance.now(),elapsed=ended-started;
      bucket.calls++;bucket.inclusiveMs+=elapsed;bucket.maxInclusiveMs=Math.max(bucket.maxInclusiveMs,elapsed);if(failedCall)bucket.errors++;
      if(observe)observe(row,result,{started,ended,elapsed,args,receiver:this,failedCall});
    }
  }
  object[name]=profiled;
  return profiled;
}
for(const name of batchMethods)wrap(PaintedCardBatches.prototype,name,object=>`PaintedCardBatches.${batchLabels.get(object)??'unregistered'}.${name}`);
for(const name of uploadMethods)wrap(CardMipUploader.prototype,name,object=>`CardMipUploader.${uploadLabels.get(object)??'unregistered'}.${name}`);


function textureDescription(texture,level){
  const image=texture?.image;
  return {kind:texture?.isDataArrayTexture?'DataArrayTexture':texture?.isData3DTexture?'Data3DTexture':texture?.isDataTexture?'DataTexture':texture?.isRenderTargetTexture?'RenderTargetTexture':texture?.isTexture?'Texture':'unknown',
    width:image?.width??null,height:image?.height??null,depth:image?.depth??1,
    level,levelWidth:typeof image?.width==='number'?Math.max(1,Math.floor(image.width/2**level)):null,
    levelHeight:typeof image?.height==='number'?Math.max(1,Math.floor(image.height/2**level)):null};
}
function observeCopy(row,_result,{started,ended,elapsed,args,failedCall}){
  // Observe only supplied public arguments; never query bindings or submit work.
  const sourceLevel=args[4]??0,destinationLevel=args[5]??0;
  const source=textureDescription(args[0],sourceLevel),destination=textureDescription(args[1],destinationLevel);
  const box=args[2],region=box?{width:box.max.x-box.min.x,height:box.max.y-box.min.y,depth:box.max.z===undefined?1:box.max.z-box.min.z}:null;
  const key=`${source.kind}:${source.width}x${source.height}x${source.depth}@${sourceLevel}->${destination.kind}:${destination.width}x${destination.height}x${destination.depth}@${destinationLevel}/region=${region?`${region.width}x${region.height}x${region.depth}`:"full"}`;
  const bucket=row.textureCopyBuckets[key]??(row.textureCopyBuckets[key]={source,destination,region,...metric(),longCalls:0});
  bucket.calls++;bucket.inclusiveMs+=elapsed;bucket.maxInclusiveMs=Math.max(bucket.maxInclusiveMs,elapsed);if(failedCall)bucket.errors++;
  if(elapsed>1){bucket.longCalls++;traceMeasure(`CardLatency.copyTextureToTexture/${traceRowName(row)}/${key}`,started,ended);}
}
const originalGetImageData=CanvasRenderingContext2D.prototype.getImageData;
CanvasRenderingContext2D.prototype.getImageData=function(...args){
  const row=active;
  if(!row)return originalGetImageData.apply(this,args);
  const canvas={width:this.canvas.width,height:this.canvas.height};
  const requestRect={x:args[0],y:args[1],width:args[2],height:args[3]};
  const key=`${canvas.width}x${canvas.height}/rect=${args.slice(0,4).join(',')}`;
  const bucket=row.getImageDataBuckets[key]??(row.getImageDataBuckets[key]={canvas,requestRect,...metric(),longCalls:0});
  const aggregate=row.calls['CanvasRenderingContext2D.getImageData']??(row.calls['CanvasRenderingContext2D.getImageData']=metric());
  const started=performance.now();
  try{return originalGetImageData.apply(this,args);}
  catch(error){bucket.errors++;aggregate.errors++;throw error;}
  finally{
    const ended=performance.now(),elapsed=ended-started;
    for(const entry of [bucket,aggregate]){entry.calls++;entry.inclusiveMs+=elapsed;entry.maxInclusiveMs=Math.max(entry.maxInclusiveMs,elapsed);}
    if(elapsed>1){bucket.longCalls++;traceMeasure(`CardLatency.getImageData/${traceRowName(row)}/${key}`,started,ended);}
  }
};

// The original create already applies the current bank/full-mip override.
// Wrapping the resulting instance preserves that exact override instead of
// mistakenly timing only a bypassed prototype residentMip implementation.
const originalCreate=World3DLayer.create;
World3DLayer.create=function(...args){
  const layer=originalCreate.apply(this,args);
  layerIds.set(layer,++nextLayerId);
  for(const [label,batch] of [['cards',layer.cards],['remains',layer.remainsCards]]){
    batchLabels.set(batch,label);uploadLabels.set(batch.mipUploader,label);
  }
  wrap(layer,'residentMip',()=> 'World3DLayer.residentMip',(row,value)=>{
    const key=typeof value==='number'?String(value):'threw-or-undefined';
    row.residentMipReturned[key]=(row.residentMipReturned[key]??0)+1;
  });
  for(const name of rendererMethods){
    const wrapped=wrap(layer.renderer,name,()=>`renderer.${name}`,name==='copyTextureToTexture'?observeCopy:undefined);
    if(name==='render')renderWrappers.set(layer.renderer,wrapped);
  }
  return layer;
};
function schedule(index, options){
  if(index<18)return{phase:'preparation',sample:index,expectedN:index*3};
  index-=18;
  if(index<60)return{phase:'cpu-warmup',sample:index,expectedN:index+54};
  index-=60;
  if(index<options.cpuFrames)return{phase:'cpu-sample',sample:index,expectedN:index+114};
  index-=options.cpuFrames;
  if(index<options.realFrames)return{phase:'real-frame',sample:index,expectedN:index+480};
  index-=options.realFrames;
  return{phase:index===0?'camera-empty':index===1?'camera-returned':'unexpected-extra-draw',sample:index,expectedN:null};
}
const originalDraw=World3DLayer.prototype.draw;
World3DLayer.prototype.draw=function(frame){
  if(!run)return originalDraw.call(this,frame);
  const observationStarted=performance.now(), previous=active;
  let snapshotIndex=run.snapshotIds.get(frame.snapshot);
  if(snapshotIndex===undefined){snapshotIndex=run.snapshots.length;run.snapshotIds.set(frame.snapshot,snapshotIndex);run.snapshots.push(frame.snapshot);}
  const row={index:run.rows.length,layerId:layerIds.get(this),...schedule(run.rows.length,run.options),
    tick:frame.snapshot.tick,now:frame.now,snapshotIndex,
    view:{x:frame.view.x,y:frame.view.y,width:frame.view.width,height:frame.view.height,zoom:frame.view.zoom??1},
    calls:{},residentMipReturned:{},getImageDataBuckets:{},textureCopyBuckets:{},before:cheapLayer(this)};
  row.scheduleMatches=row.expectedN===null?null:Math.abs(frame.now-row.expectedN*1000/60)<0.00001;
  active=row;
  const drawStarted=performance.now();
  try{return originalDraw.call(this,frame);}
  catch(error){row.error=String(error);throw error;}
  finally{
    const drawEnded=performance.now(),elapsed=drawEnded-drawStarted;
    row.traceTiming={startTime:drawStarted,endTime:drawEnded,timeOrigin:performance.timeOrigin};
    traceMeasure(`CardLatency.World3DLayer.draw/${traceRowName(row)}`,drawStarted,drawEnded);
    active=previous;
    row.calls['World3DLayer.draw']={calls:1,inclusiveMs:elapsed,maxInclusiveMs:elapsed,errors:row.error?1:0};
    row.after=cheapLayer(this);
    row.rasterStagesDelta={};
    for(const label of ['cards','remains'])row.rasterStagesDelta[label]=Object.fromEntries(stages.map(key=>[key,
      row.before[label].rasterStages[key]===null||row.after[label].rasterStages[key]===null?null:row.after[label].rasterStages[key]-row.before[label].rasterStages[key]]));
    row.observationBookkeepingMs=(drawStarted-observationStarted)+(performance.now()-drawStarted-elapsed);
    run.rows.push(row);
  }
};
const scope='Browser tracing and User Timing are active. World draw measures retain exact performance timestamps; only getImageData/copy calls over 1ms emit individual User Timing spans. Canvas/copy synchronous wall can include deferred execution, GC or channel waiting; trace evidence is required for attribution. All trace hooks add observer overhead. Diagnostic inclusive synchronous wrappers, not formal timing. Nested timings overlap; do not sum them. performance.now/aggregation/row bookkeeping add observation overhead. World layer excludes Canvas passes and true GPU completion; renderer calls include submission/backpressure, not pure GPU duration. The frozen fixture deliberately replaces renderer.render with a no-op during CPU warmup/samples; these rows report rendererRenderHookActive=false. No extra stats() calls, card traversal, GL calls, paints, uploads or rendering are introduced. Snapshot serialization/SHA happens only after each cycle, outside timed draws.';
window.cardLatencyProfiler={
  installed:true,scope,
  begin(options){
    if(run||active)throw new Error('Previous latency cycle was not drained');
    if(!Number.isInteger(options.cpuFrames)||options.cpuFrames<0||!Number.isInteger(options.realFrames)||options.realFrames<0)throw new Error('Invalid cycle sample counts');
    run={options,rows:[],snapshots:[],snapshotIds:new WeakMap()};
  },
  async drain(){
    if(!run||active)throw new Error('No finished latency cycle to drain');
    const finished=run;run=null;
    const snapshots=[];
    for(const [index,snapshot] of finished.snapshots.entries()){
      const bytes=new TextEncoder().encode(JSON.stringify(snapshot));
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
      snapshots.push({index,tick:snapshot.tick,sha256,jsonBytes:bytes.byteLength,units:snapshot.units.length,effects:snapshot.effects.length});
    }
    const expectedRows=18+60+finished.options.cpuFrames+finished.options.realFrames+2;
    return{scope,traceObserverErrors:traceObserverErrors.splice(0),options:finished.options,rows:finished.rows,snapshots,
      scheduleValidation:{expectedRows,actualRows:finished.rows.length,allExpectedRows:finished.rows.length===expectedRows,
        mismatches:finished.rows.filter(row=>row.scheduleMatches===false||row.phase==='unexpected-extra-draw').map(row=>row.index)},
      snapshotHashDefinition:'SHA256 of UTF-8 JSON.stringify(original snapshot), calculated after cycle; rows reference snapshot index, not a rewritten/render-mutated fixture. Raw final visible facts remain in harness pixelProof.'};
  },
};
