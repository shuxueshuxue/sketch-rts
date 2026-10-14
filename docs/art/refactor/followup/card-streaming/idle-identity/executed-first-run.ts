/** Independent CPU investigation; never changes production cache identities. */
import {createCanvas,type Canvas} from '@napi-rs/canvas';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {setImmediate as yieldImmediate} from 'node:timers/promises';
import type {UnitKind} from '../src/shared/types';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
import {figures,creatures} from '../src/client/art/appearance';
import {actionPaintSize} from '../src/client/art/action-direction';
import {paintFigure} from '../src/client/art/painted-units';
import {appearanceForKind} from '../src/client/art/unit-appearance';
import {sampleMotion} from '../src/client/art/motion';
import type {FigurePresentation} from '../src/client/art/rig';

const args=process.argv.slice(2),outIndex=args.indexOf('--out'),onlyIndex=args.indexOf('--only-kind');
const destination=resolve(outIndex>=0?args[outIndex+1]!:'docs/art/refactor/followup/card-streaming/idle-identity/proof.json');
const onlyKind=onlyIndex>=0?args[onlyIndex+1]:undefined;
const logPath=resolve(dirname(destination),'run.log');mkdirSync(dirname(destination),{recursive:true});writeFileSync(logPath,'');
const PAIRS=[[0,4],[1,3],[5,7]] as const,DENSITIES=[2,4] as const,FACINGS=[-1,1] as const,TEAMS=['#b79048','#ad5c46'] as const;
const carryStates=[{carry:0,carryAim:0},...[1,3,6].flatMap(carry=>[-6,0,6].map(carryAim=>({carry,carryAim})))];
type Gear={label:string;appearance:Readonly<FigurePresentation>};
type Row={kind:UnitKind;family:'figure'|'creature';gear:string;frames:readonly[number,number];comparisons:number;comparedPixels:number;changedPixels:number;changedChannels:number;maximumChannelDifference:number;emptyReferences:number;failures:unknown[]};
const sourceFiles=['scripts/art-idle-paint-identity-proof.ts','src/client/art/appearance.ts','src/client/art/action-direction.ts','src/client/art/painted-units.ts','src/client/art/painted-creatures.ts','src/client/art/creature-painters.ts','src/client/art/creature-poses.ts','src/client/art/rig.ts','src/client/art/equipment.ts','src/client/art/body-parts.ts','src/client/art/motion.ts','src/client/art/materials.ts','src/client/art/unit-appearance.ts'];
const kinds=[...Object.keys(figures),...Object.keys(creatures)] as UnitKind[];
const selected=onlyKind?kinds.filter(kind=>kind===onlyKind):kinds;
if(!selected.length)throw new Error(`No stock asset found: ${onlyKind}`);
const report={schemaVersion:1,startedAt:new Date().toISOString(),completed:false,paused:false,fullRequestedScope:!onlyKind,
  source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sha256:Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]))},
  method:'CPU @napi-rs/canvas; compare every original-domain RGBA byte, including transparent RGB. Original painter and pose unchanged; no WebGL or performance measurement.',
  settings:{pairs:PAIRS,densities:DENSITIES,facings:FACINGS,teams:TEAMS,carryStates,domain:'actionPaintSize(originalPose, kind)',storyVariants:'opaque variants excluded',walking:'not normalized or proposed for merging'},
  observedMotionValues:PAIRS.map(([a,b])=>({frames:[a,b],a:sampleMotion({mode:'idle',frame:a},'slash').breathe,b:sampleMotion({mode:'idle',frame:b},'slash').breathe})),
  assets:selected,rows:[] as Row[],totals:{comparisons:0,comparedPixels:0,changedPixels:0,changedChannels:0,maximumChannelDifference:0,emptyReferences:0},
  permittedPairs:[] as (readonly[number,number])[]};
