import * as prototype from '/prototype.mjs';
import {runMaskMatrix} from '/matrix.mjs';

const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
const fetchExact=async(path,expected)=>{
 const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error(`HTTP ${response.status} ${path}`);
 const bytes=await response.arrayBuffer(),actual=await hash(bytes);if(actual!==expected)throw Error(`SHA mismatch ${path}: ${actual} != ${expected}`);return bytes;
};
const config=await(await fetch('/config.json',{cache:'no-store'})).json();
if(!isSecureContext||!crypto.subtle)throw Error('Local secure context and WebCrypto are required');
for(const [path,sha] of Object.entries(config.servedSha256))await fetchExact(path,sha);
const manifestBytes=await fetchExact('/corpus-manifest.json',config.corpusSha256),manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
if(manifest.images.length!==config.images.length)throw Error('Manifest row count mismatch');
const images=[];
for(const [index,row] of manifest.images.entries()){
 const expected=config.images[index];
 if(row.sha256!==expected.sha256||row.width!==expected.width||row.height!==expected.height||row.file!==expected.file)throw Error('Manifest row differs from frozen driver inputs');
 const bytes=await fetchExact(`/rgba/${index}.bin`,row.sha256);
 if(bytes.byteLength!==row.width*row.height*4)throw Error('Invalid full RGBA length '+row.file);
 images.push({...row,name:row.name??row.file,rgba:new Uint8ClampedArray(bytes)});
}
window.cardMaskMicro={
 ready:true,
 provenance:{corpusSha256:config.corpusSha256,servedSha256:config.servedSha256,assetSha256:images.map(image=>image.sha256),
  secureContext:isSecureContext,crossOriginIsolated,devicePixelRatio,userAgent:navigator.userAgent,
  noContextsRequested:window.__maskForbiddenContexts.length===0,
  fullOriginalRowOrientation:'top-down; both flipY parameters are checked and timed on the same original source, not a claimed row-flipped cache-recovery buffer'},
 async run(){
  const result=await runMaskMatrix(prototype,images,config.options);
  // Check all RGBA again after timing. Transparent RGB remains part of SHA.
  for(const image of images)if(await hash(image.rgba)!==image.sha256)throw Error('Source RGBA mutated '+image.name);
  if(window.__maskForbiddenContexts.length)throw Error('A forbidden Canvas/WebGL context was requested');
  return{...result,provenance:this.provenance,forbiddenContexts:window.__maskForbiddenContexts};
 },
};
