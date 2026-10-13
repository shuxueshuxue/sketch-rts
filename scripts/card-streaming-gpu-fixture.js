import * as THREE from 'three';
const {CardMipUploader,createCardArray}=await import(/* @vite-ignore */ `/@fs${__CARD_STREAMING_SOURCE_ROOT__}/src/client/world3d/card-mip-uploader.ts`);

// Test-side WebGL instrumentation reads actual encoded sRGB RGBA storage. It
// never accesses renderer.properties or changes the production transfer path.
const DEPTH=4,params=new URLSearchParams(location.search);
const sizes=(params.get('sizes')??'256,320,512,640,704').split(',').map(Number);
const canvas=document.createElement('canvas');document.body.append(canvas);
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false});renderer.setSize(16,16);renderer.setPixelRatio(1);
const gl=renderer.getContext(),anisotropy=renderer.capabilities.getMaxAnisotropy();
if(!(gl instanceof WebGL2RenderingContext))throw new Error('WebGL2 required');
const allocations=[],disposalErrors=[],calls=[];
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
 for(const {level,size} of mipSizes(pair.n)){
  let maximum=0,changedChannels=0,changedPixels=0,transparentRGBChannels=0;const reference=[],candidate=[];
  for(let layer=0;layer<DEPTH;layer++){
   const a=readLayer(pair.referenceHandle,pair.n,level,layer),b=readLayer(pair.candidateHandle,pair.n,level,layer);
   for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){
    const delta=Math.abs(a[i+c]-b[i+c]);maximum=Math.max(maximum,delta);if(delta){changedChannels++;changed=true;}
    if(c<3&&a[i+3]===0&&a[i+c]!==0)transparentRGBChannels++;
   }if(changed)changedPixels++;}
   reference.push(await sha(a));candidate.push(await sha(b));
  }
  result.push({label,level,size,maximum,changedChannels,changedPixels,transparentRGBChannels,referenceSha256:reference,candidateSha256:candidate});
 }
 assertGL(`parity ${label}`);return result;
}
function allocate(n,label){
 const data=new Uint8Array(n*n*4*DEPTH),bytes=n*n*4;
 data.set(pattern(n,1),bytes);data.set(pattern(n,2,{transparent:true}),bytes*2);data.set(pattern(n,3),bytes*3);
 const reference=configure(new THREE.DataArrayTexture(data,n,n,DEPTH));reference.generateMipmaps=true;reference.needsUpdate=true;
 const candidate=createCardArray(n,n,DEPTH,anisotropy),page={texture:candidate,uploaded:false},uploader=new CardMipUploader(anisotropy);
 withLabel(`${label}:reference`,()=>renderer.initTexture(reference));
 withLabel(`${label}:candidate`,()=>{for(let layer=0;layer<DEPTH;layer++)uploader.uploadLayer(page,layer,data.subarray(layer*bytes,(layer+1)*bytes),renderer);});
 return{n,label,data,reference,candidate,page,uploader,referenceHandle:allocation(`${label}:reference`).handle,candidateHandle:allocation(`${label}:candidate`).handle,
  dispose(){uploader.dispose();reference.dispose();candidate.dispose();const error=gl.isContextLost()?0:gl.getError();if(error)disposalErrors.push({label,error});}};
}
function callSummary(start){const slice=calls.slice(start),uploads=slice.filter(c=>c.name==='texSubImage2D');return{
 subImage2DCalls:uploads.length,subImage2DBytes:uploads.reduce((sum,c)=>sum+c.width*c.height*4,0),
 generatedMipmaps:slice.filter(c=>c.name==='generateMipmap').length,
 uploads:uploads.map(({level,x,y,width,height})=>({level,x,y,width,height}))};}
