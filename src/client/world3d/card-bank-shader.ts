import * as THREE from 'three';

export const MAX_CARD_BANKS=8;
type CardShader={vertexShader:string;fragmentShader:string};
export type CardBankMaterial=THREE.MeshBasicMaterial|THREE.MeshDepthMaterial|THREE.MeshDistanceMaterial;

function validateBankCount(banksCount:number){
 if(!Number.isInteger(banksCount)||banksCount<1||banksCount>MAX_CARD_BANKS)throw new Error('Invalid painted card bank count.');
}

/** Array pages remain separate textures; bank/layer select each instance's
 * original samples while a draw can retain the world instance order. */
export function patchCardBankShader(shader:CardShader,banksCount=1){
 validateBankCount(banksCount);
 if(!shader.vertexShader.includes('#include <begin_vertex>')||!shader.vertexShader.includes('#include <uv_vertex>')||!shader.fragmentShader.includes('#include <map_pars_fragment>')||!shader.fragmentShader.includes('#include <map_fragment>'))throw new Error('Unsupported painted card shader chunks.');
 shader.vertexShader='attribute float cardLayer;\nattribute vec4 cardRect;\nattribute vec4 cardUv;\nattribute float cardBank;\nvarying float vCardLayer;\nflat varying float cardBankIndex;\n'+shader.vertexShader;
 // A card samples its cell of the layer: (0,0,1,1) for a card that fills it (see @@@card-atlas).
 shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvMapUv = cardUv.xy + vMapUv * cardUv.zw;');
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCardLayer = cardLayer;\ncardBankIndex = cardBank;\ntransformed.xy = mix(cardRect.xy, cardRect.zw, uv);');
 shader.fragmentShader='precision highp sampler2DArray;\nvarying float vCardLayer;\nflat varying float cardBankIndex;\n'+shader.fragmentShader;
 const samplerNames=Array.from({length:banksCount},(_,bank)=>bank===0?'map':`cardMap${bank}`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>',samplerNames.map(name=>`uniform highp sampler2DArray ${name};`).join('\n'));
 if(banksCount===1){
  // One-bank specialization keeps the original implicit sampling expression.
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');
 }else{
  // A bank is constant within a primitive, but adjacent fragments can select
  // different primitives. Calculate derivatives before bank control flow so
  // mip/anisotropic filtering never depends on undefined implicit gradients.
  const branches=samplerNames.map((name,bank)=>`${bank===0?'if':bank===banksCount-1?'else':'else if'}${bank===banksCount-1?'':` (cardBankIndex < ${bank+.5})`} { cardSample = textureGrad(${name}, vec3(vMapUv, vCardLayer), cardUvDx, cardUvDy); }`).join('\n');
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec2 cardUvDx = dFdx(vMapUv);\nvec2 cardUvDy = dFdy(vMapUv);\nvec4 cardSample;\n${branches}\ndiffuseColor *= cardSample;`);
 }
}

/** Configure only public Three material hooks. The caller owns bank textures
 * and supplies a stable bank array for the lifetime of this material binding.
 * Array entries may change each frame. The caller updates material.map to bank
 * zero and invokes the returned refresh function before rendering or hiding a
 * chunk; this also releases the last map reference from compiled shader state. */
export function configureCardMaterial(material:CardBankMaterial,banks:readonly THREE.DataArrayTexture[],maxBanks:number,opacity=false){
 validateBankCount(maxBanks);
 if(banks.length<1||banks.length>maxBanks||Array.from(banks).some(texture=>!texture?.isDataArrayTexture))throw new Error('Invalid painted card bank textures.');
 // Extra banks are read when Three uploads uniforms, including shadow draws
 // that bypass material.onBeforeRender. These same objects work for every
 // compiled program variant. Bank zero stays writable for engine map refresh.
 const bindings:THREE.IUniform<THREE.DataArrayTexture|null>[]=Array.from({length:maxBanks},(_,bank)=>bank===0?{value:banks[0]!}:{get value(){return banks[bank]??banks[banks.length-1]??null;}});
 material.map=banks[0]!;
 material.onBeforeCompile=shader=>{
  patchCardBankShader(shader,maxBanks);
  for(let bank=0;bank<maxBanks;bank++)shader.uniforms[bank===0?'map':`cardMap${bank}`]=bindings[bank]!;
  if(opacity){
   shader.vertexShader='attribute float cardOpacity;\nvarying float vCardOpacity;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('vCardLayer = cardLayer;','vCardLayer = cardLayer;\nvCardOpacity = cardOpacity;');
   shader.fragmentShader='varying float vCardOpacity;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','diffuseColor.a *= vCardOpacity;\n#include <alphatest_fragment>');
  }
 };
 material.customProgramCacheKey=()=>`painted-card-banks-v2:${maxBanks}:${opacity}`;
 material.needsUpdate=true;
 return()=>{bindings[0]!.value=material.map as THREE.DataArrayTexture|null;};
}
