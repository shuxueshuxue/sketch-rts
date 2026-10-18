import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {patchCardBankShader,configureCardMaterial,MAX_CARD_BANKS,type CardBankMaterial} from './card-bank-shader';

const sources=[THREE.ShaderLib.basic,THREE.ShaderLib.depth,THREE.ShaderLib.distance];
function shader(source=sources[0]!){return{vertexShader:source.vertexShader,fragmentShader:source.fragmentShader,uniforms:THREE.UniformsUtils.clone(source.uniforms)};}
function bank(size=16){return new THREE.DataArrayTexture(null,size,size,3);}
function compiled(material:CardBankMaterial,source=sources[0]!){const program=shader(source);material.onBeforeCompile(program as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);return program;}

describe('ordered card bank material sampling',()=>{
 it('specializes one bank to the original implicit texture lookup in every pass',()=>{
  for(const source of sources){const s=shader(source);patchCardBankShader(s);
   expect(s.vertexShader).toContain('attribute float cardBank;');expect(s.vertexShader).toContain('flat varying float cardBankIndex;');expect(s.vertexShader).toContain('cardBankIndex = cardBank;');expect(s.vertexShader).toContain('transformed.xy = mix(cardRect.xy, cardRect.zw, uv);');
   expect(s.fragmentShader).toContain('diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');expect(s.fragmentShader).not.toContain('textureGrad');expect(s.fragmentShader).not.toContain('cardMap1');expect(s.fragmentShader).toContain('#include <alphatest_fragment>');
  }
 });
 it.each([2,4,8])('calculates common gradients before every one of %i bank branches',count=>{
  for(const source of sources){const s=shader(source);patchCardBankShader(s,count);
   expect(s.fragmentShader.match(/uniform highp sampler2DArray/g)).toHaveLength(count);expect(s.fragmentShader.match(/textureGrad\(/g)).toHaveLength(count);
   const firstBranch=s.fragmentShader.indexOf('if (cardBankIndex');expect(s.fragmentShader.indexOf('dFdx(vMapUv)')).toBeLessThan(firstBranch);expect(s.fragmentShader.indexOf('dFdy(vMapUv)')).toBeLessThan(firstBranch);
   expect(s.fragmentShader).toContain(`textureGrad(cardMap${count-1}, vec3(vMapUv, vCardLayer), cardUvDx, cardUvDy)`);expect(s.fragmentShader).not.toContain('texture(map');expect(s.fragmentShader).not.toContain('#include <map_fragment>');expect(s.fragmentShader).toContain('diffuseColor *= cardSample;');
   expect(s.fragmentShader).toContain('#include <alphatest_fragment>');expect(s.fragmentShader).toContain('#include <alphamap_fragment>');
  }
 });
 it('changes only the shared cutout sampling and vertex rectangle across color and shadow shaders',()=>{
  for(const source of sources){const s=shader(source);patchCardBankShader(s,8);
   for(const marker of ['#include <morphtarget_vertex>','#include <skinning_vertex>','#include <project_vertex>','#include <clipping_planes_vertex>'])expect(s.vertexShader).toContain(marker);
   for(const marker of ['#include <alphatest_fragment>','#include <alphahash_fragment>','#include <clipping_planes_fragment>'])expect(s.fragmentShader).toContain(marker);
   const mapStart=s.fragmentShader.indexOf('vec2 cardUvDx'),alphaStart=s.fragmentShader.indexOf('#include <alphatest_fragment>');expect(mapStart).toBeLessThan(alphaStart);
   // Everything following alpha test (color conversion or native depth packing)
   // remains exactly the engine's original shader tail.
   expect(s.fragmentShader.slice(alphaStart)).toBe(source.fragmentShader.slice(source.fragmentShader.indexOf('#include <alphatest_fragment>')));
  }
 });
 it('binds real texture objects and bounded fallback slots through public material hooks',()=>{
  const banks=[bank(256),bank(352)];
  for(const [index,material] of [new THREE.MeshBasicMaterial({alphaTest:.4,toneMapped:false}),new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,alphaTest:.4}),new THREE.MeshDistanceMaterial({alphaTest:.4})].entries()){
   const before={alphaTest:material.alphaTest,transparent:material.transparent,depthTest:material.depthTest,depthWrite:material.depthWrite};configureCardMaterial(material,banks,8);expect(material.map).toBe(banks[0]);
   const s=compiled(material,sources[index]!);expect(s.uniforms.map!.value).toBe(banks[0]);expect(s.uniforms.cardMap1!.value).toBe(banks[1]);for(let slot=2;slot<8;slot++)expect(s.uniforms[`cardMap${slot}`]!.value).toBe(banks[1]);
   expect(material.customProgramCacheKey()).toBe('painted-card-banks-v2:8:false');expect({alphaTest:material.alphaTest,transparent:material.transparent,depthTest:material.depthTest,depthWrite:material.depthWrite}).toEqual(before);
   material.dispose();
  }
  for(const texture of banks)texture.dispose();
 });
 it('applies per-instance opacity before the same alpha cutoff in all three passes',()=>{
  const texture=bank();for(const [index,material] of [new THREE.MeshBasicMaterial(),new THREE.MeshDepthMaterial(),new THREE.MeshDistanceMaterial()].entries()){
   configureCardMaterial(material,[texture],2,true);const s=compiled(material,sources[index]!);expect(s.vertexShader).toContain('vCardOpacity = cardOpacity;');expect(s.fragmentShader).toContain('diffuseColor.a *= vCardOpacity;\n#include <alphatest_fragment>');expect(material.customProgramCacheKey()).toBe('painted-card-banks-v2:2:true');material.dispose();
  }texture.dispose();
 });
 it('reads changed bank arrays in every program variant without recompiling or relying on color draw hooks',()=>{
  const first=bank(256),second=bank(352),third=bank(128),banks=[first,second],material=new THREE.MeshDepthMaterial(),refresh=configureCardMaterial(material,banks,4);
  const a=compiled(material,THREE.ShaderLib.depth),b=compiled(material,THREE.ShaderLib.distance),version=material.version,key=material.customProgramCacheKey();
  expect(a.uniforms.cardMap1).toBe(b.uniforms.cardMap1);expect(a.uniforms.map).toBe(b.uniforms.map);
  banks[0]=third;banks[1]=first;material.map=third;
  // Emulate the public engine uniform refresh for bank zero. Extra bank
  // getters already reflect the new frame without any onBeforeRender call.
  refresh();a.uniforms.map!.value=material.map;
  expect(b.uniforms.map!.value).toBe(third);for(const s of [a,b])for(const slot of [1,2,3])expect(s.uniforms[`cardMap${slot}`]!.value).toBe(first);
  banks.length=1;for(const s of [a,b])for(const slot of [1,2,3])expect(s.uniforms[`cardMap${slot}`]!.value).toBe(third);
  material.map=null;banks.length=0;refresh();for(const s of [a,b]){expect(s.uniforms.map!.value).toBeNull();for(const slot of [1,2,3])expect(s.uniforms[`cardMap${slot}`]!.value).toBeNull();}
  expect(material.version).toBe(version);expect(material.customProgramCacheKey()).toBe(key);
  material.dispose();first.dispose();second.dispose();third.dispose();
 });
 it('separates program identities by sampler and opacity specialization',()=>{
  const texture=bank(),keys=new Set<string>();for(const count of [1,2,8])for(const opacity of [false,true]){const material=new THREE.MeshBasicMaterial();configureCardMaterial(material,[texture],count,opacity);keys.add(material.customProgramCacheKey());material.dispose();}expect(keys.size).toBe(6);texture.dispose();
 });
 it('validates counts and required chunks before changing shader or material state',()=>{
  expect(MAX_CARD_BANKS).toBe(8);for(const count of [0,-1,1.5,9,Infinity,NaN]){const s=shader(),before={...s};expect(()=>patchCardBankShader(s,count)).toThrow('bank count');expect(s).toEqual(before);}
  const s=shader();s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','');const before={...s};expect(()=>patchCardBankShader(s,2)).toThrow('shader chunks');expect(s).toEqual(before);
  const material=new THREE.MeshBasicMaterial(),original=material.onBeforeCompile,texture=bank();expect(()=>configureCardMaterial(material,[],2)).toThrow('bank textures');expect(()=>configureCardMaterial(material,[texture,texture],1)).toThrow('bank textures');expect(material.map).toBeNull();expect(material.onBeforeCompile).toBe(original);texture.dispose();material.dispose();
 });
});
