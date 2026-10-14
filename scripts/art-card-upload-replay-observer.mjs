/** Exclusive diagnostic only. Production upload methods remain synchronous.
 * No renderer private properties are read. Raw GL here is readback/query proof,
 * never a replacement implementation of production texture transfers. */
import {waitForArtGpuCompletion} from './art-gpu-completion.mjs';
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const encode=bytes=>{let text='';for(let at=0;at<bytes.length;at+=32768)text+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(text);};
const decode=text=>{const s=atob(text),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;};
const config=t=>({width:t.image.width,height:t.image.height,depth:t.image.depth??1,colorSpace:t.colorSpace,type:t.type,format:t.format,internalFormat:t.internalFormat,magFilter:t.magFilter,minFilter:t.minFilter,anisotropy:t.anisotropy,flipY:t.flipY,premultiplyAlpha:t.premultiplyAlpha,unpackAlignment:t.unpackAlignment,generateMipmaps:t.generateMipmaps,dataReady:t.source.dataReady,mips:t.mipmaps.map(m=>({width:m.width,height:m.height,bytes:m.data?.byteLength??null}))});
const comparable=state=>({uploaders:state.uploaders,pages:state.pages});
const same=(a,b,what)=>{if(JSON.stringify(a)!==JSON.stringify(b)){window.__exactReplayFailure={label:what,actual:a,expected:b};throw new Error('Exact state differs: '+what);}};
export async function createExactUploadObserver({sourceRoot}){
 const module=await import(/* @vite-ignore */ '/@fs'+sourceRoot+'/src/client/world3d/card-mip-uploader.ts');
 const {CardMipUploader,createCardArray}=module;
 const contexts=new WeakMap(),owners=new WeakMap(),oracleSets=new WeakMap();let active=null;
 const originals=Object.fromEntries(['uploadLayer','copyLayers','releaseSize','dispose'].map(k=>[k,CardMipUploader.prototype[k]]));
 function registerPage(ctx,page){
  let record=ctx.pageByObject.get(page);if(record)return record;
  record={id:'p'+ctx.nextPage++,page,live:true,configuration:config(page.texture)};
  ctx.pageByObject.set(page,record);ctx.pages.set(record.id,record);ctx.textureNames.set(page.texture,'page:'+record.id);
  page.texture.addEventListener('dispose',()=>{record.live=false;if(active===ctx)ctx.events.push({kind:'page-dispose',page:record.id});});
  if(active===ctx)ctx.events.push({kind:'page-create',page:record.id,configuration:record.configuration});return record;
 }
 CardMipUploader.prototype.uploadLayer=function(page,layer,rgba,renderer,options){
  const owner=owners.get(this);if(!owner)return originals.uploadLayer.apply(this,arguments);
  const {ctx,name}=owner,record=registerPage(ctx,page);let event;
  if(active===ctx){const image=page.texture.image;event={kind:'upload',uploader:name,page:record.id,layer,options:options?{...options}:{sourceWidth:image.width,sourceHeight:image.height,baseMip:0},uploadedBefore:page.uploaded,configuration:config(page.texture),rgba:rgba.slice()};ctx.events.push(event);}
  try{const result=originals.uploadLayer.apply(this,arguments);if(event)event.uploadedAfter=page.uploaded;return result;}
  catch(error){if(event)event.error=String(error);throw error;}
 };
 CardMipUploader.prototype.copyLayers=function(moves,renderer){
  const owner=owners.get(this);if(!owner)return originals.copyLayers.apply(this,arguments);
  const {ctx,name}=owner;const copied=moves.map(move=>({source:registerPage(ctx,move.source).id,sourceLayer:move.sourceLayer,destination:registerPage(ctx,move.destination).id,destinationLayer:move.destinationLayer}));
  if(active===ctx)ctx.events.push({kind:'copyLayers',uploader:name,moves:copied});return originals.copyLayers.apply(this,arguments);
 };
 CardMipUploader.prototype.releaseSize=function(width,height){const owner=owners.get(this);if(owner&&active===owner.ctx)owner.ctx.events.push({kind:'releaseSize',uploader:owner.name,width,height});return originals.releaseSize.apply(this,arguments);};
 CardMipUploader.prototype.dispose=function(){const owner=owners.get(this);if(owner&&active===owner.ctx)owner.ctx.events.push({kind:'uploader-dispose',uploader:owner.name});return originals.dispose.apply(this,arguments);};
 function registerLayer(layer){
  if(contexts.has(layer))return contexts.get(layer);
  const renderer=layer.renderer,gl=renderer.getContext();
  const ctx={layer,renderer,gl,pages:new Map(),pageByObject:new WeakMap(),nextPage:0,handles:new WeakMap(),bound:new Map(),initializing:null,events:[],uploaders:{cards:layer.cards.mipUploader,remains:layer.remainsCards.mipUploader},cpuInitViolations:[],unownedAllocations:[],ownedPages:new Set(),pendingQueries:new Set(),replaying:false,recording:false,contentSequence:[],textureNames:new WeakMap(),texturesByHandle:new WeakMap()};
  contexts.set(layer,ctx);for(const [name,uploader]of Object.entries(ctx.uploaders))owners.set(uploader,{ctx,name});
  const bind=gl.bindTexture;gl.bindTexture=function(target,handle){ctx.bound.set(target,handle);return bind.apply(this,arguments);};
  for(const method of ['texStorage2D','texStorage3D','texImage2D','texImage3D']){const original=gl[method];gl[method]=function(target){if(!ctx.initializing&&(active===ctx||ctx.replaying))ctx.unownedAllocations.push({method,target});if(ctx.initializing){const handle=ctx.bound.get(target);if(!handle)throw new Error('Texture allocation without observed binding');ctx.handles.set(ctx.initializing,{handle,target});ctx.texturesByHandle.set(handle,ctx.initializing);}return original.apply(this,arguments);};}
  function textureName(texture){if(!texture)return null;if(ctx.textureNames.has(texture))return ctx.textureNames.get(texture);for(const [name,uploader]of Object.entries(ctx.uploaders))for(const [key,scratch]of uploader.scratches){if(texture===scratch.texture)return name+':scratch:'+key;if(texture===scratch.cpuSource)return name+':cpu-source:'+key;}return 'unclassified-texture';}
  for(const method of ['texSubImage2D','texSubImage3D','generateMipmap','copyTexSubImage3D','blitFramebuffer','texStorage2D','texStorage3D','texImage2D','texImage3D']){
   const original=gl[method];gl[method]=function(...args){if(ctx.recording){const target=method==='blitFramebuffer'?null:args[0],texture=ctx.initializing??ctx.texturesByHandle.get(ctx.bound.get(target));ctx.contentSequence.push({method,targetTexture:textureName(texture),args:args.map(value=>ArrayBuffer.isView(value)?{typedArray:value.constructor.name,bytes:value.byteLength}:value instanceof ArrayBuffer?{bufferBytes:value.byteLength}:value)});}return original.apply(this,args);};
  }
  const init=renderer.initTexture;renderer.initTexture=function(texture){
   for(const uploader of Object.values(ctx.uploaders))for(const scratch of uploader.scratches.values())if(texture===scratch.cpuSource){ctx.cpuInitViolations.push('CPU-only source initialized');throw new Error('Diagnostic rejects initializing CPU-only upload view');}
   const previous=ctx.initializing;ctx.initializing=texture;try{return init.apply(this,arguments);}finally{ctx.initializing=previous;}
  };
  return ctx;
 }
 async function rawMip(ctx,texture,level,layer,retain=false){
  const {gl,renderer}=ctx,mapped=ctx.handles.get(texture);if(!mapped)throw new Error('Native handle was not observed through public initTexture allocation');
  const width=Math.max(1,Math.floor(texture.image.width/2**level)),height=Math.max(1,Math.floor(texture.image.height/2**level)),bytes=new Uint8Array(width*height*4);
  const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),previousRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),previousBuffer=gl.getParameter(gl.READ_BUFFER);
  if(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)!==null)throw new Error('Native readback rejects a bound PIXEL_PACK_BUFFER');
  const precedingError=gl.getError();if(precedingError!==gl.NO_ERROR)throw new Error('GL error preceding native mip readback: '+precedingError);
  const pack=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS].map(parameter=>[parameter,gl.getParameter(parameter)]),fb=gl.createFramebuffer();
  try{
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);
   if(mapped.target===gl.TEXTURE_2D_ARRAY)gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,mapped.handle,level,layer);
   else if(mapped.target===gl.TEXTURE_2D)gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,mapped.handle,level);
   else throw new Error('Unsupported native readback target');
   if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Native mip framebuffer incomplete');
   gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);
   gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('Native readPixels error: '+error);
  }finally{
   renderer.setRenderTarget(target,face,mip);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previousRead);gl.readBuffer(previousBuffer);for(const [parameter,value]of pack)gl.pixelStorei(parameter,value);gl.deleteFramebuffer(fb);
  }
  const record={width,height,bytes:bytes.length,sha256:await sha(bytes)};if(retain)ctx.latestNativeReadbacks.push({level,layer,...record,base64:encode(bytes)});return record;
 }
 async function pageMips(ctx,page){
  if(!page.uploaded)return null;
  const result=[];for(let layer=0;layer<page.texture.image.depth;layer++){const levels=[];for(let level=0;level<page.texture.mipmaps.length;level++)levels.push(await rawMip(ctx,page.texture,level,layer));result.push(levels);}return result;
 }
 async function state(ctx){
  const uploaders={};for(const [name,uploader]of Object.entries(ctx.uploaders)){
   const scratches=[];for(const [key,scratch]of uploader.scratches){const bytes=scratch.data.slice();scratches.push({key,uploaded:scratch.uploaded,retryFull:scratch.retryFull,gpuBytes:scratch.gpuBytes,configuration:config(scratch.texture),cpuSourceConfiguration:config(scratch.cpuSource),cpuSourceInitialized:ctx.handles.has(scratch.cpuSource),cpuSourceVersion:scratch.cpuSource.version,cpuSourceSourceVersion:scratch.cpuSource.source.version,cpuSourceSharesRaster:scratch.cpuSource.image.data===scratch.data,cpuSourceDistinctTexture:scratch.cpuSource!==scratch.texture,cpuSourceDistinctSource:scratch.cpuSource.source!==scratch.texture.source,regions:scratch.regions.map(region=>({min:region.min.toArray(),max:region.max.toArray()})),rgba:{bytes:bytes.length,sha256:await sha(bytes),base64:encode(bytes)},gpu:scratch.uploaded?await Promise.all(scratch.regions.map((_,level)=>rawMip(ctx,scratch.texture,level,0))):null});}
   if(scratches.some(s=>s.cpuSourceInitialized||s.cpuSourceVersion!==0||s.cpuSourceSourceVersion!==0||!s.cpuSourceSharesRaster||!s.cpuSourceDistinctTexture||!s.cpuSourceDistinctSource))throw new Error('CPU source initialization/sharing contract differs');
   const stats={...uploader.stats()};delete stats.gpuTransferSubmissionWallMs;uploaders[name]={anisotropy:uploader.anisotropy,scratches,stats};
  }
  const pages=[];for(const record of ctx.pages.values())if(record.live)pages.push({id:record.id,configuration:config(record.page.texture),uploaded:record.page.uploaded,mips:await pageMips(ctx,record.page)});
  if(ctx.unownedAllocations.length)throw new Error('Ungoverned transfer texture allocation: '+JSON.stringify(ctx.unownedAllocations));
  if(ctx.cpuInitViolations.length)throw new Error(ctx.cpuInitViolations.join(';'));
  const batchMaps={};for(const [name,batches]of [['cards',ctx.layer.cards],['remains',ctx.layer.remainsCards]])batchMaps[name]={pages:batches.pages.map(page=>({page:ctx.pageByObject.get(page)?.id??null,used:page.used,cards:page.cards.map(card=>card?{key:card.key,layer:card.layer,used:card.used,tileSize:card.tileSize,sourceSize:card.sourceSize,baseMip:card.baseMip}:null)})),cards:[...batches.cards].map(([key,card])=>({key,page:ctx.pageByObject.get(card.page)?.id??null,layer:card.layer}))};
  if(Object.values(batchMaps).some(batch=>batch.pages.some(page=>page.page===null)))throw new Error('Unobserved page in actual batch ownership');
  return{uploaders,pages,batchMaps};
 }
 const delta=(a,b)=>Object.fromEntries(Object.keys(b).filter(k=>k!=='gpuTransferSubmissionWallMs').map(k=>[k,b[k]-a[k]]));
 const counters=ctx=>Object.fromEntries(Object.entries(ctx.uploaders).map(([name,uploader])=>[name,uploader.stats()]));
 async function beginCapture(layer,frame){
  const ctx=registerLayer(layer);for(const batches of [layer.cards,layer.remainsCards])for(const page of batches.pages)registerPage(ctx,page);
  const prefixDrain=await waitForArtGpuCompletion(ctx.gl),before=await state(ctx);ctx.events=[];ctx.contentSequence=[];ctx.recording=true;ctx.startCounters=counters(ctx);active=ctx;
  return{before,prefixDrain,n:135,tick:frame.snapshot.tick,prefix:{realFrames:Array.from({length:18},(_,i)=>i*3),noDrawFrames:{first:54,last:134,count:81}},scope:'Actual original prefix; native readback and history drain are untimed and perturb historical GPU queue. Capturing RGBA copies changes target CPU cost; no timing-performance claim.'};
 }
 async function endCapture(layer,before){
  const ctx=contexts.get(layer);active=null;ctx.recording=false;const targetDrain=await waitForArtGpuCompletion(ctx.gl),events=ctx.events;
  const observedUploads=events.filter(e=>e.kind==='upload').length;
  for(const event of events)if(event.kind==='upload'){event.rgba={bytes:event.rgba.length,sha256:await sha(event.rgba),base64:encode(event.rgba)};if(event.error)throw new Error('Actual upload failed: '+event.error);}
  const after=await state(ctx),endCounters=counters(ctx);
  return{version:1,...before,events,after,targetDrain,observedUploads,countGuard:observedUploads===53,glContentSequence:ctx.contentSequence,transferDeltas:Object.fromEntries(Object.keys(endCounters).map(name=>[name,delta(ctx.startCounters[name],endCounters[name])])),cpuSourceNeverInitialized:true};
 }
 async function sourceOracle(ctx,event){
  const {sourceWidth,sourceHeight,baseMip}=event.options,data=decode(event.rgba.base64);if(data.length!==event.rgba.bytes||await sha(data)!==event.rgba.sha256)throw new Error('RGBA corpus payload changed');
  // Independent one-layer full-domain array uses the native sRGB GPU chain.
  const texture=createCardArray(sourceWidth,sourceHeight,1,event.configuration.anisotropy);texture.image.data=data;texture.source.dataReady=true;texture.generateMipmaps=true;texture.mipmaps=[];texture.needsUpdate=true;
  try{ctx.renderer.initTexture(texture);await waitForArtGpuCompletion(ctx.gl);const result=[];for(let level=baseMip;level<=Math.floor(Math.log2(Math.max(sourceWidth,sourceHeight)));level++)result.push(await rawMip(ctx,texture,level,0));return result;}finally{texture.dispose();}
 }
 function initializeExpectedPage(event){
  const {depth,mips}=event.configuration;return Array.from({length:depth},()=>mips.map(mip=>({width:mip.width,height:mip.height,bytes:mip.width*mip.height*4,sha256:null})));
 }
 async function replay(layer,corpus,policy){
  if(!['frame-end','each-layer','validate'].includes(policy))throw new Error('Unknown upload replay policy');
  const ctx=contexts.get(layer),prefixDrain=await waitForArtGpuCompletion(ctx.gl),before=await state(ctx);same(comparable(before),comparable(corpus.before),'complete prefix CPU/GPU state');same(before.batchMaps,corpus.before.batchMaps,'complete actual prefix batch allocation/card map');
  const expected=new Map(before.pages.map(p=>[p.id,p.uploaded?structuredClone(p.mips):initializeExpectedPage(p)]));
  let oracles=oracleSets.get(corpus);
  // Only the independent validation pass allocates oracle textures. Timed
  // arms consume immutable native hashes and never initialize an oracle GPU.
  if(policy==='validate'){oracles=new Map();for(const [index,event]of corpus.events.entries())if(event.kind==='upload')oracles.set(index,await sourceOracle(ctx,event));oracleSets.set(corpus,oracles);}
  else if(!oracles)throw new Error('Timed replay requires completed independent oracle validation');
  for(const event of corpus.events)if(event.kind==='page-create'){
   const levels=initializeExpectedPage(event);for(const layer of levels)for(const mip of layer)mip.sha256=await sha(new Uint8Array(mip.bytes));expected.set(event.page,levels);
  }
  const payloads=new Map();for(const [index,event]of corpus.events.entries())if(event.kind==='upload')payloads.set(index,decode(event.rgba.base64));
  for(const layers of expected.values())for(const levels of layers)for(const mip of levels)if(mip.sha256===null)mip.sha256=await sha(new Uint8Array(mip.bytes));
  const oraclePreparationDrain=await waitForArtGpuCompletion(ctx.gl),startCounters=counters(ctx),intervals=[],validatedWrites=[];
  const gl=ctx.gl,extension=gl.getExtension('EXT_disjoint_timer_query_webgl2'),queries=[];
  ctx.replaying=true;ctx.contentSequence=[];ctx.recording=true;const start=performance.now();let submissionMs=0,waitMs=0;
  for(const [index,event]of corpus.events.entries()){
   let query;if(extension&&event.kind==='upload'&&policy!=='validate'){query=gl.createQuery();ctx.pendingQueries.add(query);gl.beginQuery(extension.TIME_ELAPSED_EXT,query);}
   const at=performance.now();
   try{
    if(event.kind==='page-create'){
     if(ctx.pages.has(event.page))throw new Error('Replay new-page ID already exists');
     const c=event.configuration,texture=createCardArray(c.width,c.height,c.depth,c.anisotropy),page={texture,uploaded:false};
     ctx.ownedPages.add(page);const record=registerPage(ctx,page);same(record.id,event.page,'new page creation order');same(config(texture),c,'new page configuration');
    }else if(event.kind==='upload'){
     const record=ctx.pages.get(event.page);if(!record?.live)throw new Error('Replay upload missing page');same(record.page.uploaded,event.uploadedBefore,'uploaded before');
     const rgba=payloads.get(index);ctx.uploaders[event.uploader].uploadLayer(record.page,event.layer,rgba,ctx.renderer,event.options);same(record.page.uploaded,event.uploadedAfter,'uploaded after');
     if(!expected.has(event.page))throw new Error('Expected destination page missing');expected.get(event.page)[event.layer]=structuredClone(oracles.get(index));
    }else if(event.kind==='copyLayers'){
     const moves=event.moves.map(m=>({source:ctx.pages.get(m.source)?.page,sourceLayer:m.sourceLayer,destination:ctx.pages.get(m.destination)?.page,destinationLayer:m.destinationLayer}));
     if(moves.some(m=>!m.source||!m.destination))throw new Error('Replay compaction missing page');
     ctx.uploaders[event.uploader].copyLayers(moves,ctx.renderer);for(const m of event.moves)expected.get(m.destination)[m.destinationLayer]=structuredClone(expected.get(m.source)[m.sourceLayer]);
    }else if(event.kind==='releaseSize')ctx.uploaders[event.uploader].releaseSize(event.width,event.height);
    else if(event.kind==='page-dispose'){ctx.pages.get(event.page).page.texture.dispose();expected.delete(event.page);}
    else if(event.kind==='uploader-dispose')ctx.uploaders[event.uploader].dispose();
    else throw new Error('Unsupported event: '+event.kind);
   }finally{if(query)gl.endQuery(extension.TIME_ELAPSED_EXT);}
   const submit=performance.now()-at;submissionMs+=submit;const interval={index,kind:event.kind,submissionMs:submit};
   if(query)queries.push({index,query});
   if((policy==='each-layer'||policy==='validate')&&(event.kind==='upload'||event.kind==='copyLayers')){interval.completion=await waitForArtGpuCompletion(gl);waitMs+=interval.completion.waitMs;}
   if(policy==='validate'){
    ctx.recording=false;const writes=event.kind==='upload'?[{page:event.page,layer:event.layer}]:event.kind==='copyLayers'?event.moves.map(m=>({page:m.destination,layer:m.destinationLayer})):[];
    for(const write of writes){const p=ctx.pages.get(write.page).page,actual=[];ctx.latestNativeReadbacks=[];for(let level=0;level<p.texture.mipmaps.length;level++)actual.push(await rawMip(ctx,p.texture,level,write.layer,true));if(JSON.stringify(actual)!==JSON.stringify(expected.get(write.page)[write.layer]))window.__exactNativeFailure={event:index,...write,readbacks:ctx.latestNativeReadbacks};same(actual,expected.get(write.page)[write.layer],'event '+index+' native written tail');ctx.latestNativeReadbacks=[];validatedWrites.push({event:index,...write,levels:actual.length,allRGBAExact:true});}ctx.recording=true;
   }
   intervals.push(interval);
  }
  ctx.recording=false;const terminalCompletion=await waitForArtGpuCompletion(gl),envelopeMs=performance.now()-start;waitMs+=terminalCompletion.waitMs;
  const endCounters=counters(ctx),transferDeltas=Object.fromEntries(Object.keys(endCounters).map(name=>[name,delta(startCounters[name],endCounters[name])]));same(transferDeltas,corpus.transferDeltas,'identical transfer counts/bytes');same(ctx.contentSequence,corpus.glContentSequence,'native GL target content sequence');
  const queryResults=[];for(const {index,query}of queries){
   const deadline=performance.now()+120000;while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){if(performance.now()>deadline)throw new Error('Timer query collection timed out');await new Promise(r=>setTimeout(r,0));}
   const disjoint=gl.getParameter(extension.GPU_DISJOINT_EXT),nanoseconds=gl.getQueryParameter(query,gl.QUERY_RESULT);queryResults.push({index,disjoint,nanoseconds,elapsedMs:disjoint?null:nanoseconds/1e6,scope:'Whole synchronous upload command bracket; includes command arrival/idle. Not pure algorithm or hardware generalized.'});gl.deleteQuery(query);ctx.pendingQueries.delete(query);
  }
  ctx.replaying=false;const after=await state(ctx);same(comparable(after),comparable(corpus.after),'complete final CPU/GPU state');
  let levels=0;for(const page of after.pages)if(page.uploaded){same(page.mips,expected.get(page.id),'independent native oracle and untouched layers '+page.id);levels+=page.mips.reduce((sum,layer)=>sum+layer.length,0);}
  if(gl.getError()!==gl.NO_ERROR)throw new Error('Native replay GL error');
  return{policy,prefixDrain,oraclePreparationDrain,glContentSequence:ctx.contentSequence,oracleGpuAllocationThisArm:policy==='validate',submissionMs,waitMs,envelopeMs,terminalCompletion,intervals,queryResults,timerQueryAvailable:!!extension,transferDeltas,validation:{passed:true,actualUploads:corpus.events.filter(e=>e.kind==='upload').length,validatedWrites,finalNativeLevels:levels,completePriorStateExact:true,completeFinalStateExact:true,originalNativeContentSequenceExact:true,independentFullDomainOracleExact:true,cpuSourceNeverInitialized:true},method:'Isolated uploader replay after exact actual prefix and untimed full native readback/history drain; only validation allocates independent oracle textures; timed arms reuse hashes; asynchronous fences/query markers perturb submission. Envelope includes polling/event-loop scheduling. This is a diagnostic, not a game frame benchmark.'};
 }
 function cleanupLayer(layer){const ctx=contexts.get(layer);if(!ctx)return;active=null;ctx.replaying=false;ctx.recording=false;for(const query of ctx.pendingQueries)ctx.gl.deleteQuery(query);ctx.pendingQueries.clear();for(const page of ctx.ownedPages)page.texture.dispose();ctx.ownedPages.clear();}
 return{registerLayer,beginCapture,endCapture,replay,cleanupLayer};
}
