/** npx tsx scripts/art-carry-review.ts before|after */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { paintFigure } from '../src/client/art/painted-units';
import type { UnitKind } from '../src/shared/types';
import type { UnitAnimationFrame } from '../src/client/unit-animation';
const output='docs/art/refactor/followup/carry-posture';
mkdirSync(output,{recursive:true});
const kinds:UnitKind[]=['footman','mercenary','lancer','archer','priest','summoner','worker','knight'];
const poses:UnitAnimationFrame[]=[{mode:'idle',frame:0},{mode:'walk',frame:2},{mode:'attack',frame:0,aim:-4},{mode:'attack',frame:0,aim:0},{mode:'attack',frame:0,aim:4},{mode:'attack',frame:3,aim:0}];
const canvas=createCanvas(1200,1380),b=canvas.getContext('2d');
b.fillStyle='#d0c7b1';b.fillRect(0,0,canvas.width,canvas.height);
b.fillStyle='#343b3b';b.font='20px sans-serif';b.fillText(`Carry posture / ${process.argv[2]??'after'} / production painter`,20,30);
for(let c=0;c<poses.length;c++)b.fillText(['Idle','Walk','Up 60','Level','Down 60','Recovery'][c]!,180+c*170,65);
for(let r=0;r<kinds.length;r++){
 b.fillStyle='#343b3b';b.font='16px sans-serif';b.fillText(kinds[r]!,15,160+r*160);
 for(let c=0;c<poses.length;c++){
  b.save();b.translate(220+c*170,185+r*160);b.scale(2,2);
  paintFigure(b as unknown as CanvasRenderingContext2D,kinds[r]!,'#486c78',poses[c]!,1);b.restore();
 }
}
writeFileSync(`${output}/${process.argv[2]??'after'}.png`,canvas.toBuffer('image/png'));
if(process.argv[2]==='after'&&existsSync(`${output}/before.png`)){
 const before=await loadImage(`${output}/before.png`),compare=createCanvas(2400,1380),c=compare.getContext('2d');
 c.drawImage(before,0,0);c.drawImage(canvas,1200,0);
 writeFileSync(`${output}/comparison.png`,compare.toBuffer('image/png'));
}
