/** Reproducible presentation-only loadout/motion proof. Run: npx tsx scripts/art-rig-review.ts */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { paintFigure } from '../src/client/art/painted-units';
import type { FigurePresentation } from '../src/client/art/rig';
import type { UnitAnimationFrame } from '../src/client/unit-animation';
import type { UnitKind } from '../src/shared/types';
const path='docs/art/refactor/after';mkdirSync(path,{recursive:true});
const canvas=createCanvas(1440,1150),c=canvas.getContext('2d');
c.fillStyle='#d0c7b1';c.fillRect(0,0,canvas.width,canvas.height);
c.fillStyle='#343b3b';c.font='bold 23px sans-serif';c.fillText('Authored rigs · equipment sockets · shared actions',24,35);
c.font='14px sans-serif';c.fillText('Same soldier / different weapon     •     Rest → contact variants → recovery / cast / idle     •     No simulation changes',24,62);
const cases:[string,UnitKind,FigurePresentation][]=[
 ['Footman / sword','footman',{weapon:'sword'}],['Footman / axe','footman',{weapon:'axe'}],
 ['Footman / greatsword','footman',{weapon:'greatSword'}],['Footman / bow','footman',{weapon:'bow'}],
 ['Footman / staff','footman',{weapon:'staff'}],['Mercenary / shared slash','mercenary',{motion:'slash'}],
 ['Knight / mounted pike','knight',{}],['Worker / pick','worker',{}],
];
const poses:UnitAnimationFrame[]=[{mode:'idle',frame:0},{mode:'attack',frame:0,variant:0},{mode:'attack',frame:0,variant:1},{mode:'attack',frame:0,variant:2},{mode:'attack',frame:3},{mode:'attack',frame:5},{mode:'cast',frame:0},{mode:'idle',frame:2}];
const labels=['Ready','Contact A','Contact B','Contact C','Recovery','Ready (end)','Cast release','Idle breath'];
for(let col=0;col<8;col++){c.font='13px sans-serif';c.fillStyle='#48504b';c.fillText(labels[col]!,185+col*154,90);}
for(let row=0;row<cases.length;row++){
 const [label,kind,appearance]=cases[row]!;const y=120+row*126;
 c.font='13px sans-serif';c.fillStyle='#343b3b';c.fillText(label,12,y+47);
 for(let col=0;col<8;col++){
  const x=222+col*154;c.strokeStyle='#9e9d8955';c.beginPath();c.moveTo(x-59,y+86);c.lineTo(x+62,y+86);c.stroke();
  c.save();c.translate(x,y+61);c.scale(1.55,1.55);paintFigure(c as unknown as CanvasRenderingContext2D,kind,'#486c78',poses[col]!,1,appearance);c.restore();
 }
}
writeFileSync(`${path}/rig-equipment-actions.png`,canvas.toBuffer('image/png'));
const beasts:UnitKind[]=['wildling','ancientStag','venomSpider','redDragon','ogreWarrior','ogreMage','murlocHunter','tidePriest','rockGolem','spirit'];
const creatureCanvas=createCanvas(1300,850),b=creatureCanvas.getContext('2d');b.fillStyle='#d0c7b1';b.fillRect(0,0,1300,850);
for(let row=0;row<2;row++)for(let col=0;col<5;col++){
 const kind=beasts[row*5+col]!;b.fillStyle='#343b3b';b.font='16px sans-serif';b.fillText(kind,col*260+15,row*420+28);
 for(let state=0;state<3;state++){
  const pose:UnitAnimationFrame=state===0?{mode:'idle',frame:0}:state===1?{mode:'attack',frame:0,variant:1}:{mode:'cast',frame:0};
  b.font='12px sans-serif';b.fillText(['Ready','Contact B','Cast'][state]!,col*260+15,row*420+70+state*113);
  b.save();b.translate(col*260+140,row*420+110+state*113);b.scale(1.35,1.35);paintFigure(b as unknown as CanvasRenderingContext2D,kind,'#486c78',pose,1);b.restore();
 }
}
writeFileSync(`${path}/creature-rigs.png`,creatureCanvas.toBuffer('image/png'));
console.log(`${path}/rig-equipment-actions.png\n${path}/creature-rigs.png`);
