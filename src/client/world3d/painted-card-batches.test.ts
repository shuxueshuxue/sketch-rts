import { ART_TILE_SIZE, ART_ACTION_SIZE } from '../art/raster-cache';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import * as THREE from 'three';
import {PaintedCardBatches,patchCardShader,type PaintedCardPolicy} from './painted-card-batches';
import {SHIP_CAMERA} from '../../shared/ship-geometry';
const renderer={initTexture:vi.fn(),copyTextureToTexture:vi.fn(),getRenderTarget:()=>null,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:vi.fn()};
afterEach(()=>{vi.unstubAllGlobals();renderer.initTexture.mockReset();renderer.copyTextureToTexture.mockReset();renderer.setRenderTarget.mockReset();});
function setup(policy:PaintedCardPolicy={maxTextureBanks:8}){
  vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});
  const scene=new THREE.Scene(),cards=new PaintedCardBatches(scene,8,policy);return{scene,cards};
}
function binding(cards:PaintedCardBatches,id:string){
 const mesh=cards.objects().find(mesh=>mesh.userData.ids.includes(id))!,index=mesh.userData.ids.indexOf(id);
 const texture:THREE.DataArrayTexture=mesh.userData.banks[mesh.geometry.getAttribute('cardBank').getX(index)].texture;
 return{mesh,index,texture};
}
function residentTextures(cards:PaintedCardBatches){return(cards as unknown as {pages:{texture:THREE.DataArrayTexture}[]}).pages.map(page=>page.texture);}
function storedMipBytes(texture:THREE.DataArrayTexture){return(texture.mipmaps as {width:number;height:number}[]).reduce((sum,mip)=>sum+mip.width*mip.height*4*texture.image.depth,0);}
const matrix=new THREE.Matrix4();
const paint=(ctx:CanvasRenderingContext2D)=>{ctx.fillStyle='#ff0000';ctx.fillRect(-16,-24,32,48);};
const fullPaint=(ctx:CanvasRenderingContext2D)=>{ctx.fillStyle='#ff0000';ctx.fillRect(-62,-62,124,124);};
describe('painted card array batches',()=>{
  it.each([2,4])('prepares exact density-%i source bytes without allocating GPU pages or showing actors',density=>{
    const {cards,scene}=setup(),painter=vi.fn((ctx:CanvasRenderingContext2D)=>{
      ctx.fillStyle='#634b87';ctx.fillRect(-7,-43,11,58);
      ctx.fillStyle='rgba(201,89,37,.6)';ctx.fillRect(12,19,4,6);
    }),size=ART_TILE_SIZE*density;
    const source=createCanvas(size,size),ctx=source.getContext('2d');ctx.scale(density,density);ctx.translate(ART_TILE_SIZE/2,ART_TILE_SIZE/2);
    painter(ctx as unknown as CanvasRenderingContext2D);painter.mockClear();
    const rgba=ctx.getImageData(0,0,size,size).data,expected=new Uint8Array(rgba.length);
    for(let y=0;y<size;y++)expected.set(rgba.subarray(y*size*4,(y+1)*size*4),(size-1-y)*size*4);
    cards.prepareRaster('future',density,painter);cards.prepareRaster('future',density,painter);
    expect(painter).toHaveBeenCalledTimes(1);expect(renderer.initTexture).not.toHaveBeenCalled();expect(renderer.copyTextureToTexture).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);expect(cards.objects()).toHaveLength(0);
    expect(cards.stats()).toMatchObject({pages:0,cards:0,rasterizations:0,preparedRasters:1,pendingRgbaBytes:0,ownedGpuBytes:0,rasterCache:{entries:1}});
    let uploaded:Uint8Array|undefined;
    renderer.copyTextureToTexture.mockImplementation((source:THREE.Texture,_destination:THREE.Texture,_region:unknown,_position:unknown,level:number)=>{
      if(level===0&&source instanceof THREE.DataTexture)uploaded=new Uint8Array(source.image.data!);
    });
    cards.begin();cards.add('future',density,painter,matrix,'now-visible',17);cards.finish(renderer);
    expect(painter).toHaveBeenCalledTimes(1);expect(Buffer.from(uploaded!).equals(Buffer.from(expected))).toBe(true);
    expect(cards.objects().flatMap(mesh=>mesh.userData.ids)).toEqual(['now-visible']);
    const visible=binding(cards,'now-visible');expect(visible.mesh.userData.paintedHit(visible.index,{x:.5,y:.5})).toBe(true);
    expect(visible.mesh.userData.paintedHit(visible.index,{x:.1,y:.1})).toBe(false);
    expect(cards.stats()).toMatchObject({preparedRasters:1,rasterizations:1,rasterCache:{entries:1,hits:2}});cards.dispose();
  });
  it('defaults to ordered single-bank draws and the original implicit sampling in every pass',()=>{
    const {cards}=setup({});cards.begin();
    for(const [order,bank] of [0,1,0].entries())cards.add(`default:${bank}`,2,paint,matrix,`unit:${order}`,17,bank?160:128);cards.finish(renderer);
    const meshes=cards.objects();expect(meshes).toHaveLength(3);expect(meshes.flatMap(mesh=>mesh.userData.ids)).toEqual(['unit:0','unit:1','unit:2']);
    expect(cards.stats()).toMatchObject({maxTextureBanks:1,pages:2,cards:2,rasterizations:2});
    expect(meshes[0]!.userData.banks[0]).toBe(meshes[2]!.userData.banks[0]);
    for(const mesh of meshes){
      expect(mesh.userData.banks).toHaveLength(1);expect(mesh.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);
      for(const [index,material] of [mesh.material as THREE.MeshBasicMaterial,mesh.customDepthMaterial!,mesh.customDistanceMaterial!].entries()){
        const source=[THREE.ShaderLib.basic,THREE.ShaderLib.depth,THREE.ShaderLib.distance][index]!,shader={vertexShader:source.vertexShader,fragmentShader:source.fragmentShader,uniforms:THREE.UniformsUtils.clone(source.uniforms)};
        material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);
        expect(shader.fragmentShader).toContain('diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');expect(shader.fragmentShader).not.toContain('textureGrad');expect(shader.fragmentShader).not.toContain('cardMap1');
        expect(shader.uniforms.map!.value).toBe(mesh.userData.banks[0].texture);
      }
    }
    cards.dispose();
  });
  it('shares full-resolution color/facing/pose layers with separate instance IDs and feet',()=>{
    const {cards}=setup();cards.begin();
    for(let i=0;i<16;i++)cards.add(`pose:${i}`,4,paint,matrix,`unit:${i}`,i);
    cards.finish(renderer);const [mesh]=cards.objects();expect(cards.objects()).toHaveLength(1);expect(mesh!.count).toBe(16);
    expect(cards.stats()).toMatchObject({pages:1,cards:16,rasterizations:16,pixels:512*512*16});
    const texture=(mesh!.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture;
    expect(texture.image).toMatchObject({width:512,height:512,depth:16});expect(texture.generateMipmaps).toBe(false);expect(texture.mipmaps).toHaveLength(10);expect(texture.anisotropy).toBe(8);
    expect(mesh!.customDepthMaterial!.alphaTest).toBe(.4);expect(mesh!.customDistanceMaterial!.alphaTest).toBe(.4);
    const transform=new THREE.Matrix4();mesh!.getMatrixAt(12,transform);expect(transform.elements[13]).toBe(0);expect(mesh!.geometry.getAttribute('cardRect').getY(12)).toBeCloseTo((-64+12)/Math.tan(SHIP_CAMERA.tilt),5);
    expect(mesh!.userData.ids[12]).toBe('unit:12');expect(mesh!.geometry.getAttribute('cardLayer').getX(12)).toBe(12);cards.dispose();
  });
  it('keeps exact alpha picking in a compact mask with no persistent RGBA',()=>{
    const {cards,scene}=setup();cards.begin();cards.add('visible',2,paint,matrix,'first',17);cards.add('empty',2,()=>{},matrix,'second',17);cards.finish(renderer);scene.updateMatrixWorld(true);
    const mesh=cards.objects()[0]!;
    expect(mesh.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);
    const empty=binding(cards,'second');expect(empty.mesh.userData.paintedHit(empty.index,{x:.5,y:.5})).toBe(false);
    expect(mesh.userData.paintedHit(0,{x:0,y:0})).toBe(false);
    const hits=new THREE.Raycaster(new THREE.Vector3(0,17/Math.tan(SHIP_CAMERA.tilt),300),new THREE.Vector3(0,0,-1)).intersectObject(mesh);
    expect(hits.length).toBeGreaterThan(0);expect(hits[0]!.uv!.y).toBeCloseTo(.5);cards.dispose();
  });
  it('does not rerasterize a warm card, releases idle page textures and keeps its draw chunk until dispose',()=>{
    const {cards,scene}=setup(),painter=vi.fn(paint);cards.begin();cards.add('pose',4,painter,matrix,'one',17);cards.finish(renderer);
    const mesh=cards.objects()[0]!,material=mesh.material as THREE.MeshBasicMaterial,page=vi.spyOn(material.map!,'dispose');
    const releases=[material,mesh.geometry,mesh.customDepthMaterial!,mesh.customDistanceMaterial!,mesh].map(resource=>vi.spyOn(resource,'dispose'));
    cards.begin();cards.add('pose',4,painter,matrix,'two',17);cards.finish(renderer);expect(painter).toHaveBeenCalledTimes(1);
    for(let i=0;i<121;i++){cards.begin();cards.finish(renderer);}
    expect(cards.stats()).toMatchObject({pages:0,cards:0,maskBytes:0,arrayCpuBytes:0,pendingRgbaBytes:0});expect(cards.objects()).toHaveLength(0);expect(page).toHaveBeenCalledTimes(1);
    // Its materials keep their shader programs for the next card drawn.
    for(const release of releases)expect(release).not.toHaveBeenCalled();
    cards.dispose();expect(scene.children).toHaveLength(0);for(const release of releases)expect(release).toHaveBeenCalledTimes(1);
  });
  it('protects later visible warm cards from an early cache miss at the soft budget',()=>{
    const {cards}=setup(),painter=vi.fn(fullPaint);cards.begin();
    for(let i=0;i<48;i++)cards.add(`warm:${i}`,4,painter,matrix,`${i}`,17);cards.finish(renderer);
    expect(cards.stats().pixels).toBe(12*1024*1024);
    cards.begin();cards.add('new',4,painter,matrix,'new',17);
    for(let i=0;i<48;i++)cards.add(`warm:${i}`,4,painter,matrix,`${i}`,17);cards.finish(renderer);
    expect(painter).toHaveBeenCalledTimes(49);expect(cards.objects().reduce((n,mesh)=>n+mesh.count,0)).toBe(49);cards.dispose();
  });
  it('compacts surviving poses across sparse pages without rerasterizing or changing picking',()=>{
    const {cards}=setup(),painter=vi.fn(fullPaint);cards.begin();
    for(let i=0;i<64;i++)cards.add(`${i}`,4,painter,matrix,`${i}`,17);cards.finish(renderer);
    expect(cards.stats().pages).toBe(4);
    cards.begin();for(const i of [0,16,32,48])cards.add(`${i}`,4,painter,matrix,`${i}`,17);cards.finish(renderer);
    expect(cards.stats()).toMatchObject({pages:1,cards:16,copiedLayers:3,rasterizations:64,mipInitializedPages:4});expect(painter).toHaveBeenCalledTimes(64);
    const mesh=cards.objects()[0]!;expect(mesh.count).toBe(4);expect(mesh.userData.ids).toEqual(['0','16','32','48']);
    for(let i=0;i<4;i++){expect(mesh.userData.paintedHit(i,{x:.5,y:.5})).toBe(true);expect(mesh.userData.paintedHit(i,{x:0,y:0})).toBe(false);}cards.dispose();
  });
  it('uses identical array sampling in visible, depth and point-light shadow passes',()=>{
    for(const source of [THREE.ShaderLib.basic,THREE.ShaderLib.depth,THREE.ShaderLib.distance]){
      const shader={vertexShader:source.vertexShader,fragmentShader:source.fragmentShader};patchCardShader(shader);
      expect(shader.vertexShader).toContain('vCardLayer = cardLayer');expect(shader.fragmentShader).toContain('uniform highp sampler2DArray map');
      expect(shader.fragmentShader).toContain('vec3(vMapUv, vCardLayer)');expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    }
  });
  it('keeps all current-frame cards when the visible set exceeds the soft budget',()=>{
    const {cards}=setup();cards.begin();for(let i=0;i<50;i++)cards.add(`${i}`,4,fullPaint,matrix,`${i}`,17);cards.finish(renderer);
    expect(cards.objects().reduce((n,mesh)=>n+mesh.count,0)).toBe(50);expect(cards.stats().cards).toBe(50);
    cards.begin();cards.add('49',4,fullPaint,matrix,'49',17);cards.finish(renderer);expect(cards.stats().pixels).toBeLessThanOrEqual(12*1024*1024);cards.dispose();
  });
  it('preserves the complete source and mip domain, including non-power-of-two action tiles',()=>{
    const {cards}=setup(),density=4,foot=23,size=640;
    const painter=(ctx:CanvasRenderingContext2D)=>{ctx.fillStyle='#634b87';ctx.fillRect(-7,-68,11,84);ctx.fillStyle='rgba(201,89,37,.6)';ctx.fillRect(12,-31,4,6);};
    const source=createCanvas(size,size),ctx=source.getContext('2d');ctx.scale(density,density);ctx.translate(80,80);painter(ctx as unknown as CanvasRenderingContext2D);
    const rgba=ctx.getImageData(0,0,size,size).data;
    let uploaded:Uint8Array|undefined;
    renderer.copyTextureToTexture.mockImplementation((source:THREE.Texture,_destination:THREE.Texture,_region:unknown,_position:unknown,level:number)=>{if(level===0&&source instanceof THREE.DataTexture)uploaded=new Uint8Array(source.image.data!);});
    cards.begin();cards.add('extended',density,painter,matrix,'one',foot,160);cards.finish(renderer);
    const mesh=cards.objects()[0]!,texture=(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture;
    const expected=new Uint8Array(rgba.length);for(let y=0;y<size;y++)expected.set(rgba.subarray(y*size*4,(y+1)*size*4),(size-1-y)*size*4);
    expect(Buffer.from(uploaded!).equals(Buffer.from(expected))).toBe(true);expect(texture.image.data).toBeNull();expect(texture.source.dataReady).toBe(false);
    expect(texture.image.width*texture.image.height).toBe(size*size);expect(cards.stats().peakPendingRgbaBytes).toBe(size*size*4);expect(cards.stats().pendingRgbaBytes).toBe(0);cards.dispose();
  });
});


