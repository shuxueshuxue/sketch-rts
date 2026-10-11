/** Production directional poses, including every recovery frame and both facings.
 * npx tsx scripts/art-direction-playback.ts */
import { createCanvas } from '@napi-rs/canvas';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { paintFigure } from '../src/client/art/painted-units';
import type { UnitKind } from '../src/shared/types';
const out=process.argv[2]??'docs/art/refactor/followup/directional-playback';mkdirSync(out,{recursive:true});
const scratch=mkdtempSync('/tmp/directional-playback-');
const canvas=createCanvas(1160,1000),b=canvas.getContext('2d');
const kinds:UnitKind[]=['lancer','knight','footman','archer','summoner'];
try{
 for(let index=0;index<288;index++){
  const cycle=Math.floor(index/48),tick=index%48,variant=cycle%3,facing:1|-1=cycle<3?1:-1;
  const attacking=tick>=12&&tick<40,frame=tick<20?0:Math.min(5,1+Math.floor((tick-20)/4));
  b.fillStyle='#d0c7b1';b.fillRect(0,0,1160,1000);b.fillStyle='#343b3b';b.font='22px sans-serif';
  b.fillText('Directional actions / current production painter',20,32);b.font='16px sans-serif';
  b.fillText(`Facing ${facing===1?'right':'left'} / variant ${variant+1} / ${attacking?`contact to recovery: ${frame}`:'ready'}`,20,62);
  ['Target: up 60 deg','Target: level','Target: down 60 deg'].forEach((label,col)=>b.fillText(label,220+col*310,99));
  kinds.forEach((kind,row)=>{
   b.fillStyle='#343b3b';b.fillText(kind==='summoner'?'summoner / cast':kind,15,200+row*170);
   for(let col=0;col<3;col++){
    const x=290+col*310,y=240+row*170;
    b.strokeStyle='#9e9986';b.beginPath();b.moveTo(x-80,y+38);b.lineTo(x+100,y+38);b.stroke();
    b.save();b.translate(x,y);b.scale(facing*2,2);
    paintFigure(b as unknown as CanvasRenderingContext2D,kind,'#486c78',attacking?
     {mode:kind==='summoner'?'cast':'attack',frame,variant,aim:[-4,0,4][col]}:{mode:'idle',frame:0},facing);
    b.restore();
   }
  });
  const bytes=canvas.toBuffer('image/png');writeFileSync(`${scratch}/${String(index).padStart(4,'0')}.png`,bytes);
  if([12,24,32,156].includes(index))writeFileSync(`${out}/frame-${index}.png`,bytes);
 }
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','24','-i',`${scratch}/%04d.png`,'-c:v','libx264','-pix_fmt','yuv420p',`${out}/up-level-down.mp4`]);
 writeFileSync(`${out}/playback-method.json`,JSON.stringify({fps:24,frames:288,directions:[-60,0,60],variants:3,facings:2,source:'current production painter',timing:'Review holds on ready/contact; event contact through six recovery samples. Not a simulated battle or pre-hit windup.'},null,2)+'\n');
}finally{rmSync(scratch,{recursive:true,force:true});}
