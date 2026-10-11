import {createCanvas} from '@napi-rs/canvas';
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {CastMember,UnitPainter} from '../src/story/cast';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
// Optional third argument points to a frozen checkout for identical before/after sheets.
const models=await import(pathToFileURL(resolve(process.argv[3]??'.','src/campaigns/ashen-march/models.ts')).href);
const {CAST}=await import(pathToFileURL(resolve(process.argv[3]??'.','src/campaigns/ashen-march/cast.ts')).href);
const {paintCorpse}=await import(pathToFileURL(resolve(process.argv[3]??'.','src/client/art/corpses.ts')).href);
const appearances=new Map(Object.values(CAST as Record<string,CastMember>).map(member=>[member.model.paint,member]));
const figures=Object.entries(models).filter(([name])=>name.startsWith('paint')) as [string,UnitPainter][];
const poses:UnitAnimationFrame[]=[{mode:'idle',frame:0},{mode:'idle',frame:2},{mode:'walk',frame:2},{mode:'attack',frame:0,variant:0},{mode:'attack',frame:0,variant:1},{mode:'cast',frame:0}];
const w=1250,h=figures.length*132+64,canvas=createCanvas(w,h),b=canvas.getContext('2d');
b.fillStyle='#e6ddc6';b.fillRect(0,0,w,h);b.font='16px sans-serif';b.fillStyle='#332f2b';b.fillText('Ashen March · shared rigs / authored character details',16,24);
for(let j=0;j<poses.length;j++)b.fillText(poses[j]!.mode+(poses[j]!.variant!==undefined?' '+poses[j]!.variant:''),205+j*150,52);
b.fillText('fallen',1105,52);
for(let i=0;i<figures.length;i++){
  const [name,paint]=figures[i]!;const y=64+i*132;
  b.fillStyle=i%2?'#ded4ba':'#e9e1cd';b.fillRect(0,y,w,132);b.fillStyle='#332f2b';b.font='13px sans-serif';b.fillText(name.slice(5),12,y+68);
  for(let j=0;j<poses.length;j++){
    b.save();b.translate(235+j*150,y+96);b.scale(1.5,1.5);paint(b as unknown as CanvasRenderingContext2D,'#386d61',poses[j],1);b.restore();
  }
  const member=appearances.get(paint)!;
  b.save();b.translate(1135,y+96);b.scale(1.5,1.5);
  if(member.model.remains)member.model.remains(b as unknown as CanvasRenderingContext2D,'#386d61');
  else paintCorpse(b,member.rules.base);
  b.restore();
}
const path=process.argv[2]??'docs/art/refactor/after/story.png';
mkdirSync(dirname(path),{recursive:true});writeFileSync(path,canvas.toBuffer('image/png'));
console.log(path);
