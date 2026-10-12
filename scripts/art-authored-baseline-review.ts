/** Compare the historical human painter and current production painter at identical scale.
 * The extracted module is temporary review input, never a production fallback. */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { paintFigure } from '../src/client/art/painted-units';
import type { UnitKind } from '../src/shared/types';
const output='docs/art/refactor/followup/authored-baseline';
const path=new URL(`../src/client/art/.review-baseline-${process.pid}.ts`,import.meta.url);
mkdirSync(output,{recursive:true});
writeFileSync(path,execFileSync('git',['show','9819046:src/client/art/painted-units.ts']));
try{
 const original=(await import(path.href)).paintFigure as typeof paintFigure;
 const canvas=createCanvas(1460,1400),b=canvas.getContext('2d');
 b.fillStyle='#d0c7b1';b.fillRect(0,0,1460,1400);b.fillStyle='#343b3b';b.font='22px sans-serif';
 b.fillText('Original authored painter (9819046) vs rejected IK revision (5d7ebe0)',20,32);
 b.font='15px sans-serif';
 ['Original idle','Current idle','Original walk','Current walk','Original contact','Current contact'].forEach((s,i)=>b.fillText(s,175+i*210,70));
 const kinds:UnitKind[]=['footman','lancer','archer','priest','summoner','worker','knight','emberRavager'];
 kinds.forEach((kind,row)=>{
  b.fillText(kind,12,160+row*160);
  for(let col=0;col<6;col++){
   b.save();b.translate(220+col*210,185+row*160);b.scale(2,2);
   (col%2?paintFigure:original)(b as unknown as CanvasRenderingContext2D,kind,'#486c78',col<2?{mode:'idle',frame:0}:col<4?{mode:'walk',frame:2}:{mode:'attack',frame:0},1);
   b.restore();
  }
 });
 writeFileSync(`${output}/original-vs-current.png`,canvas.toBuffer('image/png'));
}finally{unlinkSync(path);}
