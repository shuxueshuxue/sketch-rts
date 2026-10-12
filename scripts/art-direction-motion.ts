/** npx tsx scripts/art-direction-motion.ts — slowed contact/recovery review. */
import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { mkdirSync,writeFileSync } from 'node:fs';
import { paintFigure } from '../src/client/art/painted-units';
import type { EquipmentKind } from '../src/client/art/equipment';
import type { UnitAnimationFrame } from '../src/client/unit-animation';
const {GIFEncoder,quantize,applyPalette}=createRequire(import.meta.url)('gifenc');
const width=1140,height=900,canvas=createCanvas(width,height),b=canvas.getContext('2d');
const weapons:EquipmentKind[]=['sword','greatSword','pike','bow','staff','javelin'];
const poses:UnitAnimationFrame[]=[...Array.from({length:6},(_,frame)=>({mode:'attack' as const,frame})),...Array.from({length:4},()=>({mode:'idle' as const,frame:0})),...Array.from({length:6},(_,frame)=>({mode:'cast' as const,frame})),...Array.from({length:4},()=>({mode:'idle' as const,frame:0}))];
const frames=poses.map(pose=>{
 b.fillStyle='#d0c7b1';b.fillRect(0,0,width,height);b.fillStyle='#343b3b';b.font='bold 22px sans-serif';b.fillText('Direction / contact → ready / cast → ready',20,31);
 b.font='14px sans-serif';b.fillText(`Slowed to 90 ms per sample · ${pose.mode} frame ${pose.frame} · mirrored final column`,20,58);
 for(let col=0;col<5;col++){b.fillText(['up 90°','up 60°','forward','down 60°','left / down 90°'][col]!,166+col*192,88);}
 for(let row=0;row<weapons.length;row++){
  const y=176+row*126;b.fillStyle='#343b3b';b.font='14px sans-serif';b.fillText(weapons[row]!,12,y);
  for(let col=0;col<5;col++){
   const x=204+col*192,aim=[-6,-4,0,4,6][col]!,facing=col===4?-1:1;
   b.strokeStyle='#a49e88';b.beginPath();b.moveTo(x-40,y+25);b.lineTo(x+40,y+25);b.stroke();
   b.save();b.translate(x,y);b.scale(facing*1.4,1.4);paintFigure(b as unknown as CanvasRenderingContext2D,'footman','#477b91',{...pose,aim},facing,{weapon:weapons[row]});b.restore();
  }
 }
 return b.getImageData(0,0,width,height).data;
});
const samples=new Uint8Array(frames[0]!.length*2);samples.set(frames[0]!);samples.set(frames[10]!,frames[0]!.length);
const palette=quantize(samples,128),gif=GIFEncoder();
for(const frame of frames)gif.writeFrame(applyPalette(frame,palette),width,height,{palette,delay:90});
gif.finish();mkdirSync('docs/art/refactor/directions',{recursive:true});writeFileSync('docs/art/refactor/directions/recovery-and-cast.gif',gif.bytes());
