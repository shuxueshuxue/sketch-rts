/** Actual painter evidence. Optional module path lets a preserved worktree supply a reference. */
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {UnitKind} from '../src/shared/types';
const label=process.argv[2]??'after';
const {paintCreature}=await import(pathToFileURL(resolve(process.argv[3]??'src/client/art/painted-creatures.ts')).href);
const out='docs/art/refactor/followup/head-review';mkdirSync(out,{recursive:true});
const kinds:UnitKind[]=['golem','stonebackBrute','ogreWarrior','ogreMage','murlocHunter','ancientStag','wildling','deepSnapper','venomSpider','redDragon'];
const sheet=createCanvas(1000,1440),b=sheet.getContext('2d');b.fillStyle='#d0c7b1';b.fillRect(0,0,1000,1440);b.fillStyle='#343b3b';b.font='22px sans-serif';b.fillText(`${label} / actual creature painters / idle`,20,30);
for(let i=0;i<kinds.length;i++){
 const kind=kinds[i]!,col=i%2,row=Math.floor(i/2),x=col*500,y=55+row*275;
 b.fillStyle='#343b3b';b.font='17px sans-serif';b.fillText(kind,x+16,y+20);
 const c=createCanvas(1024,1024),ctx=c.getContext('2d');ctx.scale(4,4);ctx.translate(128,150);paintCreature(ctx,kind,'#527584',{mode:'idle',frame:0});
 b.drawImage(c,x+18,y+35,256,256);
 const head=(kind.includes('ogre')||kind==='golem'||kind==='stonebackBrute')?[110,97,40,38]:kind==='murlocHunter'?[123,108,40,37]:kind==='venomSpider'?[129,130,40,35]:kind==='ancientStag'?[142,67,45,63]:kind==='redDragon'?[147,93,53,55]:[142,121,49,35];
 b.drawImage(c,...head.map(n=>n*4) as [number,number,number,number],x+280,y+65,head[2]!*3.5,head[3]!*3.5);
}
writeFileSync(`${out}/${label}.png`,sheet.toBuffer('image/png'));
if(label==='after'&&['original','before'].every(name=>existsSync(`${out}/${name}.png`))){
 const comparison=createCanvas(1500,2800),ctx=comparison.getContext('2d');ctx.fillStyle='#d0c7b1';ctx.fillRect(0,0,1500,2800);
 for(const [column,name] of ['original','before','after'].entries()){
  const source=await loadImage(`${out}/${name}.png`);ctx.fillStyle='#343b3b';ctx.font='22px sans-serif';
  ctx.fillText(`${name} / ${column===0?'9819046':column===1?'f3f91d8':'head revision'}`,column*500+18,32);
  for(let row=0;row<kinds.length;row++)ctx.drawImage(source,row%2*500,55+Math.floor(row/2)*275,500,275,column*500,50+row*275,500,275);
 }
 writeFileSync(`${out}/comparison.png`,comparison.toBuffer('image/png'));
}