it('retains mixed 128/160 domains and density identities at their original foot anchor and full mip extent',()=>{
 const {cards}=setup();cards.begin();
 // The identical logical key must not alias either the domain or the density.
 cards.add('same',4,paint,matrix,'ready',17,ART_TILE_SIZE);
 cards.add('same',4,b=>{b.fillStyle='#345';b.fillRect(68,-72,7,7);},matrix,'upward',17,ART_ACTION_SIZE);
 cards.add('same',2,paint,matrix,'ready-low',17,ART_TILE_SIZE);
 cards.finish(renderer);expect(cards.stats().cards).toBe(3);expect(cards.stats().rasterizations).toBe(3);
 expect(cards.objects().reduce((sum,mesh)=>sum+mesh.count,0)).toBe(3);
 for(const [id,density] of [['ready',4],['upward',4],['ready-low',2]] as const){
   const mesh=cards.objects().find(mesh=>mesh.userData.ids.includes(id))!,index=mesh.userData.ids.indexOf(id);
   const {texture}=binding(cards,id),{width,height}=texture.image;
   const transform=new THREE.Matrix4();mesh.getMatrixAt(index,transform);
   expect(transform.equals(matrix)).toBe(true);
   const tile=id==='upward'?ART_ACTION_SIZE:ART_TILE_SIZE;
   expect(width/tile).toBe(density);expect(height/tile).toBe(density);
   const rect=mesh.geometry.getAttribute('cardRect');expect(rect.getX(index)).toBe(-tile/2);expect(rect.getZ(index)).toBe(tile/2);
   const authored=id==='upward'?{x:71.5,y:-68.5}:{x:0,y:0};
   expect(mesh.userData.paintedHit(index,{x:authored.x/tile+.5,y:.5-authored.y/tile})).toBe(true);
   let ink=0;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mesh.userData.paintedHit(index,{x:(x+.5)/width,y:(y+.5)/height}))ink++;
   expect(ink).toBe((id==='upward'?7*7:32*48)*density*density);
   expect(width*height).toBe(((id==='upward'?ART_ACTION_SIZE:ART_TILE_SIZE)*density)**2);
 }
 cards.dispose();
});

 it('raycasts the authored full quad through mirrored transforms but rejects transparent or out-of-domain UVs',()=>{
  const {cards,scene}=setup(),mirror=new THREE.Matrix4().makeScale(-1,1,1).setPosition(80,0,0);
  cards.begin();cards.add('edge',4,b=>{b.fillStyle='#234';b.fillRect(40,-40,8,8);},mirror,'mirror',17,160);cards.finish(renderer);scene.updateMatrixWorld(true);
  const mesh=cards.objects()[0]!,y=(17+36)/Math.tan(SHIP_CAMERA.tilt),hits=new THREE.Raycaster(new THREE.Vector3(36,y,300),new THREE.Vector3(0,0,-1)).intersectObject(mesh);
  expect(hits).toHaveLength(1);expect(hits[0]!.instanceId).toBe(0);expect(mesh.userData.paintedHit(0,hits[0]!.uv)).toBe(true);
  expect(mesh.userData.paintedHit(0,{x:0,y:0})).toBe(false);expect(mesh.userData.paintedHit(0,{x:-.1,y:.5})).toBe(false);
  expect(mesh.boundingSphere!.radius).toBeGreaterThan(80);cards.dispose();
 });