const canvases=new Map<number,Canvas>();let pauseRequested=false;
process.on('SIGINT',()=>{pauseRequested=true;});process.on('SIGTERM',()=>{pauseRequested=true;});
function log(value:unknown){const line=JSON.stringify(value);process.stdout.write(line+'\n');appendFileSync(logPath,line+'\n');}
function save(){writeFileSync(destination,JSON.stringify(report,null,2)+'\n');}
function gearFor(kind:UnitKind):Gear[]{
  if(!figures[kind])return[{label:'native',appearance:{}}];
  const gear:Gear[]=[{label:'native',appearance:{}},{label:'greatSword',appearance:{weapon:'greatSword'}},{label:'roundShield',appearance:{shield:true,shieldStyle:'round'}}];
  if(kind==='priest'||kind==='summoner')gear.push({label:'ember-role-skin',appearance:appearanceForKind(kind,'ember')});
  return gear;
}
function raster(kind:UnitKind,pose:UnitAnimationFrame,team:string,density:number,facing:1|-1,appearance:Readonly<FigurePresentation>){
  const tile=actionPaintSize(pose,kind),size=tile*density;
  let canvas=canvases.get(size);if(!canvas){canvas=createCanvas(size,size);canvases.set(size,canvas);}
  const ctx=canvas.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(density,density);ctx.translate(tile/2,tile/2);ctx.scale(facing,1);
  try{if(!paintFigure(ctx as unknown as CanvasRenderingContext2D,kind,team,pose,facing,appearance))throw new Error(`Missing stock painter: ${kind}`);}finally{ctx.restore();}
  return{tile,size,rgba:ctx.getImageData(0,0,size,size).data};
}
function compare(a:Uint8ClampedArray,b:Uint8ClampedArray){
  const aa=Buffer.from(a.buffer,a.byteOffset,a.byteLength),bb=Buffer.from(b.buffer,b.byteOffset,b.byteLength);
  if(aa.length!==bb.length)throw new Error('Original domains differ between idle frames.');
  if(aa.equals(bb))return{changedPixels:0,changedChannels:0,maximumChannelDifference:0,samples:[]};
  let changedPixels=0,changedChannels=0,maximumChannelDifference=0;const samples:unknown[]=[];
  for(let pixel=0;pixel<a.length/4;pixel++){
    let changed=false;
    for(let channel=0;channel<4;channel++){const difference=Math.abs(a[pixel*4+channel]!-b[pixel*4+channel]!);if(difference){changed=true;changedChannels++;maximumChannelDifference=Math.max(maximumChannelDifference,difference);}}
    if(changed){changedPixels++;if(samples.length<8)samples.push({pixel,a:Array.from(a.subarray(pixel*4,pixel*4+4)),b:Array.from(b.subarray(pixel*4,pixel*4+4))});}
  }
  return{changedPixels,changedChannels,maximumChannelDifference,samples};
}
function visible(rgba:Uint8ClampedArray){for(let i=3;i<rgba.length;i+=4)if(rgba[i])return true;return false;}

async function main(){
  let comparisonsSinceYield=0;
  for(const kind of selected)for(const gear of gearFor(kind))for(const frames of PAIRS){
    const row:Row={kind,family:figures[kind]?'figure':'creature',gear:gear.label,frames,comparisons:0,comparedPixels:0,changedPixels:0,changedChannels:0,maximumChannelDifference:0,emptyReferences:0,failures:[]};
    report.rows.push(row);
    const states=figures[kind]||creatures[kind]?.weapon?carryStates:carryStates.slice(0,1);
    for(const state of states)for(const density of DENSITIES)for(const facing of FACINGS)for(const team of TEAMS){
      const carry=state.carry?{carry:state.carry,carryAim:state.carryAim}:{};
      const aPose:UnitAnimationFrame={mode:'idle',frame:frames[0],...carry},bPose:UnitAnimationFrame={mode:'idle',frame:frames[1],...carry};
      const a=raster(kind,aPose,team,density,facing,gear.appearance),b=raster(kind,bPose,team,density,facing,gear.appearance);
      const result=compare(a.rgba,b.rgba),empty=!visible(a.rgba),pixels=a.size*a.size;
      row.comparisons++;row.comparedPixels+=pixels;row.changedPixels+=result.changedPixels;row.changedChannels+=result.changedChannels;row.maximumChannelDifference=Math.max(row.maximumChannelDifference,result.maximumChannelDifference);row.emptyReferences+=Number(empty);
      report.totals.comparisons++;report.totals.comparedPixels+=pixels;report.totals.changedPixels+=result.changedPixels;report.totals.changedChannels+=result.changedChannels;report.totals.maximumChannelDifference=Math.max(report.totals.maximumChannelDifference,result.maximumChannelDifference);report.totals.emptyReferences+=Number(empty);
      if((result.changedPixels||empty)&&row.failures.length<8)row.failures.push({carry:state,density,facing,team,tile:a.tile,size:a.size,...result,empty});
      if(++comparisonsSinceYield>=32){comparisonsSinceYield=0;await yieldImmediate();if(pauseRequested){report.paused=true;save();log({paused:true,kind,gear:gear.label,frames,totals:report.totals});return;}}
    }
    log({kind,gear:gear.label,frames,comparisons:row.comparisons,changedPixels:row.changedPixels,maximumChannelDifference:row.maximumChannelDifference});save();
  }
  report.completed=true;
  if(report.fullRequestedScope)report.permittedPairs=PAIRS.filter(pair=>report.rows.filter(row=>row.frames[0]===pair[0]).every(row=>row.changedChannels===0&&row.emptyReferences===0));
  save();log({completed:true,fullRequestedScope:report.fullRequestedScope,totals:report.totals,permittedPairs:report.permittedPairs});
  if(report.totals.changedChannels||report.totals.emptyReferences)process.exitCode=1;
}
await main();
