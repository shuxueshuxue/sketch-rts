/** Exact source-pinned same-scene comparison; no renderer or simulation override. */
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {setImmediate as yieldImmediate} from 'node:timers/promises';

const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const beforePath=resolve(arg('--before')),afterPath=resolve(arg('--after')),out=resolve(arg('--out'));
const beforeBytes=await readFile(beforePath),afterBytes=await readFile(afterPath);
const before=JSON.parse(beforeBytes),after=JSON.parse(afterBytes),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
assert(before.passed&&after.passed,'Both actual hiring proofs must independently pass');
assert(before.source.fixtureSha256===after.source.fixtureSha256,'Original fixture changed');
assert(before.source.harnessSha256===after.source.harnessSha256,'Original capture harness changed');
assert(before.framePngSha256.length===40&&after.framePngSha256.length===40,'Expected original forty captures');
const facts=['sales','hireSnapshotSha256','snapshotHashes','commands','releases','samples','picks','actualDeaths','seen','healSeen','attacks','drawMutations','fps'];
const factComparisons=facts.map(field=>({field,beforeSha256:digest(JSON.stringify(before[field])),afterSha256:digest(JSON.stringify(after[field])),identical:JSON.stringify(before[field])===JSON.stringify(after[field])}));
const rulesTreesIdentical=JSON.stringify(before.source.rulesTrees)===JSON.stringify(after.source.rulesTrees);
const artFiles=Object.keys(before.source.clientSha256).filter(file=>file.startsWith('src/client/art/')&&file.endsWith('.ts')&&!file.endsWith('.test.ts'));
const art=artFiles.map(file=>({file,beforeSha256:before.source.clientSha256[file],afterSha256:after.source.clientSha256[file],identical:before.source.clientSha256[file]===after.source.clientSha256[file]}));
const canvas=createCanvas(1440,1000),ctx=canvas.getContext('2d');
async function rgba(bytes){const image=await loadImage(bytes);assert(image.width===1440&&image.height===1000,'Capture dimensions changed');ctx.clearRect(0,0,1440,1000);ctx.drawImage(image,0,0);return ctx.getImageData(0,0,1440,1000).data;}
const images=[];
for(let index=0;index<40;index++){
 const name=`frame-${String(index).padStart(3,'0')}.png`,leftBytes=await readFile(resolve(dirname(beforePath),name)),rightBytes=await readFile(resolve(dirname(afterPath),name));
 assert(digest(leftBytes)===before.framePngSha256[index],`Original evidence hash mismatch: ${name}`);
 assert(digest(rightBytes)===after.framePngSha256[index],`Final evidence hash mismatch: ${name}`);
 const left=await rgba(leftBytes),right=await rgba(rightBytes);let changedChannels=0,changedPixels=0,maxDifference=0;
 for(let pixel=0;pixel<left.length;pixel+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(left[pixel+c]-right[pixel+c]);if(delta){changedChannels++;changed=true;maxDifference=Math.max(maxDifference,delta);}}if(changed)changedPixels++;}
 images.push({index,name,comparedPixels:1440*1000,pngIdentical:leftBytes.equals(rightBytes),rgbaSha256Before:digest(left),rgbaSha256After:digest(right),changedChannels,changedPixels,maxDifference});
 await yieldImmediate();
}
function directions(proof){
 const rows=[];for(const sample of proof.samples){
  if(sample.mode!=='attack'&&sample.mode!=='cast'&&!sample.carry)continue;
  const release=proof.releases.filter(r=>r.sourceId===sample.id&&r.actionTick<=sample.tick).sort((a,b)=>b.actionTick-a.actionTick)[0];
  assert(release,'No real release for an observed action');const dx=release.toX-release.fromX,dy=release.toY-release.fromY;
  const expectedFacing=dx>0?1:-1,expectedAim=Math.round(Math.atan2(dy,Math.abs(dx))*12/Math.PI),actualAim=sample.mode==='attack'||sample.mode==='cast'?sample.aim:sample.carryAim;
  rows.push({capture:sample.capture,tick:sample.tick,kind:sample.kind,mode:sample.mode,releaseId:release.id,expectedFacing,facing:sample.facing,expectedAim,aim:actualAim,carry:sample.carry,matching:expectedFacing===sample.facing&&expectedAim===actualAim});
 }
 return{scope:'Ground-only real release vectors, no height offset. Full original action/carry samples; no animation override.',samples:rows.length,mismatches:rows.filter(row=>!row.matching),rows};
}
const beforeDirection=directions(before),afterDirection=directions(after);
const totals={frames:images.length,comparedPixels:images.reduce((n,r)=>n+r.comparedPixels,0),changedPixels:images.reduce((n,r)=>n+r.changedPixels,0),changedChannels:images.reduce((n,r)=>n+r.changedChannels,0),maximumChannelDifference:Math.max(...images.map(r=>r.maxDifference)),identicalPngs:images.filter(r=>r.pngIdentical).length};
const passed=factComparisons.every(row=>row.identical)&&rulesTreesIdentical&&art.every(row=>row.identical)&&totals.changedChannels===0&&beforeDirection.samples===44&&afterDirection.samples===44&&!beforeDirection.mismatches.length&&!afterDirection.mismatches.length;
const result={passed,scope:'Original real hire/commands/clock/labels and full native 1440x1000 captures. Compare every decoded RGBA channel of all forty PNGs, including alpha, with zero tolerance. Frozen production sources may differ only in renderer implementation; art and rules tree identities checked separately. Not a performance measurement.',
 before:{path:beforePath,head:before.source.head,proofSha256:digest(beforeBytes)},after:{path:afterPath,head:after.source.head,proofSha256:digest(afterBytes)},
 fixtureSha256:before.source.fixtureSha256,harnessSha256:before.source.harnessSha256,rulesTreesIdentical,art,totals,factComparisons,beforeDirection,afterDirection,images};
await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,passed,before:result.before.head,after:result.after.head,...totals,factsIdentical:factComparisons.every(r=>r.identical),artFiles:art.length,directionSamples:afterDirection.samples,directionMismatches:afterDirection.mismatches.length}));if(!passed)process.exitCode=1;
