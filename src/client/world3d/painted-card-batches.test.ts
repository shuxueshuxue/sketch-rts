import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import * as THREE from 'three';
import {PaintedCardBatches,patchCardShader} from './painted-card-batches';
import {SHIP_CAMERA} from '../../shared/ship-geometry';
afterEach(()=>vi.unstubAllGlobals());
function setup(){
  vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});
  const scene=new THREE.Scene(),cards=new PaintedCardBatches(scene,8);return{scene,cards};
}
const matrix=new THREE.Matrix4();
const paint=(ctx:CanvasRenderingContext2D)=>{ctx.fillStyle='#ff0000';ctx.fillRect(-16,-24,32,48);};
describe('painted card array batches',()=>{
  it('shares full-resolution color/facing/pose layers with separate instance IDs and feet',()=>{
    const {cards}=setup();cards.begin();
    for(let i=0;i<16;i++)cards.add(`pose:${i}`,4,paint,matrix,`unit:${i}`,i);
    cards.finish();const [mesh]=cards.objects();expect(cards.objects()).toHaveLength(1);expect(mesh!.count).toBe(16);
    expect(cards.stats()).toMatchObject({pages:1,cards:16,rasterizations:16,pixels:512*512*16});
    const texture=(mesh!.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture;
    expect(texture.image).toMatchObject({width:512,height:512,depth:16});expect(texture.generateMipmaps).toBe(true);expect(texture.anisotropy).toBe(8);
    expect(mesh!.customDepthMaterial!.alphaTest).toBe(.4);expect(mesh!.customDistanceMaterial!.alphaTest).toBe(.4);
    const transform=new THREE.Matrix4();mesh!.getMatrixAt(12,transform);expect(transform.elements[13]).toBeCloseTo((12-17)/Math.tan(SHIP_CAMERA.tilt),5);
    expect(mesh!.userData.ids[12]).toBe('unit:12');expect(mesh!.geometry.getAttribute('cardLayer').getX(12)).toBe(12);cards.dispose();
  });
  it('uses the exact layer RGBA for alpha picking without an extra mask allocation',()=>{
    const {cards,scene}=setup();cards.begin();cards.add('visible',2,paint,matrix,'first',17);cards.add('empty',2,()=>{},matrix,'second',17);cards.finish();scene.updateMatrixWorld(true);
    const mesh=cards.objects()[0]!;
    expect(mesh.userData.paintedHit(0,{x:.5,y:.5})).toBe(true);expect(mesh.userData.paintedHit(1,{x:.5,y:.5})).toBe(false);
    expect(mesh.userData.paintedHit(0,{x:0,y:0})).toBe(false);
    const hits=new THREE.Raycaster(new THREE.Vector3(0,17/Math.tan(SHIP_CAMERA.tilt),300),new THREE.Vector3(0,0,-1)).intersectObject(mesh);
    expect(hits.length).toBeGreaterThan(0);expect(hits[0]!.uv!.y).toBeCloseTo(.5);cards.dispose();
  });
  it('does not rerasterize a warm card and releases page textures, geometry and shadow materials',()=>{
    const {cards,scene}=setup(),painter=vi.fn(paint);cards.begin();cards.add('pose',4,painter,matrix,'one',17);cards.finish();
    const mesh=cards.objects()[0]!,material=mesh.material as THREE.MeshBasicMaterial;
    const releases=[material,material.map!,mesh.geometry,mesh.customDepthMaterial!,mesh.customDistanceMaterial!,mesh].map(resource=>vi.spyOn(resource,'dispose'));
    cards.begin();cards.add('pose',4,painter,matrix,'two',17);cards.finish();expect(painter).toHaveBeenCalledTimes(1);
    for(let i=0;i<121;i++){cards.begin();cards.finish();}
    expect(cards.stats()).toMatchObject({pages:0,cards:0,cpuBytes:0});expect(scene.children).toHaveLength(0);for(const release of releases)expect(release).toHaveBeenCalledTimes(1);cards.dispose();
  });
  it('protects later visible warm cards from an early cache miss at the soft budget',()=>{
    const {cards}=setup(),painter=vi.fn(paint);cards.begin();
    for(let i=0;i<48;i++)cards.add(`warm:${i}`,4,painter,matrix,`${i}`,17);cards.finish();
    expect(cards.stats().pixels).toBe(12*1024*1024);
    cards.begin();cards.add('new',4,painter,matrix,'new',17);
    for(let i=0;i<48;i++)cards.add(`warm:${i}`,4,painter,matrix,`${i}`,17);cards.finish();
    expect(painter).toHaveBeenCalledTimes(49);expect(cards.objects().reduce((n,mesh)=>n+mesh.count,0)).toBe(49);cards.dispose();
  });
  it('compacts surviving poses across sparse pages without rerasterizing or changing picking',()=>{
    const {cards}=setup(),painter=vi.fn(paint);cards.begin();
    for(let i=0;i<64;i++)cards.add(`${i}`,4,painter,matrix,`${i}`,17);cards.finish();
    expect(cards.stats().pages).toBe(4);
    cards.begin();for(const i of [0,16,32,48])cards.add(`${i}`,4,painter,matrix,`${i}`,17);cards.finish();
    expect(cards.stats()).toMatchObject({pages:1,cards:4,copiedLayers:4,rasterizations:64});expect(painter).toHaveBeenCalledTimes(64);
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
    const {cards}=setup();cards.begin();for(let i=0;i<50;i++)cards.add(`${i}`,4,paint,matrix,`${i}`,17);cards.finish();
    expect(cards.objects().reduce((n,mesh)=>n+mesh.count,0)).toBe(50);expect(cards.stats().cards).toBe(50);
    cards.begin();cards.add('49',4,paint,matrix,'49',17);cards.finish();expect(cards.stats().pixels).toBeLessThanOrEqual(12*1024*1024);cards.dispose();
  });
});
