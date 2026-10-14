/** Actual production world/portrait/remains drawings and bounded raster checks. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {UnitKind} from '../src/shared/types';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
const arg=(name:string,fallback:string)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1]??fallback;};
const source=resolve(arg('--source',process.cwd())),output=resolve(arg('--out','work/creature-followup'));
if(process.argv.includes('--source')&&!process.argv[process.argv.indexOf('--source')+1])throw new Error('Missing --source');
mkdirSync(output,{recursive:true});
const moduleAt=(file:string)=>import(pathToFileURL(resolve(source,file)).href);
const {installHeadlessCanvas}=await moduleAt('src/recorder/record.ts') as typeof import('../src/recorder/record');
installHeadlessCanvas();
const {creatures}=await moduleAt('src/client/art/appearance.ts') as typeof import('../src/client/art/appearance');
const {paintCreature,creatureReleaseSocket}=await moduleAt('src/client/art/painted-creatures.ts') as typeof import('../src/client/art/painted-creatures');
const atlas=await moduleAt('src/client/atlas-art.ts') as typeof import('../src/client/atlas-art');
const kinds=Object.keys(creatures) as UnitKind[],changed=new Set<UnitKind>(['deepSnapper','dragonWhelp','redDragon']);
const hash=(data:NodeJS.ArrayBufferView|string)=>createHash('sha256').update(data).digest('hex');
const b=createCanvas(256,256),ctx=b.getContext('2d');
function pixels(kind:UnitKind,pose:UnitAnimationFrame,mirror:number=1){
 ctx.resetTransform();ctx.clearRect(0,0,256,256);ctx.translate(128,160);ctx.scale(mirror,1);
 paintCreature(ctx as unknown as CanvasRenderingContext2D,kind,'#486c78',pose);
 return ctx.getImageData(0,0,256,256).data;
}
function bounds(data:Uint8ClampedArray){
 let left=256,top=256,right=-1,bottom=-1;
 for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]!>16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 return [left-128,top-160,right-128,bottom-160];
}
const fingerprints:Record<string,{rgbaSha256:string;bounds:number[];release:ReturnType<typeof creatureReleaseSocket>}>={};
for(const kind of kinds){
 const poses:UnitAnimationFrame[]=[...Array.from({length:8},(_,frame)=>({mode:'idle' as const,frame})),...Array.from({length:8},(_,frame)=>({mode:'walk' as const,frame}))];
 const aims=changed.has(kind)?Array.from({length:13},(_,i)=>i-6):[-4,0,4];
 for(const aim of aims)for(const mode of ['attack','cast'] as const)for(let frame=0;frame<6;frame++)for(let variant=0;variant<(mode==='attack'&&changed.has(kind)?3:1);variant++)poses.push({mode,frame,aim,variant});
 for(const pose of poses)for(const mirror of changed.has(kind)?[-1,1]:[1]){
  const data=pixels(kind,pose,mirror),edge=bounds(data);
  if(edge[0]===-128||edge[1]===-160||edge[2]===127||edge[3]===95)throw new Error('Inspection crop: '+kind);
  fingerprints[`${kind}/${pose.mode}/${pose.frame}/${pose.aim??0}/${pose.variant??0}/${mirror}`]={rgbaSha256:hash(data),bounds:edge,release:creatureReleaseSocket(kind,pose)};
 }
}
const modes:UnitAnimationFrame[]=[{mode:'idle',frame:0},{mode:'walk',frame:2},{mode:'attack',frame:0,aim:-4},{mode:'attack',frame:0},{mode:'attack',frame:0,aim:4}];
const canvas=createCanvas(1720,kinds.length*180+70),c=canvas.getContext('2d');
c.fillStyle='#d0c7b1';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#343730';c.font='18px sans-serif';c.fillText('Production world models / idle, walking and contact at -60, 0, +60 degrees',18,28);
for(const [i,label]of ['Idle','Walk','Attack up','Attack level','Attack down','Portrait 48 / 96','Remains'].entries()){c.font='13px sans-serif';c.fillText(label,120+i*225,55);}
const surfaces:Record<string,string>={};
for(const [row,kind]of kinds.entries()){
 const y=70+row*180;c.font='13px sans-serif';c.fillStyle='#343730';c.fillText(kind,8,y+160);
 for(let col=0;col<5;col++){c.save();c.translate(205+col*225,y+130);atlas.drawAtlasUnit(c as unknown as CanvasRenderingContext2D,kind,{x:0,y:0},1.4,'#486c78',1,modes[col]);c.restore();}
 atlas.drawAtlasUnitPortrait(c as unknown as CanvasRenderingContext2D,kind,1250,y+70,48,'#486c78');atlas.drawAtlasUnitPortrait(c as unknown as CanvasRenderingContext2D,kind,1305,y+30,96,'#486c78');
 atlas.drawAtlasCorpse(c as unknown as CanvasRenderingContext2D,kind,{x:1530,y:y+116},1.4);
 for(const size of [48,96]){const portrait=createCanvas(size,size),p=portrait.getContext('2d');atlas.drawAtlasUnitPortrait(p as unknown as CanvasRenderingContext2D,kind,0,0,size,'#486c78');surfaces[`${kind}/portrait/${size}`]=hash(p.getImageData(0,0,size,size).data);}
 const remains=createCanvas(256,128),r=remains.getContext('2d');atlas.drawAtlasCorpse(r as unknown as CanvasRenderingContext2D,kind,{x:128,y:64},1.4);surfaces[`${kind}/remains`]=hash(r.getImageData(0,0,256,128).data);
}
writeFileSync(resolve(output,'roster.png'),canvas.toBuffer('image/png'));
// Repeated actual raster paints: fixed content, no simulation or PNG encoding.
// Counts and timing belong to this CPU fixture, not cache hits or game FPS.
const samples:number[]=[];const paintModes:UnitAnimationFrame[]=[{mode:'idle',frame:0},{mode:'walk',frame:2},...[-4,0,4].map(aim=>({mode:'attack' as const,frame:0,aim}))];
for(let pass=0;pass<12;pass++){
 const start=performance.now();for(let repeat=0;repeat<4;repeat++)for(const kind of ['deepSnapper','dragonWhelp','redDragon'] as const)for(const pose of paintModes){ctx.resetTransform();ctx.clearRect(0,0,256,256);ctx.translate(128,160);paintCreature(ctx as unknown as CanvasRenderingContext2D,kind,'#486c78',pose);}
 const elapsed=performance.now()-start;if(pass>=2)samples.push(elapsed);
}
const sorted=[...samples].sort((a,z)=>a-z);
const files=['src/client/art/creature-painters.ts','src/client/art/creature-poses.ts','src/client/art/corpses.ts','src/client/art/painted-creatures.ts','src/client/atlas-art.ts'];
const manifest={sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(files.map(file=>[file,hash(readFileSync(resolve(source,file)))])),kinds,changedKinds:[...changed],fingerprints,surfaces,cpuRaster:{method:'60 actual creature paints per sample; two warmup samples excluded, ten measured samples. Same canvas/poses/kinds. PNG/hash work and simulation excluded. Canvas/NAPI CPU fixture, not gameplay FPS.',paintsPerSample:60,samplesMs:samples,meanMs:samples.reduce((a,z)=>a+z,0)/samples.length,p50Ms:sorted[5],p95Ms:sorted[9],maxMs:sorted[9]},notes:'Atlas world/portrait/remains use actual production entry points; raster fingerprints are unlabelled RGBA. Real WebGL gameplay is a separate proof.'};
writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,kinds:kinds.length,rasterStates:Object.keys(fingerprints).length,surfaceStates:Object.keys(surfaces).length,cpuRaster:manifest.cpuRaster}));