function update(pair,layer,next){
 const bytes=pair.n*pair.n*4;pair.data.set(next,layer*bytes);
 pair.reference.addLayerUpdate(layer);pair.reference.needsUpdate=true;renderer.initTexture(pair.reference);
 // Only production candidate uploads are counted. Reference uploads are an
 // independent full-domain oracle and never charged to the candidate.
 const start=calls.length,statsBefore=pair.uploader.stats();
 const target=new THREE.WebGLRenderTarget(8,8,{depthBuffer:false,stencilBuffer:false});renderer.setRenderTarget(target);
 try{pair.uploader.uploadLayer(pair.page,layer,next,renderer);
  if(renderer.getRenderTarget()!==target)throw new Error('Transfer did not restore caller render target');
 }finally{renderer.setRenderTarget(null);target.dispose();}
 return{...callSummary(start),statsBefore,statsAfter:pair.uploader.stats(),targetRestored:true};
}
async function proofCase(n,label){
 const pair=allocate(n,label),report={size:n,depth:DEPTH,steps:[],initial:null,compaction:null,disposed:null};
 try{
  report.initial=await parity(pair,'initial-including-zero-first-source');
  const a=pattern(n,6),b=pattern(n,7,{shift:13}),transparent=b.slice();
  transparent[((n-7)*n+n-3)*4+1]=253;
  const mutations=[['paint-center',0,a],['move-and-clear-old-mark',0,b],['change-transparent-rgb',0,transparent],
   ['identical-rgba',1,transparent.slice()],['clear-all-old-pixels',0,new Uint8Array(n*n*4)],['identical-empty-rgba',3,new Uint8Array(n*n*4)],
   ['opposite-corners-dirty',2,pattern(n,19,{shift:-17})]];
  for(const [step,layer,next] of mutations){
   const transfer=update(pair,layer,next),pixels=await parity(pair,step);
   report.steps.push({step,layer,transfer,parity:pixels});
  }
  // Full-chain GPU relocation must preserve all bytes, including untouched
  // layers and the 640 -> ... -> 5 -> 2 -> 1 NPOT tail.
  const compactDepth=n===512?3:n===640?7:n===704?14:4;
  const compact=createCardArray(n,n,compactDepth,anisotropy),destination={texture:compact,uploaded:false};
  const permutation=[2,0,3,1],oldHandle=pair.candidateHandle;
  try{
   withLabel(`${label}:compact`,()=>pair.uploader.copyLayers(Array.from({length:compactDepth},(_,destinationLayer)=>({source:pair.page,sourceLayer:permutation[destinationLayer%DEPTH],destination,destinationLayer})),renderer));
   const handle=allocation(`${label}:compact`).handle,levels=[];await fence();
   for(const {level,size} of mipSizes(n)){let maximum=0,changedChannels=0;
    for(let layer=0;layer<compactDepth;layer++){
     const a=readLayer(oldHandle,n,level,permutation[layer%DEPTH]),b=readLayer(handle,n,level,layer);
     for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);maximum=Math.max(maximum,delta);if(delta)changedChannels++;}
    }levels.push({level,size,maximum,changedChannels});
   }
   report.compaction={depth:compactDepth,permutation,levels,arrayCpuBaseNull:compact.image.data===null};
  }finally{compact.dispose();}
  const identical=report.steps.filter(s=>s.step.startsWith('identical'));
  report.identicalScratchUploadSkipped=identical.every(s=>s.transfer.subImage2DCalls===0&&s.transfer.generatedMipmaps===0);
  report.arrayCpuBaseNull=pair.candidate.image.data===null;
  report.productionStats=pair.uploader.stats();
  report.passed=report.arrayCpuBaseNull&&[...report.initial,...report.steps.flatMap(s=>s.parity),...report.compaction.levels].every(p=>p.maximum===0&&p.changedChannels===0);
 }finally{pair.dispose();report.disposed=pair.uploader.stats().scratchTextures===0;}
 return report;
}
window.cardStreamingProof=async()=>{
 const ext=gl.getExtension('WEBGL_debug_renderer_info');
 const report={three:THREE.REVISION,settings:{sizes,depth:DEPTH,anisotropy,colorSpace:'SRGB',minFilter:'LinearMipmapLinearFilter',
  readback:'Raw encoded RGBA8 GPU storage, each array layer and every native mip, via test-only framebufferTextureLayer/readPixels. No shader color decode/re-encode or alpha masking. Full-domain DataArrayTexture generateMipmap is the independent oracle.',
  fixture:'Zero first input; gradients, thin lines, nonzero RGB at alpha 0; shifted marks, transparent RGB mutation, exact repeated input, full zero clearing, full dirty union, all mip compaction.',
  timing:'Correctness only; instrumentation and synchronous GPU readback deliberately exclude this script from performance comparisons.'},
  device:{vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null},cases:[],context:null};
 for(const n of sizes)report.cases.push(await proofCase(n,`case-${n}`));
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
 report.context={lost,restored,rebuilt,passed:lost&&restored&&rebuilt.passed&&rebuilt.disposed};
 report.glError=gl.getError();report.disposalErrors=disposalErrors;
 report.identicalScratchUploadSkipped=[...report.cases,report.recreate,rebuilt].every(c=>c.identicalScratchUploadSkipped);
 report.passed=[...report.cases,report.recreate].every(c=>c.passed&&c.disposed)&&report.context.passed&&report.glError===0&&disposalErrors.length===0;
 instrument=false;renderer.dispose();return report;
};
