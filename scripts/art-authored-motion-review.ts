/** Real old/new painters, identical view, pose index and playback timing.
 * npx tsx scripts/art-authored-motion-review.ts */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { paintFigure } from '../src/client/art/painted-units';
import type { UnitKind } from '../src/shared/types';
import type { UnitAnimationFrame } from '../src/client/unit-animation';
const output='docs/art/refactor/followup/authored-poses';
const path=new URL(`../src/client/art/.review-baseline-${process.pid}.ts`,import.meta.url);
const scratch=mkdtempSync('/tmp/authored-motion-');mkdirSync(output,{recursive:true});
writeFileSync(path,execFileSync('git',['show','9819046:src/client/art/painted-units.ts']));
try{
 const original=(await import(path.href)).paintFigure as typeof paintFigure;
 const canvas=createCanvas(1000,980),b=canvas.getContext('2d');
 const kinds:UnitKind[]=['footman','summoner','archer','lancer','worker'];
 const frames:UnitAnimationFrame[]=[];
 for(let cycle=0;cycle<2;cycle++){
  for(const mode of ['idle','walk','attack','cast'] as const){
   for(let frame=0;frame<(mode==='idle'||mode==='walk'?8:6);frame++)for(let hold=0;hold<3;hold++)frames.push({mode,frame});
   for(let hold=0;hold<9;hold++)frames.push({mode:'idle',frame:0});
  }
 }
 frames.forEach((pose,index)=>{
  b.fillStyle='#d0c7b1';b.fillRect(0,0,1000,980);b.fillStyle='#343b3b';b.font='24px sans-serif';
  b.fillText('Original 9819046',230,35);b.fillText('Authored poses / candidate',580,35);
  b.font='16px sans-serif';b.fillText(`${pose.mode} / sample ${pose.frame} / same timing, scale, side view`,230,67);
  kinds.forEach((kind,row)=>{
   b.fillStyle='#343b3b';b.font='18px sans-serif';b.fillText(kind,20,155+row*176);
   for(let col=0;col<2;col++){
    b.save();b.translate(330+col*375,205+row*176);b.scale(2.6,2.6);
    (col?paintFigure:original)(b as unknown as CanvasRenderingContext2D,kind,'#486c78',pose,1);b.restore();
   }
  });
  const bytes=canvas.toBuffer('image/png');writeFileSync(`${scratch}/${String(index).padStart(4,'0')}.png`,bytes);
  if([0,33,66,69,72,75,78,81,93,96,99,102,105,108].includes(index))writeFileSync(`${output}/compare-${index}.png`,bytes);
 });
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','15','-i',`${scratch}/%04d.png`,'-c:v','libx264','-pix_fmt','yuv420p',`${output}/original-vs-authored.mp4`]);
 for(const mode of ['attack','cast','work'] as const){
  const strip=createCanvas(1380,850),c=strip.getContext('2d');c.fillStyle='#d0c7b1';c.fillRect(0,0,1380,850);
  c.fillStyle='#343b3b';c.font='20px sans-serif';c.fillText(`${mode} / every authored sample / current production painter`,20,30);
  kinds.forEach((kind,row)=>{
   c.font='16px sans-serif';c.fillText(kind,10,145+row*150);
   for(let frame=0;frame<6;frame++){
    if(row===0)c.fillText(`Sample ${frame}`,180+frame*200,62);
    c.save();c.translate(220+frame*200,175+row*150);c.scale(2.1,2.1);
    paintFigure(c as unknown as CanvasRenderingContext2D,kind,'#486c78',{mode,frame},1);c.restore();
   }
  });
  writeFileSync(`${output}/${mode}-filmstrip.png`,strip.toBuffer('image/png'));
 }
 writeFileSync(`${output}/timeline.json`,JSON.stringify({fps:15,frames,old:'9819046',method:'Production painters; hand-authored review timeline, not a simulated battle. All samples compared at horizontal aim, which both versions support.'},null,2)+'\n');
}finally{unlinkSync(path);rmSync(scratch,{recursive:true,force:true});}
