/** Render the complete nonhuman roster at native coordinates and fixed scale. */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { creatures } from '../src/client/art/appearance';
import { paintCreature } from '../src/client/art/painted-creatures';
import type { UnitKind } from '../src/shared/types';
const label=process.argv[2]??'after',out='docs/art/refactor/followup/creature-redraw';mkdirSync(out,{recursive:true});
const groups={
 giants:['golem','rubbleGolem','rockGolem','graniteGolem','stonebackBrute','ogreWarrior','ogreMage','ogreLord'],
 beasts:['wildling','mossGnawer','ancientStag','deepSnapper','dragonWhelp','redDragon'],
 others:['spiderling','venomSpider','spiderQueen','murlocPeon','murlocHunter','tidePriest','spirit'],
} satisfies Record<string,UnitKind[]>;
for(const [group,kinds] of Object.entries(groups)){
 const canvas=createCanvas(1080,100+kinds.length*190),b=canvas.getContext('2d');
 b.fillStyle='#d0c7b1';b.fillRect(0,0,canvas.width,canvas.height);b.fillStyle='#343b3b';b.font='22px sans-serif';b.fillText(`${group} / ${label} / actual creature painter`,20,33);
 ['Idle','Walk','Attack contact','Cast release'].forEach((s,i)=>{b.font='16px sans-serif';b.fillText(s,190+i*220,73);});
 kinds.forEach((kind,row)=>{
  b.fillStyle='#343b3b';b.font='15px sans-serif';b.fillText(kind,12,175+row*190);
  for(let col=0;col<4;col++){
   b.save();b.translate(240+col*220,210+row*190);b.scale(1.75,1.75);
   paintCreature(b as unknown as CanvasRenderingContext2D,kind,'#486c78',{mode:(['idle','walk','attack','cast'] as const)[col]!,frame:col===1?2:0},{});b.restore();
  }
 });
 writeFileSync(`${out}/${group}-${label}.png`,canvas.toBuffer('image/png'));
}
writeFileSync(`${out}/roster-${label}.json`,JSON.stringify(Object.entries(creatures).map(([kind,d])=>({kind,...d})),null,2)+'\n');