it('isolates translucent remains policy and varies instance opacity without repainting or picking',()=>{
 vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});
 const scene=new THREE.Scene(),cards=new PaintedCardBatches(scene,8,{transparent:true,depthWrite:false,alphaTest:.01,castShadow:false,pickable:false,renderOrder:-1}),painter=vi.fn(paint);
 cards.begin();cards.add('remains',2,painter,matrix,'one',0,128,.58);cards.finish(renderer);scene.updateMatrixWorld(true);
 const mesh=cards.objects()[0]!,material=mesh.material as THREE.MeshBasicMaterial;
 expect(material).toMatchObject({transparent:true,depthTest:true,depthWrite:false,alphaTest:.01});expect(mesh.castShadow).toBe(false);expect(mesh.renderOrder).toBeGreaterThan(-1);expect(mesh.renderOrder).toBeLessThan(0);
 expect(mesh.geometry.getAttribute('cardOpacity').getX(0)).toBeCloseTo(.58);expect(mesh.userData.paintedHit(0,{x:.5,y:.5})).toBe(false);
 expect(new THREE.Raycaster(new THREE.Vector3(0,0,300),new THREE.Vector3(0,0,-1)).intersectObject(mesh)).toHaveLength(0);
 cards.begin();cards.add('remains',2,painter,matrix,'one',0,128,.4);cards.finish(renderer);expect(painter).toHaveBeenCalledTimes(1);expect(mesh.geometry.getAttribute('cardOpacity').getX(0)).toBeCloseTo(.4);
 const resources=[material,material.map!,mesh.geometry,mesh.customDepthMaterial!,mesh.customDistanceMaterial!,mesh].map(resource=>vi.spyOn(resource,'dispose'));
 cards.dispose();expect(scene.children).toHaveLength(0);for(const release of resources)expect(release).toHaveBeenCalledTimes(1);
});

