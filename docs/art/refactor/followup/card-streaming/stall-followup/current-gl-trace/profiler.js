/** Diagnostic wrappers only. Import after the bank entry fixture/overrides have
 * loaded, before creating any layers. No extra stats() calls or card scans.
 * Adds synchronous public GL API boundaries without extra GL work or queries.
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
const glMethods = ['texSubImage2D','texSubImage3D','generateMipmap','copyTexSubImage2D','copyTexSubImage3D',
  'blitFramebuffer','texStorage2D','texStorage3D','texImage2D','texImage3D',
  'framebufferTexture2D','framebufferTextureLayer','bindFramebuffer'];
const stages = ['paintMs','readbackMs','cacheMs','pickMaskMs','rowFlipMs','slotMs'];
const batchLabels = new WeakMap(), uploadLabels = new WeakMap(), layerIds = new WeakMap();
const renderWrappers = new WeakMap();
const glLayerIds = new WeakMap();
let nextLayerId = 0, active = null, run = null, rendererScope = null;
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
function wrap(object, name, keyFor, observe, scopeFor) {
  const original=object[name];
  if(typeof original!=='function')throw new Error(`Missing profiling method ${name}`);
  function profiled(...args) {
    const row=active;
    if(!row)return original.apply(this,args);
    const key=keyFor(this), bucket=row.calls[key]??(row.calls[key]=metric());
    const previousScope=rendererScope;
    if(scopeFor)rendererScope=scopeFor(args);
    const started=performance.now();
    let result,failedCall=false;
    try { result=original.apply(this,args); return result; }
    catch(error){failedCall=true;throw error;}
    finally {
      const ended=performance.now(),elapsed=ended-started;
      if(scopeFor)rendererScope=previousScope;
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
function describeRendererScope(name,args){
  if(name==='copyTextureToTexture'){
    const sourceLevel=args[4]??0,destinationLevel=args[5]??0,box=args[2];
    return{method:name,source:textureDescription(args[0],sourceLevel),destination:textureDescription(args[1],destinationLevel),
      sourceVersion:args[0]?.version??null,destinationGeneratesMipmaps:args[1]?.generateMipmaps??null,
      region:box?{width:box.max.x-box.min.x,height:box.max.y-box.min.y,depth:box.max.z===undefined?1:box.max.z-box.min.z}:null};
  }
  return name==='initTexture'?{method:name,texture:textureDescription(args[0],0),generateMipmaps:args[0]?.generateMipmaps??null}:{method:name};
}
function glArguments(name,args){
  // Scalars supplied to the actual call only. No bindings, pixels, handles,
  // getParameter, framebuffer checks, readback or other GL calls are requested.
  if(name==='texSubImage2D')return{target:args[0],level:args[1],x:args[2],y:args[3],
    width:args.length>=9?args[4]:null,height:args.length>=9?args[5]:null,overloadArguments:args.length};
  if(name==='texSubImage3D')return{target:args[0],level:args[1],x:args[2],y:args[3],z:args[4],width:args[5],height:args[6],depth:args[7],overloadArguments:args.length};
  if(name==='generateMipmap')return{target:args[0]};
  if(name==='copyTexSubImage2D')return{target:args[0],level:args[1],x:args[2],y:args[3],sourceX:args[4],sourceY:args[5],width:args[6],height:args[7]};
  if(name==='copyTexSubImage3D')return{target:args[0],level:args[1],x:args[2],y:args[3],z:args[4],sourceX:args[5],sourceY:args[6],width:args[7],height:args[8]};
  if(name==='blitFramebuffer')return{source:args.slice(0,4),destination:args.slice(4,8),mask:args[8],filter:args[9]};
  if(name==='texStorage2D'||name==='texStorage3D')return{target:args[0],levels:args[1],internalFormat:args[2],width:args[3],height:args[4],depth:name==='texStorage3D'?args[5]:1};
  if(name==='texImage2D')return{target:args[0],level:args[1],width:args.length>=9?args[3]:null,height:args.length>=9?args[4]:null,overloadArguments:args.length};
  if(name==='texImage3D')return{target:args[0],level:args[1],width:args[3],height:args[4],depth:args[5],overloadArguments:args.length};
  if(name==='framebufferTexture2D')return{target:args[0],attachment:args[1],textureTarget:args[2],level:args[4]};
  if(name==='framebufferTextureLayer')return{target:args[0],attachment:args[1],level:args[3],layer:args[4]};
  return{target:args[0]};
}
function installGL(context,layerId){
  if(!(context instanceof WebGL2RenderingContext))throw new Error('GL boundary observer requires the existing WebGL2 context');
  if(glLayerIds.has(context))throw new Error('GL boundary observer already installed on this context');
  glLayerIds.set(context,layerId);
  for(const name of glMethods){
    const original=context[name];
    if(typeof original!=='function')throw new Error(`Missing WebGL2 profiling method ${name}`);
    context[name]=function(...args){
      const row=active;
      if(!row||row.layerId!==glLayerIds.get(this))return original.apply(this,args);
      const bucket=row.glApiCalls[name],parent=rendererScope;
      const started=performance.now();let failedCall=false;
      try{return original.apply(this,args);}
      catch(error){failedCall=true;throw error;}
      finally{
        const ended=performance.now(),elapsed=ended-started;
        bucket.calls++;bucket.inclusiveMs+=elapsed;bucket.maxInclusiveMs=Math.max(bucket.maxInclusiveMs,elapsed);if(failedCall)bucket.errors++;
        if(elapsed>1){
          bucket.longCalls++;
          const label=`CardLatency.GL.${name}/${traceRowName(row)}/call=${bucket.calls}/parent=${parent?.method??'none'}`;
          traceMeasure(label,started,ended);
          row.glLongCalls.push({api:name,call:bucket.calls,started,ended,elapsedMs:elapsed,failedCall,
            arguments:glArguments(name,args),rendererScope:parent,traceLabel:label});
        }
      }
    };
  }
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
  // Public getter returns the existing context; it submits no GL operation.
  installGL(layer.renderer.getContext(),layerIds.get(layer));
  for(const [label,batch] of [['cards',layer.cards],['remains',layer.remainsCards]]){
    batchLabels.set(batch,label);uploadLabels.set(batch.mipUploader,label);
  }
  wrap(layer,'residentMip',()=> 'World3DLayer.residentMip',(row,value)=>{
    const key=typeof value==='number'?String(value):'threw-or-undefined';
    row.residentMipReturned[key]=(row.residentMipReturned[key]??0)+1;
  });
  for(const name of rendererMethods){
    const wrapped=wrap(layer.renderer,name,()=>`renderer.${name}`,name==='copyTextureToTexture'?observeCopy:undefined,args=>describeRendererScope(name,args));
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
    calls:{},glApiCalls:Object.fromEntries(glMethods.map(name=>[name,{...metric(),longCalls:0}])),glLongCalls:[],
    residentMipReturned:{},getImageDataBuckets:{},textureCopyBuckets:{},before:cheapLayer(this)};
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
const scope='Browser tracing and User Timing are active. World draw measures retain exact performance timestamps; getImageData/copy and selected actual WebGL2 API calls over 1ms emit individual User Timing spans. GL wrappers run only within an active diagnostic WorldLayer row on its own existing context, preserve the original arguments/receiver/return/error and add no GL query, framebuffer check, readback, fence, flush, upload or rendering. Each row retains every selected API call count/inclusive wall/max/error count; glLongCalls retains scalar arguments and enclosing public renderer operation for calls over 1ms. API boundary synchronous wall may include driver validation, queued work, command-channel waits, GC or scheduling: it is not exclusive execution time of the named GPU algorithm. Native GL API timers are nested inside the retained public copy/init/render and world/batch timers; do not add them. The public copy sourceVersion is a supplied texture property, not queried GPU initialization state. All trace hooks add observer overhead. Diagnostic inclusive synchronous wrappers, not formal timing. performance.now/aggregation/scope metadata/row bookkeeping add observation overhead. World layer excludes Canvas passes and true GPU completion; renderer calls include submission/backpressure, not pure GPU duration. The unchanged fixture requests renderer.render no-op during CPU warmup/samples; per-row rendererRenderHookActive records actual wrapper equality. No extra stats() calls, card traversal, GL calls, paints, uploads or rendering are introduced. Snapshot serialization/SHA happens only after each cycle, outside timed draws.';
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
    return{scope,glObservation:{methods:glMethods,onlyActiveWorldLayerContext:true,longCallThresholdMs:1,
        synchronousApiBoundaryOnly:true,extraGLCalls:false,extraGLQueries:false},
      traceObserverErrors:traceObserverErrors.splice(0),options:finished.options,rows:finished.rows,snapshots,
      scheduleValidation:{expectedRows,actualRows:finished.rows.length,allExpectedRows:finished.rows.length===expectedRows,
        mismatches:finished.rows.filter(row=>row.scheduleMatches===false||row.phase==='unexpected-extra-draw').map(row=>row.index)},
      snapshotHashDefinition:'SHA256 of UTF-8 JSON.stringify(original snapshot), calculated after cycle; rows reference snapshot index, not a rewritten/render-mutated fixture. Raw final visible facts remain in harness pixelProof.'};
  },
};
