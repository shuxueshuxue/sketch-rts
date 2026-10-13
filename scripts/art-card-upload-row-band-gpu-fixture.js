import * as THREE from 'three';
// Balanced full-module setup; no uploader/texture factory is invoked here.
const originalProvider=await import(/* @vite-ignore */ '/@fs'+__CARD_UPLOAD_ORIGINAL_SOURCE__);
const candidateProvider=await import(/* @vite-ignore */ '/@fs'+__CARD_UPLOAD_CANDIDATE_SOURCE__);
for(const module of [originalProvider,candidateProvider])for(const name of ['CardMipUploader','createCardArray','cardTextureBytes'])if(typeof module[name]!=='function')throw new Error('Provider export missing '+name);
const policy=__CARD_UPLOAD_POLICY__,selectedProvider=policy==='original'?originalProvider:candidateProvider;
const {CardMipUploader,createCardArray}=selectedProvider;
window.cardUploadGPUSetup={policy,balancedProvidersLoaded:true,factoriesCalledBySetup:false};

// Test-side WebGL instrumentation reads actual encoded sRGB RGBA storage. It
// never accesses renderer.properties or changes the production transfer path.
const DEPTH=4,params=new URLSearchParams(location.search);
const sizes=(params.get('sizes')??'256,320,512,640,704').split(',').map(Number);
const requireTail=params.get('requireTail')==='1';
const canvas=document.createElement('canvas');document.body.append(canvas);
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false});renderer.setSize(16,16);renderer.setPixelRatio(1);
const gl=renderer.getContext(),anisotropy=renderer.capabilities.getMaxAnisotropy();
if(!(gl instanceof WebGL2RenderingContext))throw new Error('WebGL2 required');
const allocations=[],disposalErrors=[],calls=[];
const cpuViewCalls=[],cpuViews=new WeakSet(),initialized=new WeakSet();
const originalInit=renderer.initTexture,originalCopy=renderer.copyTextureToTexture;
renderer.initTexture=function(texture){
 if(cpuViews.has(texture))throw new Error('CPU row view must never be initialized');
 initialized.add(texture);return originalInit.apply(this,arguments);
};
renderer.copyTextureToTexture=function(source,destination,region,position,...levels){
 if(source?.isDataTexture&&source.version===0&&(levels[0]??0)===0){
  const image=source.image,full=destination.image,h=region.max.y-region.min.y,rowBytes=full.width*4;
  if(initialized.has(source)||source.source.version!==0||source.generateMipmaps!==false||source.source===destination.source||source.image===destination.image)throw new Error('CPU view initialization/Source contract');
  if(image.width!==full.width||image.data.buffer!==full.data.buffer||image.data.byteLength!==image.width*image.height*4)throw new Error('CPU view width/alias/byte range contract');
  if(policy==='candidate'&&(region.min.y!==0||image.height!==h||image.data.byteOffset!==full.data.byteOffset+position.y*rowBytes))throw new Error('CPU row-band source rebasing contract');
  if(policy==='original'&&(region.min.y!==position.y||image.height!==full.height||image.data.byteOffset!==full.data.byteOffset))throw new Error('Original full-domain CPU view contract');
  if(region.min.x!==position.x||full.data.byteLength!==full.width*full.height*4)throw new Error('Full scratch/destination contract');
  cpuViews.add(source);cpuViewCalls.push({sourceWidth:image.width,sourceHeight:image.height,viewBytes:image.data.byteLength,
   viewOffset:image.data.byteOffset-full.data.byteOffset,sourceX:region.min.x,sourceY:region.min.y,destinationX:position.x,destinationY:position.y,
   width:region.max.x-region.min.x,height:h,physicalBytes:(region.max.x-region.min.x)*h*4,sourceVersion:source.version,
   sourceNeverInitialized:true,sharedFullBuffer:true,fullScratchWidth:full.width,fullScratchHeight:full.height});
 }
 return originalCopy.apply(this,arguments);
};
let captureLabel=null,instrument=true;
function instrumentCall(name,describe){
 const original=gl[name].bind(gl);
 gl[name]=function(...args){
  if(instrument){const detail=describe?.(args);if(detail)calls.push({name,...detail});}
  return original(...args);
 };
 return original;
}
instrumentCall('texStorage3D',a=>{
 if(a[0]===gl.TEXTURE_2D_ARRAY)allocations.push({label:captureLabel,handle:gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY),levels:a[1],format:a[2],width:a[3],height:a[4],depth:a[5]});
 return{target:a[0],width:a[3],height:a[4],depth:a[5]};
});
instrumentCall('texSubImage2D',a=>({target:a[0],level:a[1],x:a[2],y:a[3],width:a.length>=9?a[4]:a[6]?.width??0,height:a.length>=9?a[5]:a[6]?.height??0}));
instrumentCall('texSubImage3D',a=>({target:a[0],level:a[1],x:a[2],y:a[3],z:a[4],width:a[5],height:a[6],depth:a[7]}));
instrumentCall('generateMipmap',a=>({target:a[0]}));
const mipSizes=n=>Array.from({length:Math.floor(Math.log2(n))+1},(_,level)=>({level,size:Math.max(1,Math.floor(n/2**level))}));
function configure(texture){
 texture.colorSpace=THREE.SRGBColorSpace;texture.format=THREE.RGBAFormat;texture.type=THREE.UnsignedByteType;
 texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.anisotropy=anisotropy;
 texture.flipY=false;texture.premultiplyAlpha=false;texture.unpackAlignment=1;return texture;
}
function withLabel(label,fn){captureLabel=label;try{return fn();}finally{captureLabel=null;}}
function assertGL(where){const error=gl.getError();if(error)throw new Error(`GL error ${error} at ${where}`);}
function pattern(n,phase,{transparent=false,shift=0}={}){
 const bytes=new Uint8Array(n*n*4);
 const left=Math.floor(n*.21)+shift,top=Math.floor(n*.29)+shift,right=Math.floor(n*.69)+shift,bottom=Math.floor(n*.71)+shift;
 for(let y=Math.max(0,top);y<Math.min(n,bottom);y++)for(let x=Math.max(0,left);x<Math.min(n,right);x++){
  const i=(y*n+x)*4;bytes[i]=(x*3+phase*17)%256;bytes[i+1]=(y*7+phase*31)%256;bytes[i+2]=((x+y)%11===0?255:23);
  bytes[i+3]=transparent?0:(x%19===0?255:((x+y+phase)%256));
 }
 // Colored, fully transparent corner pixels must survive uploads and influence
 // native sRGB mip generation. Alpha-only dirty bounds would lose them.
 for(const [x,y] of [[1+phase%5,2],[n-3,n-7]]){const i=(y*n+x)*4;bytes[i]=251;bytes[i+1]=19+phase;bytes[i+2]=113;bytes[i+3]=0;}
 return bytes;
}
async function fence(){
 const at=performance.now(),sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync)throw new Error('fenceSync failed');gl.flush();
 try{for(;;){const state=gl.clientWaitSync(sync,0,0);if(state===gl.WAIT_FAILED)throw new Error('clientWaitSync failed');
  if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)return;
  if(performance.now()-at>120000)throw new Error('GPU fence timeout');await new Promise(resolve=>setTimeout(resolve,0));
 }}finally{gl.deleteSync(sync);}
}
function allocation(label){const found=allocations.filter(a=>a.label===label).at(-1);if(!found)throw new Error(`Missing GPU allocation ${label}`);return found;}
function readLayer(handle,n,level,layer){
 const size=Math.max(1,Math.floor(n/2**level)),bytes=new Uint8Array(size*size*4);
 const framebuffer=gl.createFramebuffer(),oldRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack=gl.getParameter(gl.PACK_ALIGNMENT);
 const oldPackRow=gl.getParameter(gl.PACK_ROW_LENGTH),oldPackRows=gl.getParameter(gl.PACK_SKIP_ROWS),oldPackPixels=gl.getParameter(gl.PACK_SKIP_PIXELS);
 if(!framebuffer)throw new Error('Framebuffer allocation failed');
 try{
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);
  gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,handle,level,layer);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  const status=gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);if(status!==gl.FRAMEBUFFER_COMPLETE)throw new Error(`Incomplete mip read framebuffer ${status}, level=${level}, layer=${layer}`);
  gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);
  gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
 }finally{
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,oldRead);gl.pixelStorei(gl.PACK_ALIGNMENT,pack);gl.pixelStorei(gl.PACK_ROW_LENGTH,oldPackRow);
  gl.pixelStorei(gl.PACK_SKIP_ROWS,oldPackRows);gl.pixelStorei(gl.PACK_SKIP_PIXELS,oldPackPixels);gl.deleteFramebuffer(framebuffer);
 }
 return bytes;
}
async function sha(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function parity(pair,label){
 await fence();const result=[];
 for(const {level,size} of mipSizes(pair.residentSize)){
  let maximum=0,changedChannels=0,changedPixels=0,transparentRGBChannels=0;const reference=[],candidate=[];
  for(let layer=0;layer<DEPTH;layer++){
   const a=readLayer(pair.referenceHandle,pair.n,level+pair.baseMip,layer),b=readLayer(pair.candidateHandle,pair.residentSize,level,layer);
   for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){
    const delta=Math.abs(a[i+c]-b[i+c]);maximum=Math.max(maximum,delta);if(delta){changedChannels++;changed=true;}
    if(c<3&&a[i+3]===0&&a[i+c]!==0)transparentRGBChannels++;
   }if(changed)changedPixels++;}
   reference.push(await sha(a));candidate.push(await sha(b));
  }
  result.push({label,level,sourceLevel:level+pair.baseMip,size,maximum,changedChannels,changedPixels,transparentRGBChannels,referenceSha256:reference,candidateSha256:candidate});
 }
 assertGL(`parity ${label}`);return result;
}
function allocate(n,label,baseMip=0){
 const data=new Uint8Array(n*n*4*DEPTH),bytes=n*n*4;
 data.set(pattern(n,1),bytes);data.set(pattern(n,2,{transparent:true}),bytes*2);data.set(pattern(n,3),bytes*3);
 const reference=configure(new THREE.DataArrayTexture(data,n,n,DEPTH));reference.generateMipmaps=true;reference.needsUpdate=true;
 const residentSize=n/2**baseMip,options=baseMip?{sourceWidth:n,sourceHeight:n,baseMip}:undefined;
 const candidate=createCardArray(residentSize,residentSize,DEPTH,anisotropy),page={texture:candidate,uploaded:false},uploader=new CardMipUploader(anisotropy);
 if(!(candidate instanceof THREE.DataArrayTexture))throw new Error('Provider and fixture Three constructor identity mismatch');
 withLabel(`${label}:reference`,()=>renderer.initTexture(reference));
 withLabel(`${label}:candidate`,()=>{for(let layer=0;layer<DEPTH;layer++)uploader.uploadLayer(page,layer,data.subarray(layer*bytes,(layer+1)*bytes),renderer,options);});
 return{n,label,baseMip,residentSize,options,data,reference,candidate,page,uploader,referenceHandle:allocation(`${label}:reference`).handle,candidateHandle:allocation(`${label}:candidate`).handle,
  dispose(){uploader.dispose();reference.dispose();candidate.dispose();const error=gl.isContextLost()?0:gl.getError();if(error)disposalErrors.push({label,error});}};
}
function callSummary(start){const slice=calls.slice(start),uploads=slice.filter(c=>c.name==='texSubImage2D');return{
 subImage2DCalls:uploads.length,subImage2DBytes:uploads.reduce((sum,c)=>sum+c.width*c.height*4,0),
 generatedMipmaps:slice.filter(c=>c.name==='generateMipmap').length,
 uploads:uploads.map(({level,x,y,width,height})=>({level,x,y,width,height}))};}
