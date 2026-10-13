/** Visual review of the real catalog painters, not mock models or rule changes. */
import {createCanvas} from '@napi-rs/canvas';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setImmediate as yieldImmediate} from 'node:timers/promises';
import type {MercenaryUnitKind} from '../src/shared/types';
import {MERCENARY_UNIT_KINDS} from '../src/shared/catalog';
import {paintFigure} from '../src/client/art/painted-units';
import {paintCorpse} from '../src/client/art/corpses';
import {drawAtlasUnitPortrait} from '../src/client/atlas-art';
import {setScratchCanvasFactory} from '../src/client/art/scratch-canvas';
import type {FigurePresentation} from '../src/client/art/rig';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
import {actionPaintSize} from '../src/client/art/action-direction';

const args=process.argv.slice(2),outAt=args.indexOf('--out'),beforeAt=args.indexOf('--before');
const out=resolve(outAt>=0?args[outAt+1]!:'docs/art/refactor/followup/mercenary-models');
const previous=beforeAt>=0?await import(pathToFileURL(resolve(args[beforeAt+1]!)).href):undefined;
const previousPath=beforeAt>=0?resolve(args[beforeAt+1]!):undefined;
mkdirSync(out,{recursive:true});
setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
const kinds=MERCENARY_UNIT_KINDS;
const team='#6b7f68',idle:UnitAnimationFrame={mode:'idle',frame:0};
const names:Record<MercenaryUnitKind,string>={mercenary:'Company swordsman',contractArcher:'Contract archer',fieldMedic:'Field medic'};
const files:string[]=[];
function paper(ctx:CanvasRenderingContext2D,w:number,h:number){ctx.fillStyle='#ddd5bb';ctx.fillRect(0,0,w,h);ctx.font='18px sans-serif';ctx.fillStyle='#45463b';}
function figure(ctx:CanvasRenderingContext2D,kind:MercenaryUnitKind,x:number,y:number,scale:number,pose=idle,appearance:FigurePresentation={},facing:1|-1=1,painter=paintFigure){
  ctx.save();ctx.translate(x,y);ctx.scale(scale*facing,scale);painter(ctx,kind,team,pose,facing,appearance);ctx.restore();
}
function save(name:string,canvas:ReturnType<typeof createCanvas>){writeFileSync(resolve(out,name),canvas.toBuffer('image/png'));files.push(name);}

const lineup=createCanvas(1536,800),b=lineup.getContext('2d') as unknown as CanvasRenderingContext2D;
paper(b,1536,800);b.font='26px sans-serif';b.fillText('Hired companies / actual catalog models',30,38);
b.font='16px sans-serif';b.fillText('Same unit rules, sampled hands and weapon sockets. Costumes and anatomy authored independently.',30,67);
for(let i=0;i<kinds.length;i++){
  const kind=kinds[i]!,x=i*512;
  b.fillStyle='#45463b';b.font='22px sans-serif';b.fillText(names[kind],x+28,109);
  b.font='15px sans-serif';b.fillText('Previous shared costume',x+25,144);b.fillText('Independent model',x+265,144);
  if(previous)figure(b,kind,x+126,332,3.1,idle,{},1,previous.paintFigure);
  figure(b,kind,x+359,332,3.1);
  b.fillStyle='#45463b';b.fillText('Game size',x+25,411);
  for(const facing of [-1,1] as const)figure(b,kind,x+(facing===-1?62:136),481,1.15,idle,{},facing);
  b.fillText('Portrait from real model',x+250,411);
  drawAtlasUnitPortrait(b,kind,x+255,435,143,team);
  b.fillStyle='#45463b';b.fillText('Captured equipment: great sword / round shield',x+25,609);
  figure(b,kind,x+118,750,2.1,idle,{weapon:'greatSword',shield:false});
  figure(b,kind,x+355,750,2.1,idle,{shield:true,shieldStyle:'round'});
}
save('lineup.png',lineup);

const columns:{label:string;pose:UnitAnimationFrame;appearance?:FigurePresentation;facing?:1|-1}[]=[
  {label:'Idle',pose:idle},
  {label:'Walk / 2',pose:{mode:'walk',frame:2}},
  {label:'Attack up 60',pose:{mode:'attack',frame:0,aim:-4}},
  {label:'Attack level',pose:{mode:'attack',frame:0,aim:0}},
  {label:'Attack down 60',pose:{mode:'attack',frame:0,aim:4}},
  {label:'Cast / 0',pose:{mode:'cast',frame:0,aim:0}},
  {label:'Ready up',pose:{mode:'idle',frame:2,carry:6,carryAim:-4}},
  {label:'Ready down',pose:{mode:'walk',frame:2,carry:6,carryAim:4}},
  {label:'Left / up',pose:{mode:'attack',frame:0,aim:-4},facing:-1},
  {label:'Pike up 60',pose:{mode:'attack',frame:0,aim:-4},appearance:{weapon:'pike',shield:false}},
  {label:'Pike down 60',pose:{mode:'attack',frame:0,aim:4},appearance:{weapon:'pike',shield:false}},
];
const motion=createCanvas(columns.length*196+40,916),m=motion.getContext('2d') as unknown as CanvasRenderingContext2D;
paper(m,motion.width,motion.height);m.font='26px sans-serif';m.fillText('Original authored actions / independently painted hired bodies',24,37);
m.font='14px sans-serif';m.fillText('Fixed contact-to-recovery samples; pike columns are presentation equipment examples, not changed gameplay.',24,65);
for(let i=0;i<columns.length;i++){m.fillStyle='#45463b';m.font='15px sans-serif';m.fillText(columns[i]!.label,i*196+15,96);}
for(let row=0;row<kinds.length;row++)for(let col=0;col<columns.length;col++){
  const sample=columns[col]!,kind=kinds[row]!;
  figure(m,kind,col*196+79,290+row*258,2.5,sample.pose,sample.appearance,sample.facing);
  if(col===0){m.fillStyle='#45463b';m.font='15px sans-serif';m.fillText(names[kind],10,360+row*258);}
}
save('actions.png',motion);

