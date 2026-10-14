/** Same actual painter and poses before/after; no simulation inputs changed. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {paintCreature,creatureReleaseSocket} from '../src/client/art/painted-creatures';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
const label=process.argv[2]??'after',out='docs/art/refactor/followup/turtle-anatomy';mkdirSync(out,{recursive:true});
const poses:UnitAnimationFrame[]=[{mode:'idle',frame:0},...Array.from({length:8},(_,frame)=>({mode:'walk' as const,frame})),...[-4,0,4].map(aim=>({mode:'attack' as const,frame:0,aim})),{mode:'cast',frame:0}];
const c=createCanvas(1300,poses.length*135),b=c.getContext('2d');b.fillStyle='#d0c7b1';b.fillRect(0,0,c.width,c.height);
const bounds=[];
for(let i=0;i<poses.length;i++){const frame=poses[i]!;b.fillStyle='#343730';b.font='16px sans-serif';b.fillText(`${frame.mode} ${frame.frame} aim ${frame.aim??0}`,12,i*135+24);
 for(let col=0;col<4;col++){const scale=col<2?2:1,mirror=col%2?-1:1;b.save();b.translate(330+col*260,i*135+90);b.scale(scale*mirror,scale);paintCreature(b as unknown as CanvasRenderingContext2D,'deepSnapper','#486c78',frame);b.restore();}
 const tile=createCanvas(256,256),t=tile.getContext('2d');t.translate(128,140);paintCreature(t as unknown as CanvasRenderingContext2D,'deepSnapper','#486c78',frame);const data=t.getImageData(0,0,256,256).data;let x0=256,y0=256,x1=-1,y1=-1;for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]!>8){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}bounds.push({frame,bounds:[x0-128,y0-140,x1-128,y1-140],release:creatureReleaseSocket('deepSnapper',frame)});
}
writeFileSync(`${out}/${label}.png`,c.toBuffer('image/png'));writeFileSync(`${out}/${label}.json`,JSON.stringify(bounds,null,2)+'\n');
