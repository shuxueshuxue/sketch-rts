import { ART_TILE_SIZE, ART_ACTION_SIZE } from '../art/raster-cache';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import * as THREE from 'three';
import {PaintedCardBatches,patchCardShader} from './painted-card-batches';
import {SHIP_CAMERA} from '../../shared/ship-geometry';
const renderer={initTexture:vi.fn(),copyTextureToTexture:vi.fn(),getRenderTarget:()=>null,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:vi.fn()};
afterEach(()=>{vi.unstubAllGlobals();renderer.initTexture.mockReset();renderer.copyTextureToTexture.mockReset();renderer.setRenderTarget.mockReset();});
function setup(){
  vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});
  const scene=new THREE.Scene(),cards=new PaintedCardBatches(scene,8);return{scene,cards};
}
const matrix=new THREE.Matrix4();
const paint=(ctx:CanvasRenderingContext2D)=>{ctx.fillStyle='#ff0000';ctx.fillRect(-16,-24,32,48);};
const fullPaint=(ctx:CanvasRenderingContext2D)=>{ctx.fillStyle='#ff0000';ctx.fillRect(-62,-62,124,124);};
describe('painted card array batches',()=>{
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
    const empty=cards.objects().find(item=>item.userData.ids.includes('second'))!;expect(empty.userData.paintedHit(0,{x:.5,y:.5})).toBe(false);
    expect(mesh.userData.paintedHit(0,{x:0,y:0})).toBe(false);
    const hits=new THREE.Raycaster(new THREE.Vector3(0,17/Math.tan(SHIP_CAMERA.tilt),300),new THREE.Vector3(0,0,-1)).intersectObject(mesh);
    expect(hits.length).toBeGreaterThan(0);expect(hits[0]!.uv!.y).toBeCloseTo(.5);cards.dispose();
  });
  it('does not rerasterize a warm card and releases page textures, geometry and shadow materials',()=>{
    const {cards,scene}=setup(),painter=vi.fn(paint);cards.begin();cards.add('pose',4,painter,matrix,'one',17);cards.finish(renderer);
    const mesh=cards.objects()[0]!,material=mesh.material as THREE.MeshBasicMaterial;
    const releases=[material,material.map!,mesh.geometry,mesh.customDepthMaterial!,mesh.customDistanceMaterial!,mesh].map(resource=>vi.spyOn(resource,'dispose'));
    cards.begin();cards.add('pose',4,painter,matrix,'two',17);cards.finish(renderer);expect(painter).toHaveBeenCalledTimes(1);
    for(let i=0;i<121;i++){cards.begin();cards.finish(renderer);}
    expect(cards.stats()).toMatchObject({pages:0,cards:0,maskBytes:0,arrayCpuBytes:0,pendingRgbaBytes:0});expect(scene.children).toHaveLength(0);for(const release of releases)expect(release).toHaveBeenCalledTimes(1);cards.dispose();
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
   const texture=(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture,{width,height}=texture.image;
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
 expect(material).toMatchObject({transparent:true,depthTest:true,depthWrite:false,alphaTest:.01});expect(mesh.castShadow).toBe(false);expect(mesh.renderOrder).toBe(-1);
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

it('keeps visible compaction sources alive and invalidates overwritten warm holes after a failed mip copy',()=>{
 const {cards}=setup();cards.begin();for(let i=0;i<64;i++)cards.add(String(i),4,fullPaint,matrix,String(i),17);cards.finish(renderer);
 const sources=cards.objects().map(mesh=>(mesh.material as THREE.MeshBasicMaterial).map!),disposed=sources.map(source=>vi.spyOn(source,'dispose'));
 cards.begin();for(const i of [0,16,32,48])cards.add(String(i),4,fullPaint,matrix,String(i),17);cards.add('new',4,fullPaint,matrix,'new',17);
 renderer.copyTextureToTexture.mockImplementation((source:THREE.Texture)=>{if(source instanceof THREE.DataArrayTexture){for(const spy of disposed)expect(spy).not.toHaveBeenCalled();throw Error('compaction failure');}});
 expect(()=>cards.finish(renderer)).toThrow('compaction failure');expect(cards.stats()).toMatchObject({pages:4,retiredGpuBytes:0,pendingRgbaBytes:0});for(const spy of disposed)expect(spy).not.toHaveBeenCalled();
 const cache=(cards as unknown as {cards:Map<string,unknown>}).cards;
 for(const id of ['0','16','32','48','new'])expect(cache.has(`${id}:4:128:mip:0`)).toBe(true);
 // These destinations may contain partially copied mip chains. Their warm
 // identities must disappear even though visible sources remain retryable.
 for(const id of ['2','3','4'])expect(cache.has(`${id}:4:128:mip:0`)).toBe(false);
 renderer.copyTextureToTexture.mockImplementation((source:THREE.Texture)=>{if(source instanceof THREE.DataArrayTexture)for(const spy of disposed)expect(spy).not.toHaveBeenCalled();});
 cards.finish(renderer);expect(cards.stats()).toMatchObject({pages:1,cards:16,copiedLayers:3,rasterizations:65,mipInitializedPages:4});expect(disposed[0]).not.toHaveBeenCalled();for(const spy of disposed.slice(1))expect(spy).toHaveBeenCalledTimes(1);
 expect(cards.objects()[0]!.userData.ids).toEqual(expect.arrayContaining(['0','16','32','48','new']));cards.dispose();
});

it.each([160,ART_ACTION_SIZE])('keeps twenty recurring %ipx action poses warm within the unchanged allocated-pixel budget',tileSize=>{
 const {cards}=setup(),painter=vi.fn(paint),size=tileSize*4;
 for(let i=0;i<60;i++){
  cards.begin();cards.add(`pose:${i%20}`,4,painter,matrix,'unit',17,tileSize);cards.finish(renderer);
 }
 const stats=cards.stats(),depths=(cards as unknown as {pages:{texture:THREE.DataArrayTexture}[]}).pages.map(page=>page.texture.image.depth);
 expect(stats).toMatchObject({pages:2,cards:20,rasterizations:20,copiedLayers:0,mipInitializedPages:2,mipLayerUpdates:20});
 // The twenty logical cards use identical test ink. The uploader can reuse
 // that scratch raster while still copying twenty complete per-layer mips.
 expect(stats).toMatchObject({scratchUploadBytes:size*size*4,scratchInitialUploadBytes:size*size*4,scratchUnchangedUploads:19,scratchPartialUploadBytes:0});expect(stats.pixels).toBeLessThanOrEqual(12*1024*1024);
 expect(depths).toEqual([16,Math.floor((12*1024*1024-size*size*16)/(size*size))]);
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
 expect(texture.image).toMatchObject({width:sourceSize/2,height:sourceSize/2,depth:16});expect(texture.generateMipmaps).toBe(false);
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

it('isolates GPU residency identities while reusing one full-resolution CPU raster and promoting before draw',()=>{
 const {cards}=setup(),painter=vi.fn(paint);
 cards.begin();cards.add('shared',4,painter,matrix,'small',17,128,1,1);cards.finish(renderer);
 expect(((cards.objects()[0]!.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(256);
 cards.begin();cards.add('shared',4,painter,matrix,'large',17,128,1,0);cards.finish(renderer);
 const larger=cards.objects()[0]!;expect(larger.userData.ids).toEqual(['large']);expect(((larger.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture).image.width).toBe(512);
 expect(cards.stats()).toMatchObject({cards:2,rasterizations:2,rasterCache:{entries:1,hits:1}});expect(painter).toHaveBeenCalledTimes(1);
 const cached=(cards as unknown as {cards:Map<string,unknown>}).cards;
 expect([...cached.keys()].sort()).toEqual(['shared:4:128:mip:0','shared:4:128:mip:1']);
 cards.begin();cards.add('shared',4,painter,matrix,'small-again',17,128,1,1);cards.finish(renderer);
 expect(cards.stats().rasterizations).toBe(2);expect(cards.objects()[0]!.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);cards.dispose();
});

it.each([0,1])('keeps full-source scratch references when unused mip pages expire and mip %i remains',keptMip=>{
 const {cards}=setup();cards.begin();
 cards.add('source512',4,paint,matrix,'full',17,128,1,0);
 cards.add('source512',4,paint,matrix,'resident',17,128,1,1);
 // A native 256px source shares the 256px page with the resident 512px source.
 cards.add('source256',2,paint,matrix,'native',17,128,1,0);cards.finish(renderer);
 expect(cards.stats().scratchCpuBytes).toBe((512*512+256*256)*4);
 for(let frame=0;frame<121;frame++){
  cards.begin();cards.add('source512',4,paint,matrix,'kept',17,128,1,keptMip);cards.finish(renderer);
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