const remains=createCanvas(1050,430),r=remains.getContext('2d') as unknown as CanvasRenderingContext2D;
paper(r,1050,430);r.font='25px sans-serif';r.fillText('Hired company remains / costume and captured loadout',24,38);
for(let i=0;i<kinds.length;i++){
  const kind=kinds[i]!;r.font='19px sans-serif';r.fillStyle='#45463b';r.fillText(names[kind],i*350+20,84);
  for(const [row,appearance] of [{},{weapon:'greatSword',shield:false},{shield:true,shieldStyle:'round'}].entries()){
    r.save();r.translate(i*350+147,127+row*102);r.scale(2.8,2.8);paintCorpse(r,kind,appearance as FigurePresentation);r.restore();
  }
}
save('remains.png',remains);

// Prove current cache sharing against the new drawings across every relevant
// direction/guard/equipment combination. All RGBA bytes, including alpha-zero RGB.
const sizeCanvases=new Map<number,ReturnType<typeof createCanvas>>();
function raster(kind:MercenaryUnitKind,pose:UnitAnimationFrame,gear:FigurePresentation,density:number,facing:1|-1,color:string){
  const tile=actionPaintSize(pose,kind),size=tile*density;
  let canvas=sizeCanvases.get(size);if(!canvas){canvas=createCanvas(size,size);sizeCanvases.set(size,canvas);}
  const ctx=canvas.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(density*facing,density);ctx.translate(facing*tile/2,tile/2);
  paintFigure(ctx as unknown as CanvasRenderingContext2D,kind,color,pose,facing,gear);ctx.restore();
  return ctx.getImageData(0,0,size,size).data;
}
const gear:FigurePresentation[]=[{}, {weapon:'greatSword'}, {shield:true,shieldStyle:'round'}, {weapon:'pike',shield:false}, {weapon:'bow'}, {weapon:'staff'}];
let comparisons=0,pixels=0;
for(const kind of kinds)for(const appearance of gear)for(const carry of [0,1,3,6])for(const carryAim of carry?[-6,-4,0,4,6]:[0])for(const [a,c] of [[0,4],[1,3],[5,7]])for(const density of [2,4])for(const facing of [-1,1] as const)for(const color of ['#6b7f68','#ad5c46']){
  const pose:UnitAnimationFrame={mode:'idle',frame:a!,...(carry?{carry,carryAim}: {})};
  const before=raster(kind,pose,appearance,density,facing,color),after=raster(kind,{...pose,frame:c!},appearance,density,facing,color);
  if(!Buffer.from(before.buffer,before.byteOffset,before.byteLength).equals(Buffer.from(after.buffer,after.byteOffset,after.byteLength)))throw new Error(`Idle identity mismatch ${JSON.stringify({kind,appearance,carry,carryAim,a,c,density,facing,color})}`);
  pixels+=before.length/4;comparisons++;
  if(comparisons%32===0)await yieldImmediate();
}
const sourceFiles=['src/client/art/painted-mercenaries.ts','src/client/art/painted-units.ts','src/client/art/corpses.ts','src/client/art/rig.ts','src/client/art/equipment.ts','scripts/art-mercenary-catalog.ts'];
const report={source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sha256:Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]))},
  previousPainter:previousPath?{path:previousPath,sha256:createHash('sha256').update(readFileSync(previousPath)).digest('hex'),head:execFileSync('git',['rev-parse','HEAD'],{cwd:dirname(dirname(dirname(dirname(previousPath)))),encoding:'utf8'}).trim()}:null,
  assets:kinds,files,review:'CPU @napi-rs/canvas actual production models; not a WebGL battle or performance claim.',
  idleIdentity:{frames:[[0,4],[1,3],[5,7]],densities:[2,4],facings:[-1,1],teams:['#6b7f68','#ad5c46'],carry:[0,1,3,6],carryAims:[-6,-4,0,4,6],equipment:gear,comparisons,comparedPixels:pixels,changedPixels:0,changedChannels:0}};
writeFileSync(resolve(out,'catalog.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