function update(pair,layer,next){
 const bytes=pair.n*pair.n*4,inputBefore=next.slice();pair.data.set(next,layer*bytes);
 pair.reference.addLayerUpdate(layer);pair.reference.needsUpdate=true;renderer.initTexture(pair.reference);
 // Only production candidate uploads are counted. Reference uploads are an
 // independent full-domain oracle and never charged to the candidate.
 const start=calls.length,statsBefore=pair.uploader.stats();
 const target=new THREE.WebGLRenderTarget(8,8,{depthBuffer:false,stencilBuffer:false});renderer.setRenderTarget(target);
 try{pair.uploader.uploadLayer(pair.page,layer,next,renderer,pair.options);
  if(renderer.getRenderTarget()!==target)throw new Error('Transfer did not restore caller render target');
 }finally{renderer.setRenderTarget(null);target.dispose();}
 if(next.some((byte,i)=>byte!==inputBefore[i]))throw new Error('Upload modified caller input');
 return{inputReadonly:true,...callSummary(start),statsBefore,statsAfter:pair.uploader.stats(),targetRestored:true};
}
async function recover(pair,phase,afterCalls){
 const next=pattern(pair.n,phase,{shift:5}),before=pair.uploader.stats(),copy=renderer.copyTextureToTexture;
 const target=new THREE.WebGLRenderTarget(8,8,{depthBuffer:false,stencilBuffer:false});renderer.setRenderTarget(target);
 let actualCopies=0,injected=false,targetRestored=false;
 renderer.copyTextureToTexture=function(...args){
  const result=copy.apply(renderer,args);actualCopies++;
  if(actualCopies===afterCalls)throw new Error('Injected test transfer interruption after real GPU copy');
  return result;
 };
 try{pair.uploader.uploadLayer(pair.page,2,next,renderer,pair.options);}
 catch(error){if(error.message!=='Injected test transfer interruption after real GPU copy')throw error;injected=true;targetRestored=renderer.getRenderTarget()===target;}
 finally{renderer.copyTextureToTexture=copy;renderer.setRenderTarget(null);target.dispose();}
 if(!injected||!targetRestored)throw new Error('Recovery interruption did not preserve caller target');
 const transfer=update(pair,2,next),pixels=await parity(pair,`recovered-after-${afterCalls}-real-copies`);
 const fullUpload=transfer.subImage2DCalls===1&&transfer.subImage2DBytes===pair.n*pair.n*4&&transfer.generatedMipmaps===1;
 const fallbackCounted=transfer.statsAfter.scratchFullUploadFallbacks===before.scratchFullUploadFallbacks+1;
 return{afterCalls,actualCopies,injected,targetRestored,fullUpload,fallbackCounted,transfer,parity:pixels,passed:fullUpload&&fallbackCounted&&pixels.every(p=>p.maximum===0&&p.changedChannels===0)};
}
async function proofCase(n,label,baseMip=0){
 const pair=allocate(n,label,baseMip),report={size:n,residentSize:pair.residentSize,baseMip,depth:DEPTH,steps:[],initial:null,compaction:null,recovery:[],disposed:null};
 try{
  report.initial=await parity(pair,'initial-including-zero-first-source');
  const a=pattern(n,6),b=pattern(n,7,{shift:13}),transparent=b.slice();
  transparent[((n-7)*n+n-3)*4+1]=253;
  const one=new Uint8Array(n*n*4),band=new Uint8Array(n*n*4),column=new Uint8Array(n*n*4);
  const last=(n*n-1)*4;one[last]=239;one[last+1]=71;one[last+2]=103;one[last+3]=0;
  const bandTop=Math.floor(n*.58),bandBottom=Math.min(n,bandTop+7),bandLeft=Math.floor(n*.17),bandRight=Math.floor(n*.31);
  for(let y=bandTop;y<bandBottom;y++)for(let x=bandLeft;x<bandRight;x++){const i=(y*n+x)*4;band[i]=137;band[i+1]=79;band[i+2]=213;band[i+3]=(x+y)%9?181:0;}
  for(let y=0;y<n;y++){const i=(y*n+13)*4;column[i]=71;column[i+1]=137;column[i+2]=213;column[i+3]=181;}
  const mutations=[['paint-center',0,a],['move-and-clear-old-mark',0,b],['change-transparent-rgb',0,transparent],
   ['identical-rgba',1,transparent.slice()],['clear-all-old-pixels',0,new Uint8Array(n*n*4)],['identical-empty-rgba',3,new Uint8Array(n*n*4)],
   ['opposite-corners-dirty',2,pattern(n,19,{shift:-17})],
   ['row-band-reset',2,new Uint8Array(n*n*4)],['row-band-bottom-right-transparent-rgb',2,one],
   ['row-band-reset-again',2,new Uint8Array(n*n*4)],['row-band-seven-narrow-rows',2,band],
   ['row-band-reset-before-column',2,new Uint8Array(n*n*4)],['row-band-full-height-column',2,column]];
  for(const [step,layer,next] of mutations){
   const transfer=update(pair,layer,next),pixels=await parity(pair,step);
   report.steps.push({step,layer,transfer,parity:pixels});
  }
  if(baseMip){report.recovery.push(await recover(pair,29,1),await recover(pair,31,2));}
  // Full-chain GPU relocation must preserve all bytes, including untouched
  // layers and the 640 -> ... -> 5 -> 2 -> 1 NPOT tail.
  const compactDepth=n===512?3:n===640?7:n===704?14:4;
  const compact=createCardArray(pair.residentSize,pair.residentSize,compactDepth,anisotropy),destination={texture:compact,uploaded:false};
  const permutation=[2,0,3,1],oldHandle=pair.candidateHandle;
  try{
   withLabel(`${label}:compact`,()=>pair.uploader.copyLayers(Array.from({length:compactDepth},(_,destinationLayer)=>({source:pair.page,sourceLayer:permutation[destinationLayer%DEPTH],destination,destinationLayer})),renderer));
   const handle=allocation(`${label}:compact`).handle,levels=[];await fence();
   for(const {level,size} of mipSizes(pair.residentSize)){let maximum=0,changedChannels=0;
    for(let layer=0;layer<compactDepth;layer++){
     const a=readLayer(oldHandle,pair.residentSize,level,permutation[layer%DEPTH]),b=readLayer(handle,pair.residentSize,level,layer);
     for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);maximum=Math.max(maximum,delta);if(delta)changedChannels++;}
    }levels.push({level,size,maximum,changedChannels});
   }
   report.compaction={depth:compactDepth,permutation,levels,arrayCpuBaseNull:compact.image.data===null};
  }finally{compact.dispose();}
  const identical=report.steps.filter(s=>s.step.startsWith('identical'));
  report.identicalScratchUploadSkipped=identical.every(s=>s.transfer.subImage2DCalls===0&&s.transfer.generatedMipmaps===0);
  report.arrayCpuBaseNull=pair.candidate.image.data===null;
  report.productionStats=pair.uploader.stats();
  report.passed=report.arrayCpuBaseNull&&report.recovery.every(r=>r.passed)&&[...report.initial,...report.steps.flatMap(s=>s.parity),...report.compaction.levels].every(p=>p.maximum===0&&p.changedChannels===0);
 }finally{pair.dispose();report.disposed=pair.uploader.stats().scratchTextures===0;}
 return report;
}
window.cardStreamingProof=async()=>{
 const ext=gl.getExtension('WEBGL_debug_renderer_info');
 const report={policy,providerSetup:window.cardUploadGPUSetup,three:THREE.REVISION,settings:{sizes,depth:DEPTH,anisotropy,colorSpace:'SRGB',minFilter:'LinearMipmapLinearFilter',
  readback:'Raw encoded RGBA8 GPU storage, each array layer and every native mip, via test-only framebufferTextureLayer/readPixels. No shader color decode/re-encode or alpha masking. Full-domain DataArrayTexture generateMipmap is the independent oracle.',
  fixture:'Zero first input; gradients, thin lines, nonzero RGB at alpha 0; shifted marks, transparent RGB mutation, exact repeated input, full zero clearing, full dirty union, all mip compaction; bottom-right transparent RGB, seven-row band and full-height column.',
  timing:'Correctness only; instrumentation and synchronous GPU readback deliberately exclude this script from performance comparisons.'},
  device:{vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null},cases:[],tailCases:[],context:null};
 for(const n of sizes)report.cases.push(await proofCase(n,`case-${n}`));
 if(requireTail)for(const n of [256,640,704])for(const baseMip of [1,2])report.tailCases.push(await proofCase(n,`tail-${n}-${baseMip}`,baseMip));
 // Dispose/recreate without context loss catches stale scratch knowledge.
 report.recreate=await proofCase(320,'recreate-320');
 let lost=false,restored=false;
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Context restore timeout')),30000);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;setTimeout(()=>renderer.forceContextRestore(),100);},{once:true});
  canvas.addEventListener('webglcontextrestored',()=>{restored=true;clearTimeout(timeout);resolve();},{once:true});
  renderer.forceContextLoss();
 });
 const rebuilt=await proofCase(704,'context-restored-704');
 const tailRebuilt=requireTail?await proofCase(704,'context-restored-tail-704-2',2):null;
 report.context={lost,restored,rebuilt,tailRebuilt,passed:lost&&restored&&rebuilt.passed&&rebuilt.disposed&&(!tailRebuilt||tailRebuilt.passed&&tailRebuilt.disposed)};
 report.glError=gl.getError();report.disposalErrors=disposalErrors;report.cpuViewCalls=cpuViewCalls;
 report.cpuViewsNeverInitialized=cpuViewCalls.every(c=>c.sourceNeverInitialized&&c.sharedFullBuffer);
 report.tailPassed=!requireTail||report.tailCases.length===6&&report.tailCases.every(c=>c.passed&&c.disposed)&&tailRebuilt.passed;
 report.identicalScratchUploadSkipped=[...report.cases,...report.tailCases,report.recreate,rebuilt,...(tailRebuilt?[tailRebuilt]:[])].every(c=>c.identicalScratchUploadSkipped);
 report.passed=[...report.cases,report.recreate].every(c=>c.passed&&c.disposed)&&report.tailPassed&&report.context.passed&&report.cpuViewsNeverInitialized&&report.glError===0&&disposalErrors.length===0;
 instrument=false;renderer.dispose();return report;
};
