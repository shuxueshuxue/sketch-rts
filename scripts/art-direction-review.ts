/** npx tsx scripts/art-direction-review.ts — all equipment, all thirteen aim samples. */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync,writeFileSync } from 'node:fs';
import { paintFigure } from '../src/client/art/painted-units';
import type { EquipmentKind } from '../src/client/art/equipment';
import type { UnitKind } from '../src/shared/types';
const path='docs/art/refactor/directions';mkdirSync(path,{recursive:true});
const weapons:EquipmentKind[]=['none','sword','greatSword','axe','club','pike','pitchfork','bow','staff','crozier','pick','javelin','sling'];
for(const mode of ['attack','cast'] as const){
 const canvas=createCanvas(1980,2000),b=canvas.getContext('2d');b.fillStyle='#d0c7b1';b.fillRect(0,0,1980,2000);
 b.fillStyle='#343b3b';b.font='bold 24px sans-serif';b.fillText(`${mode} / 3 authored source poses + constrained aim / 13 finite samples`,24,36);
 b.font='14px sans-serif';b.fillText('Same body and team · contact/release frame 0 · upward equipment behind torso · near support hand on the rigid socket',24,64);
 for(let col=0;col<13;col++){b.font='14px sans-serif';b.fillText(`${(col-6)*15}°`,177+col*139,98);}
 for(let row=0;row<weapons.length;row++){
  const y=177+row*140;b.fillStyle='#343b3b';b.font='14px sans-serif';b.fillText(weapons[row]!,12,y-8);
  for(let col=0;col<13;col++){
   const x=194+col*139;b.strokeStyle='#aaa18a';b.beginPath();b.moveTo(x-35,y+24);b.lineTo(x+35,y+24);b.stroke();
   b.save();b.translate(x,y);b.scale(1.25,1.25);paintFigure(b as unknown as CanvasRenderingContext2D,'footman','#477b91',{mode,frame:0,aim:col-6},1,{weapon:weapons[row]});b.restore();
  }
 }
 writeFileSync(`${path}/${mode}-all-weapons.png`,canvas.toBuffer('image/png'));
}
const kinds:UnitKind[]=['knight','horseArcher','ogreLord','ogreMage','murlocHunter','tidePriest','ancientStag','redDragon','venomSpider','spirit'];
const canvas=createCanvas(1300,1680),b=canvas.getContext('2d');b.fillStyle='#d0c7b1';b.fillRect(0,0,1300,1680);
b.fillStyle='#343b3b';b.font='bold 23px sans-serif';b.fillText('Native anatomy / mirrored directions / contact and cast',20,32);
for(let row=0;row<kinds.length;row++){
 const y=142+row*151;b.fillStyle='#343b3b';b.font='14px sans-serif';b.fillText(kinds[row]!,10,y);
 for(let col=0;col<6;col++){
  const aim=[-6,-4,0,4,6,-4][col]!,facing=col===5?-1:1;
  b.save();b.translate(240+col*187,y);b.scale(facing*1.3,1.3);paintFigure(b as unknown as CanvasRenderingContext2D,kinds[row]!,'#477b91',{mode:col===5?'cast':'attack',frame:0,aim},facing);b.restore();
 }
}
writeFileSync(`${path}/native-anatomy.png`,canvas.toBuffer('image/png'));
