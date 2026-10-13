
import * as THREE from 'three';
const paths=["/tmp/sketch-stall-baseline-8345/src/client/world3d/card-mip-residency.ts","/tmp/sketch-card-mip-half-camera-FYdNLV/card-mip-full-reference.ts","/tmp/card-mip-half-margin-candidate.ts"];
const modules=await Promise.all(paths.map(path=>import(/* @vite-ignore */ '/@fs'+path)));
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const probe={sourceSize:512,tileSize:128,foot:17,matrix:new THREE.Matrix4(),passes:[{camera:new THREE.OrthographicCamera(-512,512,288,-288,1,12000),physicalWidth:1280,physicalHeight:720}]};
const reports=[];
for(let i=0;i<modules.length;i++){
 const module=modules[i];if(typeof module.cardBaseMip!=='function'||typeof module.cardMipFootprint!=='function')throw new Error('Complete gate exports missing');
 const baseSource=module.cardBaseMip.toString(),footprintSource=module.cardMipFootprint.toString();
 reports.push({path:paths[i],baseSource,baseSha256:await sha(baseSource),footprintSource,footprintSha256:await sha(footprintSource),probeBase:module.cardBaseMip(probe),probeFootprint:module.cardMipFootprint(probe)});
}
if(reports[1].probeBase!==0)throw new Error('Full-reference module did not return mip zero');
if(reports.some(row=>row.footprintSha256!==reports[0].footprintSha256))throw new Error('Gate footprint function changed');
window.mipHalfGateReview={ready:true,mode:"candidate",selectedPath:"/tmp/card-mip-half-margin-candidate.ts",threeRevision:THREE.REVISION,providers:reports,balancedCompleteProvidersLoadedBeforeInit:true,perFrameOverrides:false};
