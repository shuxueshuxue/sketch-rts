/** Actual production painters: eight distance phases for every creature. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {creatures} from '../src/client/art/appearance';
import {paintCreature} from '../src/client/art/painted-creatures';
import type {UnitKind} from '../src/shared/types';
const label=process.argv[2]??'after',out='docs/art/refactor/followup/creature-gait';
mkdirSync(`${out}/${label}`,{recursive:true});
const kinds=Object.keys(creatures) as UnitKind[],still:Record<string,string>={};
for(let frame=0;frame<8;frame++){
 const canvas=createCanvas(1680,720),b=canvas.getContext('2d');b.fillStyle='#d0c7b1';b.fillRect(0,0,1680,720);
 kinds.forEach((kind,index)=>{const x=index%7*240,y=Math.floor(index/7)*240;
  b.fillStyle='#343b3b';b.font='15px sans-serif';b.fillText(`${kind} / ${label} / ${frame}`,x+8,y+24);
  b.save();b.translate(x+113,y+166);b.scale(1.55,1.55);paintCreature(b as unknown as CanvasRenderingContext2D,kind,'#486c78',{mode:'walk',frame},{});b.restore();
 });writeFileSync(`${out}/${label}/frame-${frame}.png`,canvas.toBuffer('image/png'));
}
for(const kind of kinds)for(const mode of ['idle','attack','cast'] as const)for(let frame=0;frame<(mode==='idle'?8:6);frame++){
 const canvas=createCanvas(256,256),b=canvas.getContext('2d');b.translate(128,170);
 paintCreature(b as unknown as CanvasRenderingContext2D,kind,'#486c78',{mode,frame},{});
 still[`${kind}/${mode}/${frame}`]=createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex');
}
writeFileSync(`${out}/${label}/nonwalking.json`,JSON.stringify(still,null,2)+'\n');
