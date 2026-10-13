/** Deterministic public-transfer contract model. No Canvas/browser/GL.
 * All RGBA components of each modeled mip are compared. The integer box model
 * is deliberately not native GPU sRGB filtering; that requires real GL proof. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as candidate from 'card-upload-mock:candidate';
import * as original from 'card-upload-mock:original';

type Rect={left:number;top:number;right:number;bottom:number};
type Storage={base?:Uint8Array;mips?:Uint8Array[];levels:Map<string,Uint8Array>};
function modelMips(base:Uint8Array,width:number,height:number){
  const result=[base.slice()];
  while(width>1||height>1){
    const nextWidth=Math.max(1,Math.floor(width/2)),nextHeight=Math.max(1,Math.floor(height/2)),prev=result.at(-1)!,next=new Uint8Array(nextWidth*nextHeight*4);
    for(let y=0;y<nextHeight;y++)for(let x=0;x<nextWidth;x++)for(let channel=0;channel<4;channel++){
      let sum=0,count=0;
      for(let dy=0;dy<Math.min(2,height);dy++)for(let dx=0;dx<Math.min(2,width);dx++){
        sum+=prev[((y*2+dy)*width+x*2+dx)*4+channel]!;count++;
      }
      next[(y*nextWidth+x)*4+channel]=Math.floor(sum/count+.5);
    }
    result.push(next);width=nextWidth;height=nextHeight;
  }
  return result;
}
class MockRenderer {
  storage=new Map<THREE.Texture,Storage>();cpuSources=new Set<THREE.Texture>();events:any[]=[];
  target:any={name:'caller-target'};face=4;mip=2;cpuAttempts=0;gpuAttempts=0;
  throwAfterCpu=0;throwAfterGpu=0;
  band:boolean;
  constructor(band:boolean){this.band=band;}
  getRenderTarget(){return this.target;}getActiveCubeFace(){return this.face;}getActiveMipmapLevel(){return this.mip;}
  setRenderTarget(target:any,face=0,mip=0){this.events.push({kind:'restore',target,face,mip});this.target=target;this.face=face;this.mip=mip;}
  initTexture(texture:THREE.Texture){
    const image=texture.image,state:Storage={levels:new Map()};
    if(texture.isDataArrayTexture){assert.equal(image.data,null);assert.equal(texture.source.dataReady,false);assert.equal(texture.generateMipmaps,false);}
    else{
      assert.ok(texture.isDataTexture);assert.equal(image.data.byteLength,image.width*image.height*4);assert.equal(texture.generateMipmaps,true);
      state.base=new Uint8Array(image.data);state.mips=modelMips(state.base,image.width,image.height);
    }
    this.storage.set(texture,state);this.events.push({kind:'init',texture,array:!!texture.isDataArrayTexture,width:image.width,height:image.height,bytes:state.base?.length??0,generate:!!texture.generateMipmaps});
  }
  copyTextureToTexture(source:THREE.Texture,destination:THREE.Texture,region:any,position:any,sourceLevel=0,destinationLevel=0){
    const dst=this.storage.get(destination);assert.ok(dst,'Destination initialized');
    const left=region.min.x,top=region.min.y,width=region.max.x-left,height=region.max.y-top,src=this.storage.get(source);
    const event:any={kind:src?'gpuCopy':'cpuCopy',source,destination,sourceLevel,destinationLevel,width,height,bytes:width*height*4,
      sourceWidth:source.image.width,sourceHeight:source.image.height,sourceX:left,sourceY:top,x:position.x,y:position.y,z:position.z??0,generate:!!destination.generateMipmaps};
    this.events.push(event);
    if(!src){
      assert.ok(source.isDataTexture&&destination.isDataTexture);assert.equal(sourceLevel,0);assert.equal(destinationLevel,0);
      assert.equal(source.version,0);assert.equal(source.source.version,0);assert.equal(source.generateMipmaps,false);
      assert.notEqual(source.image,destination.image);assert.notEqual(source.source,destination.source);
      const data=source.image.data,full=destination.image.data,rowBytes=source.image.width*4;
      assert.equal(source.image.width,destination.image.width);assert.equal(data.buffer,full.buffer,'CPU source aliases full scratch allocation');
      assert.equal(data.byteLength,source.image.width*source.image.height*4);
      assert.ok(left>=0&&region.max.x<=source.image.width&&top>=0&&region.max.y<=source.image.height);
      assert.ok(position.x>=0&&position.x+width<=destination.image.width&&position.y>=0&&position.y+height<=destination.image.height);
      if(this.band){
        assert.equal(top,0);assert.equal(source.image.height,height);
        assert.equal(data.byteOffset,full.byteOffset+position.y*rowBytes);
      }else{assert.equal(source.image.height,destination.image.height);assert.equal(data.byteOffset,full.byteOffset);assert.equal(position.y,top);}
      assert.equal(position.x,left);assert.equal(data.byteOffset-full.byteOffset+top*rowBytes,position.y*rowBytes);
      this.cpuSources.add(source);assert.ok(dst.base);
      event.viewBytes=data.byteLength;event.viewOffset=data.byteOffset-full.byteOffset;
      for(let row=0;row<height;row++){
        const offset=(top+row)*rowBytes+left*4;
        dst.base.set(data.subarray(offset,offset+width*4),((position.y+row)*destination.image.width+position.x)*4);
      }
      if(destination.generateMipmaps)dst.mips=modelMips(dst.base,destination.image.width,destination.image.height);
      // Inject after the complete modeled public copy, corresponding to an
      // observer throwing after the native call returned. This does not model
      // a throw between Three's UNPACK state setup and its restoration.
      this.cpuAttempts++;
      if(this.throwAfterCpu===this.cpuAttempts){event.threwAfterWrite=true;throw new Error('Injected CPU write interruption');}
    }else{
      assert.ok(destination.isDataArrayTexture);assert.equal(destination.generateMipmaps,false);
      assert.equal(left,0);assert.equal(top,0);assert.equal(position.x,0);assert.equal(position.y,0);
      assert.equal(width,Math.max(1,Math.floor(source.image.width/2**sourceLevel)));
      assert.equal(height,Math.max(1,Math.floor(source.image.height/2**sourceLevel)));
      assert.equal(width,Math.max(1,Math.floor(destination.image.width/2**destinationLevel)));
      assert.equal(height,Math.max(1,Math.floor(destination.image.height/2**destinationLevel)));
      const data=source.isDataTexture?src.mips![sourceLevel]:src.levels.get(`${region.min.z}:${sourceLevel}`);
      assert.ok(data);assert.equal(data.length,width*height*4);dst.levels.set(`${position.z}:${destinationLevel}`,data.slice());
      this.gpuAttempts++;if(this.throwAfterGpu===this.gpuAttempts){event.threwAfterWrite=true;throw new Error('Injected array copy interruption');}
    }
  }
}
function fixture(provider:typeof candidate|typeof original,size=512,baseMip=0){
  const renderer=new MockRenderer(provider===candidate),texture=provider.createCardArray(size/2**baseMip,size/2**baseMip,3,16);
  assert.ok(texture instanceof THREE.DataArrayTexture,'Single public Three identity');
  const uploader=new provider.CardMipUploader(16),page={texture,uploaded:false},options={sourceWidth:size,sourceHeight:size,baseMip};
  return{renderer,uploader,page,size,baseMip,options,upload(rgba:Uint8Array|Uint8ClampedArray,layer=0){
    const before=new Uint8Array(rgba);try{uploader.uploadLayer(page,layer,rgba,renderer as any,options);}finally{assert.deepEqual(new Uint8Array(rgba),before,'Caller RGBA remains readonly');}
  },dispose(){uploader.dispose();texture.dispose();}};
}
function pixels(size:number,rect:Rect,phase=1){
  const output=new Uint8Array(size*size*4);
  for(let y=rect.top;y<rect.bottom;y++)for(let x=rect.left;x<rect.right;x++){
    const offset=(y*size+x)*4;output[offset]=(x*13+phase)%251+1;output[offset+1]=(y*7+phase*3)%251+1;output[offset+2]=71+phase;output[offset+3]=(x+y)%17===0?0:183;
  }
  return output;
}
function exact(f:ReturnType<typeof fixture>,rgba:Uint8Array|Uint8ClampedArray,layer=0){
  const scratch=[...f.renderer.storage].find(([texture])=>texture.isDataTexture)!;
  assert.equal(scratch[0].image.width,f.size);assert.equal(scratch[0].image.height,f.size);assert.equal(scratch[0].image.data.length,f.size*f.size*4);
  assert.deepEqual(scratch[1].base,new Uint8Array(rgba));const expected=modelMips(new Uint8Array(rgba),f.size,f.size),dst=f.renderer.storage.get(f.page.texture)!;
  assert.equal(scratch[1].mips!.length,expected.length);
  for(let level=0;level<expected.length;level++)assert.deepEqual(scratch[1].mips![level],expected[level],`Full scratch model mip ${level} RGBA`);
  for(let level=0;level<f.page.texture.mipmaps.length;level++)assert.deepEqual(dst.levels.get(`${layer}:${level}`),expected[level+f.baseMip],`Destination model mip ${level} full RGBA`);
  for(const source of f.renderer.cpuSources)assert.ok(!f.renderer.storage.has(source),'CPU view never GPU initialized');
  for(const texture of [scratch[0],f.page.texture]){
    assert.equal(texture.colorSpace,THREE.SRGBColorSpace);assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(texture.magFilter,THREE.LinearFilter);
    assert.equal(texture.anisotropy,16);assert.equal(texture.flipY,false);assert.equal(texture.premultiplyAlpha,false);assert.equal(texture.unpackAlignment,1);
  }
}
function comparable(stats:any){const {gpuTransferSubmissionWallMs:_,...rest}=stats;return rest;}
function runCase(name:string,body:()=>any){return{name,passed:true,...body()};}
export function runMockProof(){
  const cases:any[]=[];
  cases.push(runCase('512 dirty row band: same rectangle, one copy/gen, shared view, every model mip exact',()=>{
    const a=fixture(original),b=fixture(candidate),zero=new Uint8Array(512*512*4),next=pixels(512,{left:31,top:43,right:376,bottom:307});
    a.upload(zero);b.upload(zero);const startA=a.renderer.events.length,startB=b.renderer.events.length;
    a.upload(next);b.upload(next);exact(a,next);exact(b,next);
    const old=a.renderer.events.slice(startA).filter(e=>e.kind==='cpuCopy'),now=b.renderer.events.slice(startB).filter(e=>e.kind==='cpuCopy');
    assert.equal(old.length,1);assert.equal(now.length,1);assert.equal(now[0].width,345);assert.equal(now[0].height,264);
    assert.equal(now[0].bytes,364320);assert.equal(old[0].bytes,now[0].bytes);assert.equal(now[0].viewBytes,512*264*4);assert.equal(now[0].viewOffset,43*512*4);
    assert.equal(now[0].sourceY,0);assert.equal(now[0].y,43);assert.equal(now[0].sourceX,31);assert.equal(now[0].sourceWidth,512);assert.equal(now[0].generate,true);
    assert.deepEqual(comparable(a.uploader.stats()),comparable(b.uploader.stats()));assert.equal(b.renderer.storage.size,2);
    const result={physicalRectangleBytes:364320,copyCalls:1,generations:1,exposedViewBytes:now[0].viewBytes,originalExposedViewBytes:old[0].viewBytes};a.dispose();b.dispose();return result;
  }));
  cases.push(runCase('alpha0 nonzero RGB, shifted old marks, complete zero clearing',()=>{
    const f=fixture(candidate),zero=new Uint8Array(512*512*4),a=pixels(512,{left:9,top:17,right:234,bottom:411}),b=pixels(512,{left:181,top:43,right:503,bottom:303},5);
    f.upload(zero);for(const data of [a,b,zero]){f.upload(data);exact(f,data);}f.dispose();return{everyChannel:true};
  }));
  cases.push(runCase('unchanged source copies destination chain with no extra upload or generation',()=>{
    const f=fixture(candidate),data=pixels(512,{left:11,top:39,right:271,bottom:355});f.upload(data);
    const before=f.uploader.stats(),start=f.renderer.events.length;f.upload(data,1);exact(f,data,1);
    const events=f.renderer.events.slice(start);assert.equal(events.filter(e=>e.kind==='cpuCopy'||e.kind==='init').length,0);
    assert.equal(events.filter(e=>e.kind==='gpuCopy').length,10);assert.equal(f.uploader.stats().scratchUnchangedUploads,before.scratchUnchangedUploads+1);
    f.dispose();return{destinationMipCopies:10};
  }));
  for(const [size,baseMip] of [[640,0],[704,1],[704,2],[256,2]] as const)cases.push(runCase(`NPOT/tail ${size} N${baseMip}: every model RGBA mip + compaction`,()=>{
    const f=fixture(candidate,size,baseMip),zero=new Uint8Array(size*size*4),data=pixels(size,{left:7,top:29,right:size-11,bottom:size-5},7);f.upload(zero);f.upload(data,1);exact(f,data,1);
    const destination={texture:candidate.createCardArray(size/2**baseMip,size/2**baseMip,1,16),uploaded:false};
    f.uploader.copyLayers([{source:f.page,sourceLayer:1,destination,destinationLayer:0}],f.renderer as any);
    const src=f.renderer.storage.get(f.page.texture)!,dst=f.renderer.storage.get(destination.texture)!;
    for(let level=0;level<destination.texture.mipmaps.length;level++)assert.deepEqual(dst.levels.get(`0:${level}`),src.levels.get(`1:${level}`));
    const result={sourceSize:size,baseMip,residentSize:size/2**baseMip,mipCopies:destination.texture.mipmaps.length};f.dispose();destination.texture.dispose();return result;
  }));
  for(const failure of ['cpu','array'] as const)cases.push(runCase(`failure after ${failure} physical write: RT restored, next retry full`,()=>{
    const f=fixture(candidate,704,1),zero=new Uint8Array(704*704*4),data=pixels(704,{left:41,top:57,right:671,bottom:641}),target=f.renderer.target;
    f.upload(zero);const before=f.uploader.stats();if(failure==='cpu')f.renderer.throwAfterCpu=f.renderer.cpuAttempts+1;else f.renderer.throwAfterGpu=f.renderer.gpuAttempts+2;
    assert.throws(()=>f.upload(data),/Injected .* interruption/);assert.equal(f.renderer.target,target);assert.equal(f.renderer.face,4);assert.equal(f.renderer.mip,2);
    f.renderer.throwAfterCpu=f.renderer.throwAfterGpu=0;const start=f.renderer.events.length;f.upload(data);exact(f,data);
    const events=f.renderer.events.slice(start);assert.equal(events.filter(e=>e.kind==='init'&&!e.array).length,1);assert.equal(events.filter(e=>e.kind==='cpuCopy').length,0);
    assert.equal(f.uploader.stats().scratchFullUploadFallbacks,before.scratchFullUploadFallbacks+1);assert.equal(f.renderer.storage.size,2);
    const next=pixels(704,{left:133,top:219,right:701,bottom:617},9),partial=f.renderer.events.length;f.upload(next);exact(f,next);
    assert.equal(f.renderer.events.slice(partial).filter(e=>e.kind==='cpuCopy').length,1);assert.equal(f.renderer.events.slice(partial).filter(e=>e.kind==='init').length,0);
    f.dispose();return{fullRetryBytes:data.length,targetFaceMipRestored:true};
  }));
  cases.push(runCase('edge row/column and changing bands keep stride and source y rebasing',()=>{
    const f=fixture(candidate,256),zero=new Uint8Array(256*256*4);f.upload(zero);
    for(const rect of [{left:253,top:255,right:256,bottom:256},{left:0,top:0,right:4,bottom:1},{left:17,top:0,right:239,bottom:256}]){
      const data=pixels(256,rect,8);f.upload(data);exact(f,data);f.upload(zero);exact(f,zero);
    }f.dispose();return{lastByteAndFullHeight:true};
  }));
  for(const size of [640,704])cases.push(runCase(`NPOT ${size} bottom-right 1px and full-height column boundary`,()=>{
    const f=fixture(candidate,size),zero=new Uint8Array(size*size*4);f.upload(zero);
    const one=pixels(size,{left:size-1,top:size-1,right:size,bottom:size});const start=f.renderer.events.length;f.upload(one);exact(f,one);
    const first=f.renderer.events.slice(start).find(e=>e.kind==='cpuCopy');assert.equal(first.viewBytes,size*4);assert.equal(first.viewOffset,(size-1)*size*4);
    assert.equal(first.bytes,4);assert.equal(first.sourceX,size-1);assert.equal(first.sourceY,0);assert.equal(first.y,size-1);
    f.upload(zero);const column=pixels(size,{left:13,top:0,right:14,bottom:size});const next=f.renderer.events.length;f.upload(column);exact(f,column);
    const full=f.renderer.events.slice(next).find(e=>e.kind==='cpuCopy');assert.equal(full.viewBytes,size*size*4);assert.equal(full.bytes,size*4);
    const result={sourceSize:size,lastPixelBytes:4,singleRowViewBytes:size*4,fullHeightColumnHasFullView:true};f.dispose();return result;
  }));
  cases.push(runCase('non-square 640x704 N1: full-width stride and complete model tail',()=>{
    const width=640,height=704,renderer=new MockRenderer(true),uploader=new candidate.CardMipUploader(16),page={texture:candidate.createCardArray(320,352,1,16),uploaded:false};
    const zero=new Uint8Array(width*height*4),next=zero.slice();
    for(let y=413;y<617;y++)for(let x=91;x<237;x++){const at=(y*width+x)*4;next[at]=137;next[at+1]=79;next[at+2]=213;next[at+3]=(x+y)%9===0?0:181;}
    const options={sourceWidth:width,sourceHeight:height,baseMip:1};uploader.uploadLayer(page,0,zero,renderer as any,options);uploader.uploadLayer(page,0,next,renderer as any,options);
    const expected=modelMips(next,width,height),dst=renderer.storage.get(page.texture)!;
    for(let level=0;level<page.texture.mipmaps.length;level++)assert.deepEqual(dst.levels.get(`0:${level}`),expected[level+1]);
    const cpu=renderer.events.filter(e=>e.kind==='cpuCopy');assert.equal(cpu.length,1);assert.equal(cpu[0].sourceWidth,640);assert.equal(cpu[0].sourceHeight,204);assert.equal(cpu[0].sourceY,0);assert.equal(cpu[0].y,413);
    uploader.dispose();page.texture.dispose();return{sourceWidth:width,sourceHeight:height,baseMip:1};
  }));
  cases.push(runCase('caller Uint8ClampedArray offset view is readonly and detached from scratch storage',()=>{
    const f=fixture(candidate,256),holder=new Uint8ClampedArray(256*256*4+13),view=holder.subarray(7,7+256*256*4);holder.fill(211);view.set(pixels(256,{left:5,top:19,right:241,bottom:219}));
    const originalBytes=new Uint8Array(holder);f.upload(view);exact(f,view);view.set(pixels(256,{left:29,top:71,right:213,bottom:241},9));const afterEdit=new Uint8Array(holder);
    f.upload(view);exact(f,view);assert.deepEqual(new Uint8Array(holder),afterEdit);assert.deepEqual(new Uint8Array(holder.subarray(0,7)),originalBytes.subarray(0,7));assert.equal(holder.at(-1),211);
    f.dispose();return{callerOffset:7};
  }));
  cases.push(runCase('dispose/recreate context lifecycle: new uploader full initial chain, no stale CPU view',()=>{
    const data=pixels(704,{left:23,top:67,right:681,bottom:631});const old=fixture(candidate,704,2);old.upload(new Uint8Array(data.length));old.upload(data);old.dispose();assert.equal(old.uploader.stats().scratchTextures,0);
    const next=fixture(candidate,704,2);next.upload(data);exact(next,data);assert.equal(next.uploader.stats().scratchInitialUploadBytes,data.length);assert.equal(next.renderer.cpuSources.size,0);next.dispose();return{newContextModelOnly:true};
  }));
  cases.push(runCase('negative dimensions/tails reject before GPU calls and renderer change rejects',()=>{
    const f=fixture(candidate,704,1),data=new Uint8Array(704*704*4);
    const bad=[{sourceWidth:704,sourceHeight:704,baseMip:-1},{sourceWidth:704,sourceHeight:704,baseMip:1.5},{sourceWidth:704,sourceHeight:704,baseMip:10},{sourceWidth:703,sourceHeight:704,baseMip:1},{sourceWidth:704,sourceHeight:703,baseMip:1},{sourceWidth:640,sourceHeight:640,baseMip:1}];
    for(const options of bad)assert.throws(()=>f.uploader.uploadLayer(f.page,0,data,f.renderer as any,options),/Invalid card/);
    assert.throws(()=>f.uploader.uploadLayer(f.page,3,data,f.renderer as any,f.options),/Invalid card/);
    assert.throws(()=>f.upload(data.subarray(0,data.length-1)),/Invalid card/);assert.equal(f.renderer.events.length,0);
    f.page.texture.mipmaps[1]!.width++;assert.throws(()=>f.upload(data),/Invalid card mip tail storage/);assert.equal(f.renderer.events.length,0);f.page.texture.mipmaps[1]!.width--;
    f.upload(data);const other=new MockRenderer(true);assert.throws(()=>f.uploader.uploadLayer(f.page,0,data,other as any,f.options),/one renderer/);assert.equal(other.events.length,0);
    f.dispose();return{negativeCases:10,preGpuValidation:true};
  }));
  return{passed:true,cases,scope:'CPU contract model only. Complete base and every modeled RGBA mip, source alias/stride/offset/domain, physical rectangle bytes/calls, original non-time counters, readonly caller inputs and recovery are checked. Integer box modeled mip arithmetic is NOT native GPU sRGB filtering proof; actual context recovery/native mip bytes/performance require serial real WebGL validation.'};
}