it('drops caches on context loss and repaints from new ordinary frame requests',()=>{
 const {cards}=setup(),painter=vi.fn(paint);
 cards.begin();cards.add('kept',2,painter,matrix,'one',17);cards.finish(renderer);
 const mesh=cards.objects()[0]!,before=(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture,disposed=vi.spyOn(before,'dispose');
 cards.invalidateGPU();expect(cards.stats()).toMatchObject({cards:0,pages:0,cpuBytes:0,scratchTextures:0});expect(cards.objects()).toHaveLength(0);expect(disposed).toHaveBeenCalledTimes(1);
 cards.begin();cards.add('kept',2,painter,matrix,'one',17);cards.finish(renderer);
 const after=cards.objects()[0]!,texture=(after.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture;
 expect(texture).not.toBe(before);expect(texture.image.data).toBeNull();expect(painter).toHaveBeenCalledTimes(2);expect(after.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);
 expect(cards.stats()).toMatchObject({mipInitializedPages:2,mipLayerUpdates:2,rasterizations:2});cards.dispose();expect(cards.stats().ownedCpuBytes).toBe(0);
});

it('streams hundreds of misses with only one readback layer pending and retains no painters',()=>{
 const {cards}=setup();cards.begin();for(let i=0;i<100;i++)cards.add(String(i),2,paint,matrix,String(i),17);cards.finish(renderer);
 const stats=cards.stats();expect(stats.peakPendingRgbaBytes).toBe(256*256*4);expect(stats.pendingRgbaBytes).toBe(0);expect(stats.arrayCpuBytes).toBe(0);expect(stats.maskBytes).toBe(100*256*256/8);expect(stats.rowScratchBytes).toBe(256*4);
 expect((cards as unknown as {pending:unknown[]}).pending).toHaveLength(0);cards.dispose();expect(cards.stats().ownedCpuBytes).toBe(0);
});

it('preserves every ownership peak sample without collecting public draw statistics during raster or failed promotion',()=>{
 const {cards}=setup({}),internal=cards as unknown as {recordPeaks:()=>void;pages:{texture:THREE.DataArrayTexture;mipBytes:number;uploaded:boolean}[]};
 const record=internal.recordPeaks.bind(internal),statsReads=vi.spyOn(cards,'stats');
 const expected={peakPendingRgbaBytes:0,peakOwnedCpuBytes:0,peakOwnedGpuBytes:0,peakRetiredGpuBytes:0};
 const samples=vi.spyOn(internal,'recordPeaks').mockImplementation(()=>{
  const state=cards.stats(),reads=statsReads.mock.calls.length;
  expected.peakPendingRgbaBytes=Math.max(expected.peakPendingRgbaBytes,state.pendingRgbaBytes);expected.peakOwnedCpuBytes=Math.max(expected.peakOwnedCpuBytes,state.ownedCpuBytes);expected.peakOwnedGpuBytes=Math.max(expected.peakOwnedGpuBytes,state.ownedGpuBytes);expected.peakRetiredGpuBytes=Math.max(expected.peakRetiredGpuBytes,state.retiredGpuBytes);
  record();expect(statsReads).toHaveBeenCalledTimes(reads);
 });
 const check=()=>{
  const state=cards.stats();expect(state).toMatchObject(expected);
  for(const page of internal.pages)expect(page.mipBytes).toBe(storedMipBytes(page.texture));
  expect(state.allocatedMipBytes).toBe(internal.pages.reduce((sum,page)=>sum+storedMipBytes(page.texture),0));
  expect(state.ownedGpuBytes).toBe(state.scratchGpuBytes+internal.pages.reduce((sum,page)=>sum+(page.uploaded?storedMipBytes(page.texture):0),0));
 };
 cards.begin();cards.add('action',4,paint,matrix,'coarse',17,176,1,1);cards.add('body',4,paint,matrix,'body',17);cards.add('empty',4,()=>{},matrix,'empty',17);cards.finish(renderer);check();
 expect(samples).toHaveBeenCalledTimes(9);
 cards.begin();cards.add('action',4,paint,matrix,'coarse-warm',17,176,1,1);cards.add('action',4,paint,matrix,'fine',17,176);
 renderer.copyTextureToTexture.mockImplementation((_source:THREE.Texture,destination:THREE.Texture)=>{if(destination instanceof THREE.DataArrayTexture&&destination.image.width===704)throw Error('peak promotion failure');});
 expect(()=>cards.finish(renderer)).toThrow('peak promotion failure');check();expect(samples).toHaveBeenCalledTimes(11);
 renderer.copyTextureToTexture.mockReset();cards.begin();cards.add('action',4,paint,matrix,'fine-retry',17,176);cards.add('body',4,paint,matrix,'body-warm',17);cards.finish(renderer);check();expect(samples).toHaveBeenCalledTimes(14);
 expect(cards.objects().flatMap(mesh=>mesh.userData.ids)).toEqual(['fine-retry','body-warm']);cards.dispose();expect(cards.stats()).toMatchObject({ownedCpuBytes:0,ownedGpuBytes:0,allocatedMipBytes:0});
});

it('keeps visible compaction sources alive and invalidates overwritten warm holes after a failed mip copy',()=>{
 const {cards}=setup();cards.begin();for(let i=0;i<64;i++)cards.add(String(i),4,fullPaint,matrix,String(i),17);cards.finish(renderer);
 const sources=residentTextures(cards),disposed=sources.map(source=>vi.spyOn(source,'dispose'));
 cards.begin();for(const i of [0,16,32,48])cards.add(String(i),4,fullPaint,matrix,String(i),17);cards.add('new',4,fullPaint,matrix,'new',17);
 renderer.copyTextureToTexture.mockImplementation((source:THREE.Texture)=>{if(source instanceof THREE.DataArrayTexture){for(const spy of disposed)expect(spy).not.toHaveBeenCalled();throw Error('compaction failure');}});
 expect(()=>cards.finish(renderer)).toThrow('compaction failure');expect(cards.stats()).toMatchObject({pages:4,retiredGpuBytes:0,pendingRgbaBytes:0});for(const spy of disposed)expect(spy).not.toHaveBeenCalled();
 const retiringBytes=sources.slice(1).reduce((sum,texture)=>sum+storedMipBytes(texture),0);
 expect(cards.stats().peakRetiredGpuBytes).toBe(retiringBytes);
 const cache=(cards as unknown as {cards:Map<string,unknown>}).cards;
 for(const id of ['0','16','32','48','new'])expect(cache.has(`${id}:4:128`)).toBe(true);
 // These destinations may contain partially copied mip chains. Their warm
 // identities must disappear even though visible sources remain retryable.
 for(const id of ['2','3','4'])expect(cache.has(`${id}:4:128`)).toBe(false);
 renderer.copyTextureToTexture.mockImplementation((source:THREE.Texture)=>{if(source instanceof THREE.DataArrayTexture)for(const spy of disposed)expect(spy).not.toHaveBeenCalled();});
 cards.finish(renderer);expect(cards.stats()).toMatchObject({pages:1,cards:16,copiedLayers:3,rasterizations:65,mipInitializedPages:4,retiredGpuBytes:0,peakRetiredGpuBytes:retiringBytes});expect(disposed[0]).not.toHaveBeenCalled();for(const spy of disposed.slice(1))expect(spy).toHaveBeenCalledTimes(1);
 expect(cards.objects()[0]!.userData.ids).toEqual(expect.arrayContaining(['0','16','32','48','new']));cards.dispose();
});

it.each([160,ART_ACTION_SIZE])('keeps twenty recurring %ipx action poses warm without reserving unused layers',tileSize=>{
 const {cards}=setup(),painter=vi.fn(paint),size=tileSize*4;
 for(let i=0;i<60;i++){
  cards.begin();cards.add(`pose:${i%20}`,4,painter,matrix,'unit',17,tileSize);cards.finish(renderer);
 }
 const stats=cards.stats(),depths=(cards as unknown as {pages:{texture:THREE.DataArrayTexture}[]}).pages.map(page=>page.texture.image.depth);
 expect(stats).toMatchObject({pages:20,cards:20,rasterizations:20,copiedLayers:0,mipInitializedPages:20,mipLayerUpdates:20});
 // The twenty logical cards use identical test ink. The uploader can reuse
 // that scratch raster while still copying twenty complete per-layer mips.
 expect(stats).toMatchObject({scratchUploadBytes:size*size*4,scratchInitialUploadBytes:size*size*4,scratchUnchangedUploads:19,scratchPartialUploadBytes:0});expect(stats.pixels).toBeLessThanOrEqual(12*1024*1024);
 expect(depths).toEqual(new Array(20).fill(1));expect(stats.pixels).toBe(20*size*size);
 expect(painter).toHaveBeenCalledTimes(20);cards.dispose();expect(cards.stats().pixels).toBe(0);
});

it('uses a tail page without evicting current poses when their full-resolution working set exceeds the budget',()=>{
 const {cards}=setup();
 for(let frame=0;frame<3;frame++){
  cards.begin();for(let i=0;i<40;i++)cards.add(`${i}`,4,paint,matrix,`${i}`,17,ART_ACTION_SIZE);cards.finish(renderer);
 }
 expect(cards.stats()).toMatchObject({cards:40,rasterizations:40,copiedLayers:0});
 expect(cards.objects().reduce((sum,mesh)=>sum+mesh.count,0)).toBe(40);
 expect(cards.stats().pixels).toBeGreaterThan(12*1024*1024);cards.dispose();
});

it('compacts into existing inactive holes without allocating a temporary GPU page',()=>{
 const {cards}=setup();cards.begin();for(let i=0;i<64;i++)cards.add(`${i}`,4,paint,matrix,`${i}`,17);cards.finish(renderer);
 const before=cards.stats(),first=(cards.objects()[0]!.material as THREE.MeshBasicMaterial).map;
 cards.begin();for(const i of [0,16,32,48])cards.add(`${i}`,4,paint,matrix,`${i}`,17);cards.finish(renderer);
 expect(cards.stats()).toMatchObject({mipInitializedPages:4,copiedLayers:3,peakOwnedGpuBytes:before.peakOwnedGpuBytes});
 expect((cards.objects()[0]!.material as THREE.MeshBasicMaterial).map).toBe(first);
 // A retained warm card in the kept page also survives the move.
 cards.begin();cards.add('12',4,paint,matrix,'warm',17);cards.finish(renderer);expect(cards.stats().rasterizations).toBe(64);cards.dispose();
});

it.each(['paint','upload'] as const)('releases transient data and request closures after a %s failure',stage=>{
 const {cards}=setup();cards.begin();cards.add('failed',2,ctx=>{paint(ctx);if(stage==='paint')throw Error('paint failed');},matrix,'one',17);
 if(stage==='upload')renderer.copyTextureToTexture.mockImplementation(()=>{throw Error('upload failed');});
 expect(()=>cards.finish(renderer)).toThrow(`${stage} failed`);expect(cards.stats()).toMatchObject({pendingRgbaBytes:0,pendingMaskBytes:0,maskBytes:0,cards:0});expect((cards as unknown as {pending:unknown[]}).pending).toHaveLength(0);
 renderer.copyTextureToTexture.mockReset();cards.begin();cards.add('recovered',2,paint,matrix,'one',17);cards.finish(renderer);expect(cards.objects()[0]!.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);
 const canvases=[...(cards as unknown as {canvases:Map<number,HTMLCanvasElement>}).canvases.values()];cards.dispose();expect(canvases.every(canvas=>canvas.width===1&&canvas.height===1)).toBe(true);expect(cards.stats()).toMatchObject({ownedCpuBytes:0,canvasBackingBytes:0,pages:0});
});

it('recovers evicted GPU poses from exact compressed pixels without invoking their painters again',()=>{
 const {cards}=setup(),painter=vi.fn(paint);
 for(let cycle=0;cycle<2;cycle++)for(let pose=0;pose<70;pose++){
  cards.begin();cards.add(`recover:${pose}`,4,painter,matrix,'unit',17);cards.finish(renderer);
  expect(cards.objects()[0]!.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);
 }
 expect(painter).toHaveBeenCalledTimes(70);expect(cards.stats().rasterCache.hits).toBeGreaterThan(0);
 cards.dispose();expect(cards.stats().rasterCache.ownedBytes).toBe(0);expect(cards.stats().ownedCpuBytes).toBe(0);
});

it.each([128,160,ART_ACTION_SIZE])('keeps original picking texels and authored geometry when %ipx artwork starts residency at mip one',tileSize=>{
 const {cards,scene}=setup(),sourceSize=tileSize*4;
 // Exactly one original source pixel. A reduced-resolution picking mask
 // would move or lose this hit, so this checks the original alpha contract.
 cards.begin();cards.add('one-pixel',4,ctx=>{ctx.fillStyle='#a45a23';ctx.fillRect(7.25,-13.25,.25,.25);},matrix,'pixel',17,tileSize,1,1);cards.finish(renderer);scene.updateMatrixWorld(true);
 const mesh=cards.objects()[0]!,texture=(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture;
 expect(texture.image).toMatchObject({width:sourceSize/2,height:sourceSize/2,depth:1});expect(texture.generateMipmaps).toBe(false);
 const uv={x:.5+7.375/tileSize,y:.5+13.125/tileSize};
 expect(mesh.userData.paintedHit(0,uv)).toBe(true);
 expect(mesh.userData.paintedHit(0,{x:uv.x+.25/tileSize,y:uv.y})).toBe(false);
 expect(mesh.userData.paintedHit(0,{x:uv.x,y:uv.y+.25/tileSize})).toBe(false);
 expect(cards.stats().maskBytes).toBe(sourceSize*sourceSize/8);expect(cards.stats().scratchCpuBytes).toBe(sourceSize*sourceSize*4);
 const rect=mesh.geometry.getAttribute('cardRect');expect(rect.getX(0)).toBe(-tileSize/2);expect(rect.getZ(0)).toBe(tileSize/2);
 expect(rect.getY(0)).toBeCloseTo((-tileSize/2+17)/Math.tan(SHIP_CAMERA.tilt),4);
 const transfer=renderer.copyTextureToTexture.mock.calls.find(([source,destination])=>source instanceof THREE.DataTexture&&destination===texture)!;
 expect((transfer[0] as THREE.DataTexture).image.width).toBe(sourceSize);expect(transfer[4]).toBe(1);expect(transfer[5]).toBe(0);
 expect((transfer[2] as THREE.Box3).max.x).toBe(sourceSize/2);cards.dispose();
});

it('promotes one original raster transactionally and reuses its finer resident chain for subsequent coarse requests',()=>{
 const {cards}=setup(),painter=vi.fn(paint);
 cards.begin();cards.add('shared',4,painter,matrix,'small',17,128,1,1);cards.finish(renderer);
 expect(((cards.objects()[0]!.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(256);
 cards.begin();cards.add('shared',4,painter,matrix,'large',17,128,1,0);cards.finish(renderer);
 const larger=cards.objects()[0]!;expect(larger.userData.ids).toEqual(['large']);expect(((larger.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(512);
 expect(cards.stats()).toMatchObject({pages:1,cards:1,maskBytes:512*512/8,rasterizations:2,rasterCache:{entries:1,hits:1}});expect(painter).toHaveBeenCalledTimes(1);
 const cached=(cards as unknown as {cards:Map<string,{baseMip:number}>}).cards;
 expect([...cached.keys()]).toEqual(['shared:4:128']);expect(cached.get('shared:4:128')!.baseMip).toBe(0);
 cards.begin();cards.add('shared',4,painter,matrix,'small-again',17,128,1,1);cards.finish(renderer);
 expect(cards.stats()).toMatchObject({cards:1,pages:1,rasterizations:2});expect(((cards.objects()[0]!.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(512);expect(cards.objects()[0]!.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);cards.dispose();
});

it('reuses an already finer card without another GPU slot, CPU recovery, mask or upload',()=>{
 const {cards}=setup(),painter=vi.fn(paint);cards.begin();cards.add('fine',4,painter,matrix,'first',17,128,1,0);cards.finish(renderer);
 const before=cards.stats(),texture=(cards.objects()[0]!.material as THREE.MeshBasicMaterial).map;
 cards.begin();cards.add('fine',4,painter,matrix,'coarse-request',17,128,1,1);cards.finish(renderer);
 expect(cards.stats()).toMatchObject({cards:1,pages:1,rasterizations:1,maskBytes:before.maskBytes,rasterCache:{hits:0}});
 expect((cards.objects()[0]!.material as THREE.MeshBasicMaterial).map).toBe(texture);expect(painter).toHaveBeenCalledTimes(1);cards.dispose();
});

it('uploads the finest pending mip once for all instances of an uncached original raster',()=>{
 const {cards}=setup(),painter=vi.fn(paint);cards.begin();
 cards.add('same',4,painter,matrix,'coarse-first',17,128,1,1);cards.add('same',4,painter,matrix,'fine-later',17,128,1,0);cards.finish(renderer);
 expect(cards.stats()).toMatchObject({cards:1,pages:1,rasterizations:1,mipLayerUpdates:1,maskBytes:512*512/8});expect(painter).toHaveBeenCalledTimes(1);
 const mesh=cards.objects()[0]!;expect(mesh.userData.ids).toEqual(['coarse-first','fine-later']);expect(((mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(512);cards.dispose();
});

it('moves all already bound coarse instances to the promoted card while preserving binding order and transforms',()=>{
 const {cards}=setup();cards.begin();cards.add('promoted',4,paint,matrix,'seed-coarse',17,128,1,1);cards.add('other',4,paint,matrix,'seed-fine',17,128,1,0);cards.finish(renderer);
 cards.begin();
 cards.add('promoted',4,paint,new THREE.Matrix4().makeTranslation(10,0,0),'first-coarse',17,128,1,1);
 cards.add('other',4,paint,new THREE.Matrix4().makeTranslation(20,0,0),'other-fine',17,128,1,0);
 cards.add('promoted',4,paint,new THREE.Matrix4().makeTranslation(30,0,0),'second-coarse',17,128,1,1);
 cards.add('promoted',4,paint,new THREE.Matrix4().makeTranslation(40,0,0),'fine-request',17,128,1,0);cards.finish(renderer);
 expect(cards.stats()).toMatchObject({pages:2,cards:2,rasterizations:3,maskBytes:2*512*512/8});
 const mesh=cards.objects()[0]!;expect(mesh.userData.ids).toEqual(['first-coarse','other-fine','second-coarse','fine-request']);expect(mesh.count).toBe(4);
 for(let i=0;i<4;i++){const actual=new THREE.Matrix4();mesh.getMatrixAt(i,actual);expect(actual.elements[12]).toBe((i+1)*10);expect(mesh.userData.paintedHit(i,{x:.5,y:.5})).toBe(true);}
 expect(mesh.geometry.getAttribute('cardLayer').getX(0)).toBe(mesh.geometry.getAttribute('cardLayer').getX(2));expect(mesh.geometry.getAttribute('cardLayer').getX(0)).toBe(mesh.geometry.getAttribute('cardLayer').getX(3));
 expect(mesh.geometry.getAttribute('cardBank').getX(0)).toBe(mesh.geometry.getAttribute('cardBank').getX(2));expect(mesh.geometry.getAttribute('cardBank').getX(0)).toBe(mesh.geometry.getAttribute('cardBank').getX(3));expect(mesh.geometry.getAttribute('cardBank').getX(0)).not.toBe(mesh.geometry.getAttribute('cardBank').getX(1));cards.dispose();
});

it('keeps the original coarse card and mask after a failed promotion and retries before exposing a fine frame',()=>{
 const {cards}=setup();cards.begin();cards.add('same',4,paint,matrix,'seed',17,128,1,1);cards.finish(renderer);
 const cached=(cards as unknown as {cards:Map<string,{baseMip:number}>}).cards,previous=cached.get('same:4:128');
 cards.begin();cards.add('same',4,paint,matrix,'warm-coarse',17,128,1,1);cards.add('same',4,paint,matrix,'fine',17,128,1,0);
 renderer.copyTextureToTexture.mockImplementation((_source:THREE.Texture,destination:THREE.Texture)=>{if(destination instanceof THREE.DataArrayTexture&&destination.image.width===512)throw Error('promotion transfer failed');});
 expect(()=>cards.finish(renderer)).toThrow('promotion transfer failed');expect(cached.get('same:4:128')).toBe(previous);expect(previous!.baseMip).toBe(1);
 expect(cards.stats()).toMatchObject({cards:1,rasterizations:1,maskBytes:512*512/8,pendingRgbaBytes:0,pendingMaskBytes:0});
 renderer.copyTextureToTexture.mockReset();cards.begin();cards.add('same',4,paint,matrix,'warm-coarse',17,128,1,1);cards.add('same',4,paint,matrix,'fine',17,128,1,0);cards.finish(renderer);
 expect(cards.stats()).toMatchObject({cards:1,pages:1,rasterizations:2,maskBytes:512*512/8});expect(cached.get('same:4:128')!.baseMip).toBe(0);
 const mesh=cards.objects()[0]!;expect(mesh.userData.ids).toEqual(['warm-coarse','fine']);expect(((mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(512);cards.dispose();
});

it.each([0,1])('keeps full-source scratch references when unused mip pages expire and mip %i remains',keptMip=>{
 const {cards}=setup();cards.begin();
 cards.add('source512-fine',4,paint,matrix,'full',17,128,1,0);
 cards.add('source512-coarse',4,paint,matrix,'resident',17,128,1,1);
 // A native 256px source shares the 256px page with the resident 512px source.
 cards.add('source256',2,paint,matrix,'native',17,128,1,0);cards.finish(renderer);
 expect(cards.stats().scratchCpuBytes).toBe((512*512+256*256)*4);
 for(let frame=0;frame<121;frame++){
  cards.begin();cards.add(`source512-${keptMip===0?'fine':'coarse'}`,4,paint,matrix,'kept',17,128,1,keptMip);cards.finish(renderer);
 }
 const expectedSizes=keptMip===0?[512]:[512,256];
 expect(cards.stats().scratchTextures).toBe(expectedSizes.length);
 expect(cards.stats().scratchCpuBytes).toBe(expectedSizes.reduce((sum,size)=>sum+size*size*4,0));
 expect(((cards.objects()[0]!.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(512/2**keptMip);
 cards.dispose();expect(cards.stats().scratchTextures).toBe(0);
});

it('retains empty artwork in a sixteen-pixel mip-zero domain even when its request permits mip one',()=>{
 const {cards}=setup();cards.begin();cards.add('empty',4,()=>{},matrix,'empty',17,ART_ACTION_SIZE,1,1);cards.finish(renderer);
 const mesh=cards.objects()[0]!,texture=(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture;
 expect(texture.image).toMatchObject({width:16,height:16});expect(cards.stats()).toMatchObject({maskBytes:32,scratchCpuBytes:16*16*4});
 const transfer=renderer.copyTextureToTexture.mock.calls.find(([,destination])=>destination===texture)!;
 expect((transfer[0] as THREE.DataTexture).image.width).toBe(16);expect(transfer[4]).toBe(0);expect(transfer[5]).toBe(0);
 expect(mesh.userData.paintedHit(0,{x:.5,y:.5})).toBe(false);cards.dispose();
});

it.each([-1,.5,NaN,8])('rejects invalid resident mip %s before painting or allocating GPU resources',baseMip=>{
 const {cards}=setup(),painter=vi.fn(paint);cards.begin();
 expect(()=>cards.add('invalid',4,painter,matrix,'invalid',17,ART_ACTION_SIZE,1,baseMip)).toThrow('Invalid painted card resident mip');
 expect(painter).not.toHaveBeenCalled();expect(renderer.initTexture).not.toHaveBeenCalled();expect(cards.stats().pages).toBe(0);cards.dispose();
});

function fullWarmBudget(cards:PaintedCardBatches){
 for(let i=0;i<48;i++)cards.add(`budget:${i}`,4,paint,matrix,`budget:${i}`,17,128);
}

it.each([1,2])('allocates only %i needed layers for a new over-budget resident size while protecting all visible warm cards',count=>{
 const {cards}=setup();cards.begin();fullWarmBudget(cards);cards.finish(renderer);expect(cards.stats().pixels).toBe(12*1024*1024);
 cards.begin();fullWarmBudget(cards);for(let i=0;i<count;i++)cards.add(`new:${i}`,4,paint,matrix,`new:${i}`,17,176,1,1);cards.finish(renderer);
 const {texture}=binding(cards,'new:0');
 expect(texture.image).toMatchObject({width:352,height:352,depth:count});expect(cards.stats()).toMatchObject({cards:48+count,rasterizations:48+count});
 expect(cards.objects().reduce((sum,mesh)=>sum+mesh.count,0)).toBe(48+count);cards.dispose();
});

it('sizes over-budget pages by unique finest demands sharing resident bins, including different original source sizes',()=>{
 const {cards}=setup();cards.begin();fullWarmBudget(cards);cards.finish(renderer);
 cards.begin();fullWarmBudget(cards);
 for(const [key,density,tileSize,baseMip] of [['native256',2,128,0],['source512',4,128,1],['source704-a',4,176,1],['source704-b',4,176,1],['source640-a',4,160,1],['source640-b',4,160,1]] as const){
  cards.add(key,density,paint,matrix,`${key}:a`,17,tileSize,1,baseMip);cards.add(key,density,paint,matrix,`${key}:b`,17,tileSize,1,baseMip+1);
 }
 cards.finish(renderer);
 const textures=residentTextures(cards);
 for(const width of [256,320,352])expect(textures.filter(texture=>texture.image.width===width).map(texture=>texture.image.depth)).toEqual([2]);
 expect(cards.stats()).toMatchObject({cards:54,rasterizations:54,mipLayerUpdates:54});expect(cards.objects().reduce((sum,mesh)=>sum+mesh.count,0)).toBe(60);
 const native=binding(cards,'native256:a'),source=binding(cards,'source512:a');expect(native.texture).toBe(source.texture);expect(native.mesh.userData.ids.slice(native.index,native.index+4)).toEqual(['native256:a','native256:b','source512:a','source512:b']);cards.dispose();
});

it('counts duplicate pending tiers only once at their finest resident size above budget',()=>{
 const {cards}=setup();cards.begin();fullWarmBudget(cards);cards.finish(renderer);cards.begin();fullWarmBudget(cards);
 cards.add('same',4,paint,matrix,'coarse-first',17,176,1,1);cards.add('same',4,paint,matrix,'fine-later',17,176,1,0);cards.add('same',4,paint,matrix,'coarse-last',17,176,1,1);cards.finish(renderer);
 const {mesh:page,index,texture}=binding(cards,'fine-later');
 expect(texture.image).toMatchObject({width:704,height:704,depth:1});expect(page.userData.ids.slice(index-1,index+2)).toEqual(['coarse-first','fine-later','coarse-last']);expect(cards.stats()).toMatchObject({cards:49,rasterizations:49,mipLayerUpdates:49});cards.dispose();
});

it('uses one over-budget empty layer without consuming the pending native sixteen-pixel mip bin',()=>{
 const {cards}=setup();cards.begin();fullWarmBudget(cards);cards.finish(renderer);cards.begin();fullWarmBudget(cards);
 cards.add('empty704',4,()=>{},matrix,'empty',17,176,1,1);
 cards.add('native16-a',2,paint,matrix,'native-a',17,128,1,4);cards.add('native16-b',2,paint,matrix,'native-b',17,128,1,4);cards.finish(renderer);
 const empty=binding(cards,'empty'),native=binding(cards,'native-a');
 expect(empty.texture.image.depth).toBe(1);expect(native.texture.image.depth).toBe(2);expect(native.mesh.userData.ids.slice(native.index,native.index+2)).toEqual(['native-a','native-b']);
 expect(empty.mesh.userData.paintedHit(empty.index,{x:.5,y:.5})).toBe(false);expect(native.mesh.userData.paintedHit(native.index,{x:.5,y:.5})).toBe(true);cards.dispose();
});

it('batches tiny empty domains below budget without losing their instance IDs or transparent masks',()=>{
 const {cards}=setup();cards.begin();cards.add('small',4,paint,matrix,'small',17,128,1,1);cards.finish(renderer);
 expect(((cards.objects()[0]!.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.depth).toBe(1);cards.dispose();
 const empty=setup();empty.cards.begin();for(let i=0;i<32;i++)empty.cards.add(`empty:${i}`,4,()=>{},matrix,`${i}`,17,128,1,1);empty.cards.finish(renderer);
 expect(empty.cards.stats()).toMatchObject({pages:2,cards:32,pixels:32*16*16});expect(empty.cards.objects().reduce((sum,mesh)=>sum+mesh.count,0)).toBe(32);
 expect(empty.cards.objects().flatMap(mesh=>mesh.userData.ids)).toEqual(Array.from({length:32},(_,i)=>`${i}`));for(const texture of residentTextures(empty.cards))expect(texture.image).toMatchObject({width:16,height:16,depth:16});
 for(const mesh of empty.cards.objects())for(let i=0;i<mesh.count;i++)expect(mesh.userData.paintedHit(i,{x:.5,y:.5})).toBe(false);empty.cards.dispose();
});

it('keeps add order across warm and pending cards instead of raster completion or page order',()=>{
 const {cards}=setup();cards.begin();cards.add('warm512',4,paint,matrix,'seed512',17);cards.add('warm256',2,paint,matrix,'seed256',17);cards.finish(renderer);
 cards.begin();
 cards.add('new512',4,paint,new THREE.Matrix4().makeTranslation(10,0,0),'pending-first',17);
 cards.add('warm256',2,paint,new THREE.Matrix4().makeTranslation(20,0,0),'warm-second',17);
 cards.add('warm512',4,paint,new THREE.Matrix4().makeTranslation(30,0,0),'warm-third',17);
 cards.add('new704',4,paint,new THREE.Matrix4().makeTranslation(40,0,0),'pending-last',17,176);cards.finish(renderer);
 expect(cards.objects()).toHaveLength(1);const mesh=cards.objects()[0]!;
 expect(mesh.userData.ids).toEqual(['pending-first','warm-second','warm-third','pending-last']);expect(mesh.userData.orders).toEqual([0,1,2,3]);
 expect(Array.from(mesh.geometry.getAttribute('cardBank').array).slice(0,4)).toEqual([0,1,2,3]);
 for(let i=0;i<4;i++){const actual=new THREE.Matrix4();mesh.getMatrixAt(i,actual);expect(actual.elements[12]).toBe(10*(i+1));expect(mesh.userData.paintedHit(i,{x:.5,y:.5})).toBe(true);}cards.dispose();
});

it('flushes on the ninth distinct bank while allowing repeated pages on either side of a chunk boundary',()=>{
 const {cards,scene}=setup();cards.begin();
 for(let i=0;i<9;i++)cards.add(`bank:${i}`,1,paint,matrix,`seed:${i}`,17,128+8*i);cards.finish(renderer);
 const before=cards.stats();cards.begin();const sequence=[0,1,0,2,3,4,5,6,7,1,8,0,8];
 for(const [order,i] of sequence.entries())cards.add(`bank:${i}`,1,paint,matrix,`ordered:${order}`,17,128+8*i);cards.finish(renderer);
 const meshes=cards.objects();expect(meshes).toHaveLength(2);expect(meshes.map(mesh=>mesh.count)).toEqual([10,3]);
 expect(meshes.flatMap(mesh=>mesh.userData.ids)).toEqual(sequence.map((_,i)=>`ordered:${i}`));expect(meshes.map(mesh=>mesh.userData.banks.length)).toEqual([8,2]);
 expect(meshes[0]!.userData.banks[0]).toBe(meshes[1]!.userData.banks[1]);
 expect(Array.from(meshes[0]!.geometry.getAttribute('cardBank').array).slice(0,10)).toEqual([0,1,0,2,3,4,5,6,7,1]);
 expect(Array.from(meshes[1]!.geometry.getAttribute('cardBank').array).slice(0,3)).toEqual([0,1,0]);
 expect(meshes[0]!.renderOrder).toBeLessThan(meshes[1]!.renderOrder);expect(meshes[1]!.renderOrder).toBeLessThan(.001);
 expect(scene.children[0]!.children.filter(child=>child.visible)).toEqual(meshes);
 expect(cards.stats()).toMatchObject({pages:before.pages,cards:before.cards,rasterizations:before.rasterizations,drawChunks:2,maxTextureBanks:8});cards.dispose();
});

it('uses the same ordered chunk system with one bank, preserving arbitrary cross-page interleaving and nearest picking',()=>{
 const {cards,scene}=setup({maxTextureBanks:1,renderOrder:-1});cards.begin();
 for(const [order,bank] of [0,1,0,1].entries())cards.add(`bank:${bank}`,2,paint,new THREE.Matrix4().makeTranslation(0,0,order*10),`unit:${order}`,17,bank?160:128);cards.finish(renderer);scene.updateMatrixWorld(true);
 const meshes=cards.objects();expect(meshes).toHaveLength(4);expect(meshes.flatMap(mesh=>mesh.userData.ids)).toEqual(['unit:0','unit:1','unit:2','unit:3']);
 expect(meshes[0]!.userData.banks[0]).toBe(meshes[2]!.userData.banks[0]);expect(meshes[1]!.userData.banks[0]).toBe(meshes[3]!.userData.banks[0]);expect(cards.stats().pages).toBe(2);
 for(let i=0;i<meshes.length;i++){expect(meshes[i]!.renderOrder).toBeGreaterThan(-1);expect(meshes[i]!.renderOrder).toBeLessThan(-.999);if(i)expect(meshes[i]!.renderOrder).toBeGreaterThan(meshes[i-1]!.renderOrder);}
 expect(scene.children[0]!.children).toEqual(meshes);
 const hits=new THREE.Raycaster(new THREE.Vector3(0,17/Math.tan(SHIP_CAMERA.tilt),300),new THREE.Vector3(0,0,-1)).intersectObjects(meshes);
 expect(hits.map(hit=>hit.object.userData.ids[hit.instanceId!])).toEqual(['unit:3','unit:2','unit:1','unit:0']);expect(hits.map(hit=>hit.distance)).toEqual([270,280,290,300]);cards.dispose();
});

it('preserves submitted order when sparse pages compact and never binds a retired source bank',()=>{
 const {cards}=setup();cards.begin();for(let i=0;i<64;i++)cards.add(`${i}`,4,paint,matrix,`${i}`,17);cards.finish(renderer);
 const textures=residentTextures(cards),retired=textures.slice(1).map(texture=>vi.spyOn(texture,'dispose'));
 cards.begin();const sequence=[48,0,32,16,48];for(const [order,i] of sequence.entries())cards.add(`${i}`,4,paint,new THREE.Matrix4().makeTranslation(order,0,0),`${i}:${order}`,17);cards.finish(renderer);
 const mesh=cards.objects()[0]!;expect(mesh.userData.ids).toEqual(sequence.map((i,order)=>`${i}:${order}`));expect(mesh.userData.banks.map((page:{texture:THREE.DataArrayTexture})=>page.texture)).toEqual([textures[0]]);
 for(let i=0;i<sequence.length;i++){const transform=new THREE.Matrix4();mesh.getMatrixAt(i,transform);expect(transform.elements[12]).toBe(i);expect(mesh.userData.paintedHit(i,{x:.5,y:.5})).toBe(true);}
 for(const spy of retired)expect(spy).toHaveBeenCalledTimes(1);expect(cards.stats()).toMatchObject({pages:1,copiedLayers:3,rasterizations:64});cards.dispose();
});

it('reuses chunk resources and clears every compiled color and shadow bank binding while hidden',()=>{
 const {cards}=setup();cards.begin();cards.add('native',2,paint,matrix,'native',17);cards.add('action',4,paint,matrix,'action',17,160);cards.finish(renderer);
 const mesh=cards.objects()[0]!,materials=[mesh.material as THREE.MeshBasicMaterial,mesh.customDepthMaterial!,mesh.customDistanceMaterial!];
 const shaders=materials.map((material,i)=>{
  const source=[THREE.ShaderLib.basic,THREE.ShaderLib.depth,THREE.ShaderLib.distance][i]!,shader={vertexShader:source.vertexShader,fragmentShader:source.fragmentShader,uniforms:{}};
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);return shader as unknown as {uniforms:Record<string,{value:THREE.Texture|null}>};
 });
 expect(shaders.every(shader=>shader.uniforms.map!.value===binding(cards,'native').texture&&shader.uniforms.cardMap1!.value===binding(cards,'action').texture)).toBe(true);
 const versions=materials.map(material=>material.version);cards.begin();expect(cards.objects()).toHaveLength(0);
 for(const shader of shaders)for(const uniform of Object.values(shader.uniforms))expect(uniform.value).toBeNull();
 cards.add('action',4,paint,matrix,'action-first',17,160);cards.add('native',2,paint,matrix,'native-last',17);cards.finish(renderer);
 expect(cards.objects()[0]).toBe(mesh);expect(materials.map(material=>material.version)).toEqual(versions);
 expect(shaders.every(shader=>shader.uniforms.map!.value===binding(cards,'action-first').texture&&shader.uniforms.cardMap1!.value===binding(cards,'native-last').texture)).toBe(true);
 cards.dispose();for(const shader of shaders)for(const uniform of Object.values(shader.uniforms))expect(uniform.value).toBeNull();
});

it.each([0,-1,1.5,9,NaN])('rejects an invalid maximum bank count %s',maxTextureBanks=>{
 expect(()=>setup({maxTextureBanks})).toThrow('Invalid painted card bank count');
});


it('keeps every painted chunk after earlier and later native meshes at the same pass level for either bank limit',()=>{
 for(const base of [-1,0])for(const maxTextureBanks of [1,8]){
  const {cards,scene}=setup({maxTextureBanks,renderOrder:base});
  const nativeBefore=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial());nativeBefore.renderOrder=base;scene.add(nativeBefore);
  cards.begin();for(const [order,bank] of [0,1,0,1].entries())cards.add(`bank:${bank}`,2,paint,matrix,`unit:${order}`,17,bank?160:128);cards.finish(renderer);
  const nativeAfter=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial());nativeAfter.renderOrder=base;scene.add(nativeAfter);
  expect(nativeBefore.id).toBeLessThan(cards.objects()[0]!.id);expect(nativeAfter.id).toBeGreaterThan(cards.objects()[0]!.id);
  for(let frame=0;frame<2;frame++){
   if(frame){cards.begin();for(const [order,bank] of [1,0,1,0].entries())cards.add(`bank:${bank}`,2,paint,matrix,`returned:${order}`,17,bank?160:128);cards.finish(renderer);}
   const meshes=cards.objects();expect(meshes).toHaveLength(maxTextureBanks===1?4:1);
   for(const mesh of meshes){
    expect(mesh.parent!.renderOrder).toBe(0);
    expect(mesh.renderOrder).toBeGreaterThan(nativeBefore.renderOrder);expect(mesh.renderOrder).toBeGreaterThan(nativeAfter.renderOrder);
    expect(mesh.renderOrder).toBeLessThan(base+.001);expect(mesh.renderOrder).toBeLessThan(base+1);
   }
   for(let i=1;i<meshes.length;i++)expect(meshes[i]!.renderOrder).toBeGreaterThan(meshes[i-1]!.renderOrder);
  }
  cards.dispose();for(const native of [nativeBefore,nativeAfter]){scene.remove(native);native.geometry.dispose();native.material.dispose();}
 }
});


it.each([1,2,6])('allocates exactly %i unique finest layers below budget, protecting warm requests after an early miss',count=>{
 const {cards}=setup({});cards.begin();const expected:string[]=[];
 for(let i=0;i<count;i++){
  cards.add(`few:${i}`,4,paint,matrix,`coarse:${i}`,17,176,1,2);cards.add(`few:${i}`,4,paint,matrix,`fine:${i}`,17,176,1,1);expected.push(`coarse:${i}`,`fine:${i}`);
 }
 cards.finish(renderer);const first=residentTextures(cards)[0]!;
 expect(first.image).toMatchObject({width:352,height:352,depth:count});expect(cards.stats()).toMatchObject({pages:1,cards:count,pixels:352*352*count,rasterizations:count,mipLayerUpdates:count,maskBytes:count*704*704/8});
 expect(cards.objects().flatMap(mesh=>mesh.userData.ids)).toEqual(expected);
 for(const mesh of cards.objects())for(let i=0;i<mesh.count;i++)expect(mesh.userData.paintedHit(i,{x:.5,y:.5})).toBe(true);
 cards.begin();cards.add('early-miss',4,paint,matrix,'early',17,176,1,1);
 for(let i=0;i<count;i++)cards.add(`few:${i}`,4,paint,matrix,`warm:${i}`,17,176,1,1);cards.finish(renderer);
 expect(residentTextures(cards)).toHaveLength(2);expect(residentTextures(cards)[0]).toBe(first);expect(residentTextures(cards).map(texture=>texture.image.depth)).toEqual([count,1]);
 expect(cards.stats()).toMatchObject({cards:count+1,rasterizations:count+1,copiedLayers:0,pixels:352*352*(count+1)});
 expect(cards.objects().flatMap(mesh=>mesh.userData.ids)).toEqual(['early',...Array.from({length:count},(_,i)=>`warm:${i}`)]);
 expect(cards.stats().pixels).toBeLessThan(12*1024*1024);cards.dispose();
});
