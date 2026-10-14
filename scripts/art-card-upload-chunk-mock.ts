/** CPU contract proof only. No Canvas, browser or GL context is created.
 * Mip stamps prove ordering/provenance, not actual native sRGB filtering. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as candidate from 'card-upload-mock:candidate';
import * as original from 'card-upload-mock:original';

const LIMIT=64*1024;
type Rect={left:number;top:number;right:number;bottom:number};
type LevelStamp={version:number;base?:Uint8Array};
type Storage={base?:Uint8Array;version:number;generatedVersion:number;levels:Map<string,LevelStamp>};
class MockRenderer {
  storage=new Map<THREE.Texture,Storage>();
  initialized=new Set<THREE.Texture>();
  cpuSources=new Set<THREE.Texture>();
  events:any[]=[];
  target:any={name:'non-default-target'};face=4;mip=2;
  cpuAttempts=0;throwAfterCpuCopy=0;
  getRenderTarget(){return this.target;}
  getActiveCubeFace(){return this.face;}
  getActiveMipmapLevel(){return this.mip;}
  setRenderTarget(target:any,face=0,mip=0){this.events.push({kind:'restore',target,face,mip});this.target=target;this.face=face;this.mip=mip;}
  initTexture(texture:THREE.Texture){
    const image=texture.image,old=this.storage.get(texture),version=(old?.version??0)+1;
    const state:Storage={version,generatedVersion:-1,levels:new Map()};
    if(texture.isDataArrayTexture){
      assert.equal(texture.source.dataReady,false);assert.equal(image.data,null);assert.equal(texture.generateMipmaps,false);
    }else{
      assert.ok(texture.isDataTexture);assert.equal(image.data.byteLength,image.width*image.height*4);
      state.base=new Uint8Array(image.data);assert.equal(texture.generateMipmaps,true);
      state.generatedVersion=version;
    }
    this.storage.set(texture,state);this.initialized.add(texture);
    this.events.push({kind:'init',texture,array:!!texture.isDataArrayTexture,width:image.width,height:image.height,
      bytes:state.base?.byteLength??0,generate:!!texture.generateMipmaps});
  }
  copyTextureToTexture(source:THREE.Texture,destination:THREE.Texture,region:any,position:any,sourceLevel=0,destinationLevel=0){
    const dst=this.storage.get(destination);assert.ok(dst,'Destination must already be initialized');
    const rect={left:region.min.x,top:region.min.y,right:region.max.x,bottom:region.max.y};
    const width=rect.right-rect.left,height=rect.bottom-rect.top,src=this.storage.get(source);
    const event:any={kind:src?'gpuCopy':'cpuCopy',source,destination,rect,position:{x:position.x,y:position.y,z:position.z??0},
      sourceLevel,destinationLevel,generate:!!destination.generateMipmaps,bytes:width*height*4,
      sourceWidth:source.image.width,sourceHeight:source.image.height};
    this.events.push(event);
    if(!src){
      assert.ok(source.isDataTexture&&destination.isDataTexture,'Only public CPU-source to scratch path is expected');
      assert.equal(sourceLevel,0);assert.equal(destinationLevel,0);assert.equal(source.version,0);
      assert.equal(source.generateMipmaps,false);assert.ok(dst.base);this.cpuSources.add(source);
      this.cpuAttempts++;
      const data=source.image.data,sourceStride=source.image.width*4,destStride=destination.image.width*4;
      for(let row=0;row<height;row++){
        const start=(rect.top+row)*sourceStride+rect.left*4;
        dst.base!.set(data.subarray(start,start+width*4),(position.y+row)*destStride+position.x*4);
      }
      dst.version++;dst.generatedVersion=-1;
      if(destination.generateMipmaps)dst.generatedVersion=dst.version;
      // The error occurs AFTER a real modeled base write, matching the strict
      // GPU proof's injected interruption rather than a no-op rejected call.
      if(this.throwAfterCpuCopy&&this.cpuAttempts===this.throwAfterCpuCopy){event.threwAfterWrite=true;throw new Error('Injected after CPU segment write');}
    }else{
      assert.ok(destination.isDataArrayTexture);assert.equal(destination.generateMipmaps,false);
      assert.equal(width,Math.max(1,Math.floor(source.image.width/2**sourceLevel)));
      assert.equal(height,Math.max(1,Math.floor(source.image.height/2**sourceLevel)));
      assert.equal(width,Math.max(1,Math.floor(destination.image.width/2**destinationLevel)));
      assert.equal(height,Math.max(1,Math.floor(destination.image.height/2**destinationLevel)));
      let stamp:LevelStamp;
      if(source.isDataTexture){
        assert.equal(src.generatedVersion,src.version,'Every source native level must be generated after the FINAL base write');
        stamp={version:src.generatedVersion,base:sourceLevel===0?src.base!.slice():undefined};
      }else{
        assert.ok(source.isDataArrayTexture);const key=`${region.min.z}:${sourceLevel}`;
        const copied=src.levels.get(key);assert.ok(copied,`Completed compaction source required: ${key}`);
        stamp={version:copied.version,base:copied.base?.slice()};
      }
      dst.levels.set(`${position.z}:${destinationLevel}`,stamp);
    }
  }
  gpuTextures(){return this.initialized.size;}
  scratch(){return [...this.storage].find(([texture])=>texture.isDataTexture)!;}
}
function fixture(provider:typeof candidate|typeof original,width=512,height=width,depth=2,baseMip=0){
  const renderer=new MockRenderer(),texture=provider.createCardArray(width/2**baseMip,height/2**baseMip,depth,16);
  assert.ok(texture instanceof THREE.DataArrayTexture,'One shared public Three constructor for both providers and mock');
  const page={texture,uploaded:false},uploader=new provider.CardMipUploader(16),options={sourceWidth:width,sourceHeight:height,baseMip};
  return{provider,renderer,page,uploader,width,height,options,
    upload(rgba:Uint8Array,layer=0){uploader.uploadLayer(page,layer,rgba,renderer as any,options);},
    dispose(){uploader.dispose();texture.dispose();}};
}
function bytes(width:number,height:number,rect:Rect,phase=1){
  const output=new Uint8Array(width*height*4);
  for(let y=rect.top;y<rect.bottom;y++)for(let x=rect.left;x<rect.right;x++){
    const offset=(y*width+x)*4;output[offset]=(x*13+phase)%251+1;
    output[offset+1]=(y*7+phase*3)%251+1;output[offset+2]=91+phase;
    output[offset+3]=(x+y)%17===0?0:183; // RGB at alpha0 is deliberate.
  }
  return output;
}
function coverage(events:any[],width:number,height:number,rect:Rect,limit=LIMIT){
  const covered=new Uint8Array(width*height);
  for(const event of events){
    assert.equal(event.kind,'cpuCopy');assert.ok(event.bytes>0&&event.bytes<=limit);
    assert.equal(event.position.x,event.rect.left);assert.equal(event.position.y,event.rect.top);
    for(let y=event.rect.top;y<event.rect.bottom;y++)for(let x=event.rect.left;x<event.rect.right;x++){
      assert.ok(x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom);covered[y*width+x]++;
    }
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)
    assert.equal(covered[y*width+x],x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom?1:0,'Rectangle coverage must have no overlap, gap or outside write');
  assert.equal(events.reduce((sum,event)=>sum+event.bytes,0),(rect.right-rect.left)*(rect.bottom-rect.top)*4);
  assert.deepEqual(events.map(event=>event.generate),events.map((_,index)=>index===events.length-1));
}
function sourceEquals(f:ReturnType<typeof fixture>,rgba:Uint8Array){assert.deepEqual(f.renderer.scratch()[1].base,rgba);}
function settings(f:ReturnType<typeof fixture>){
  const [scratch]=f.renderer.scratch();
  for(const texture of [scratch,f.page.texture]){
    assert.equal(texture.colorSpace,THREE.SRGBColorSpace);assert.equal(texture.flipY,false);assert.equal(texture.premultiplyAlpha,false);
    assert.equal(texture.unpackAlignment,1);assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(texture.anisotropy,16);
  }
  assert.equal(scratch.generateMipmaps,true);assert.equal(f.page.texture.generateMipmaps,false);
  assert.equal(f.renderer.cpuSources.size,1);assert.ok([...f.renderer.cpuSources].every(texture=>!f.renderer.initialized.has(texture)));
}
function runCase(name:string,body:()=>any){const result=body();return{name,passed:true,...result};}
export function runMockProof(){
  const cases=[];
  cases.push(runCase('345x264: full rectangle, six bounded row segments, exact logical bytes',()=>{
    const rect={left:31,top:43,right:376,bottom:307},f=fixture(candidate),baseline=fixture(original),zero=new Uint8Array(512*512*4),next=bytes(512,512,rect);
    f.upload(zero);baseline.upload(zero);const before=f.uploader.stats(),start=f.renderer.events.length;
    f.upload(next);baseline.upload(next);
    const cpu=f.renderer.events.slice(start).filter(event=>event.kind==='cpuCopy');coverage(cpu,512,512,rect);
    assert.deepEqual(cpu.map(event=>event.rect.bottom-event.rect.top),[47,47,47,47,47,29]);
    sourceEquals(f,next);sourceEquals(baseline,next);assert.equal(f.renderer.gpuTextures(),2);settings(f);
    const after=f.uploader.stats(),old=baseline.uploader.stats();
    assert.equal(after.partialUploadCopyCalls-before.partialUploadCopyCalls,6);
    assert.equal(after.scratchPartialUploads-before.scratchPartialUploads,1);assert.equal(after.scratchPartialUploadBytes-before.scratchPartialUploadBytes,364320);
    assert.equal(after.scratchUploadBytes-before.scratchUploadBytes,364320);
    const {partialUploadCopyCalls:_,gpuTransferSubmissionWallMs:__,...comparable}=after;
    const {gpuTransferSubmissionWallMs:oldWall,...originalComparable}=old;
    assert.deepEqual(comparable,originalComparable,'All original non-time counters must retain their source semantics');
    const destination=f.renderer.storage.get(f.page.texture)!;assert.deepEqual(destination.levels.get('0:0')!.base,next);
    assert.equal(f.renderer.events.filter(event=>event.kind==='init'&&!event.array).length,1);
    assert.equal(cpu.filter(event=>event.generate).length,1);
    const result={segments:cpu.length,segmentHeights:cpu.map(event=>event.rect.bottom-event.rect.top),logicalPartialBytes:364320,gpuTextures:2};
    f.dispose();baseline.dispose();return result;
  }));
  cases.push(runCase('alpha0 RGB, shifted old marks, zero clearing, unchanged source still copies every destination mip',()=>{
    const f=fixture(candidate),zero=new Uint8Array(512*512*4),a=bytes(512,512,{left:40,top:50,right:300,bottom:350}),b=bytes(512,512,{left:70,top:90,right:350,bottom:400},2);
    f.upload(zero);f.upload(a);f.upload(b);sourceEquals(f,b);
    const transparent=b.slice();transparent[3]=0;transparent[0]=239;transparent[1]=71;transparent[2]=103;
    f.upload(transparent);sourceEquals(f,transparent);f.upload(zero);sourceEquals(f,zero);
    const before=f.uploader.stats(),start=f.renderer.events.length;f.upload(zero,1);
    const events=f.renderer.events.slice(start),after=f.uploader.stats();
    assert.equal(events.filter(event=>event.kind==='cpuCopy'||event.kind==='init').length,0);
    assert.equal(events.filter(event=>event.kind==='gpuCopy').length,f.page.texture.mipmaps.length);
    assert.equal(after.scratchUnchangedUploads-before.scratchUnchangedUploads,1);
    assert.equal(after.partialUploadCopyCalls,before.partialUploadCopyCalls);assert.equal(after.scratchUploadBytes,before.scratchUploadBytes);
    assert.equal(f.renderer.gpuTextures(),2);settings(f);f.dispose();return{allRgbaCompared:true,unchangedArrayCopies:10};
  }));
  cases.push(runCase('throw after second physical segment: flags/RT restored and next retry full exactly once',()=>{
    const f=fixture(candidate),zero=new Uint8Array(512*512*4),next=bytes(512,512,{left:31,top:43,right:376,bottom:307}),target=f.renderer.target;
    f.upload(zero);const before=f.uploader.stats();f.renderer.throwAfterCpuCopy=2;
    assert.throws(()=>f.upload(next),/Injected after CPU segment write/);
    assert.equal(f.renderer.target,target);assert.equal(f.renderer.face,4);assert.equal(f.renderer.mip,2);
    assert.equal(f.renderer.scratch()[0].generateMipmaps,true);assert.equal(f.renderer.cpuAttempts,2);
    const failed=f.uploader.stats();assert.equal(failed.partialUploadCopyCalls-before.partialUploadCopyCalls,2);
    assert.equal(failed.scratchPartialUploads,before.scratchPartialUploads);assert.equal(failed.scratchUploadBytes,before.scratchUploadBytes);
    const start=f.renderer.events.length;f.renderer.throwAfterCpuCopy=0;f.upload(next);
    const recovery=f.renderer.events.slice(start),after=f.uploader.stats();
    assert.equal(recovery.filter(event=>event.kind==='cpuCopy').length,0);
    const full=recovery.filter(event=>event.kind==='init'&&!event.array);assert.equal(full.length,1);assert.equal(full[0].bytes,next.length);assert.equal(full[0].generate,true);
    assert.equal(after.scratchFullUploadFallbacks,before.scratchFullUploadFallbacks+1);
    assert.equal(after.scratchFullUploadBytes-before.scratchFullUploadBytes,next.length);
    assert.equal(after.scratchUploadBytes-before.scratchUploadBytes,next.length);sourceEquals(f,next);
    assert.deepEqual(f.renderer.storage.get(f.page.texture)!.levels.get('0:0')!.base,next);
    assert.equal(f.renderer.gpuTextures(),2);settings(f);f.dispose();return{attemptedPartialCopies:2,fullRetryBytes:next.length,
      byteCounterScope:'Completed logical transfers, exactly the original provider semantics; mock events separately retain writes before an injected error.'};
  }));
  cases.push(runCase('native704→352 tail: original source dimensions, source level1+destination level, compaction unchanged',()=>{
    const f=fixture(candidate,704,704,2,1),zero=new Uint8Array(704*704*4),rect={left:93,top:74,right:631,bottom:617},next=bytes(704,704,rect,4);
    f.upload(zero);const start=f.renderer.events.length;f.upload(next,1);
    const events=f.renderer.events.slice(start),cpu=events.filter(event=>event.kind==='cpuCopy'),gpu=events.filter(event=>event.kind==='gpuCopy');
    coverage(cpu,704,704,rect);sourceEquals(f,next);assert.equal(gpu.length,9);
    for(let level=0;level<gpu.length;level++){
      assert.equal(gpu[level].sourceLevel,level+1);assert.equal(gpu[level].destinationLevel,level);
      assert.equal(gpu[level].rect.right,Math.max(1,Math.floor(704/2**(level+1))));
      assert.equal(gpu[level].position.z,1);
    }
    const compact={texture:candidate.createCardArray(352,352,1,16),uploaded:false},before=f.uploader.stats();
    f.uploader.copyLayers([{source:f.page,sourceLayer:1,destination:compact,destinationLayer:0}],f.renderer as any);
    const after=f.uploader.stats();assert.equal(after.gpuCompactionLayers-before.gpuCompactionLayers,1);
    assert.equal(after.gpuCompactionCopyCalls-before.gpuCompactionCopyCalls,9);assert.equal(after.partialUploadCopyCalls,before.partialUploadCopyCalls);
    const src=f.renderer.storage.get(f.page.texture)!,dst=f.renderer.storage.get(compact.texture)!;
    for(let level=0;level<9;level++)assert.deepEqual(dst.levels.get(`0:${level}`),src.levels.get(`1:${level}`));
    settings(f);f.dispose();compact.texture.dispose();return{tailCopies:9,sourceSize:704,residentSize:352,compactionCopies:9};
  }));
  for(const [name,width,height,expected] of [['exact64KiB',256,64,1],['oneByteRowLimitRGBApixel',16384,2,2],['rowExceeds64KiB',16385,2,3]] as const){
    cases.push(runCase(name,()=>{
      const f=fixture(candidate,width,height,1),zero=new Uint8Array(width*height*4),rect={left:0,top:0,right:width,bottom:height},next=bytes(width,height,rect,6);
      f.upload(zero);const before=f.uploader.stats(),start=f.renderer.events.length;f.upload(next);
      const cpu=f.renderer.events.slice(start).filter(event=>event.kind==='cpuCopy');coverage(cpu,width,height,rect);
      assert.equal(cpu.length,expected);sourceEquals(f,next);assert.equal(f.renderer.gpuTextures(),2);settings(f);
      const after=f.uploader.stats();assert.equal(after.scratchUploadBytes-before.scratchUploadBytes,next.length);
      assert.equal(after.scratchPartialUploadBytes-before.scratchPartialUploadBytes,next.length);
      assert.equal(after.scratchPartialUploads-before.scratchPartialUploads,1);assert.equal(after.partialUploadCopyCalls-before.partialUploadCopyCalls,expected);
      f.dispose();return{width,height,segments:expected,totalBytes:next.length,maxSegmentBytes:Math.max(...cpu.map(event=>event.bytes)),
        wideDomainScope:'Mock arithmetic only; no claim this width is supported by a real GPU.'};
    }));
  }
  return{passed:true,cases,method:'Deterministic public-contract model. Exact CPU/base/layer0 RGBA, rectangle coverage, original counters, mip provenance/order and recovery are checked. Actual native sRGB mip RGBA and timing require separate serial GPU proof/whole-frame ABBA.'};
}
