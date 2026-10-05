/** Real atlas review: node --import tsx scripts/render-combat-refinement.ts */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installHeadlessCanvas} from '../src/recorder/record';
import {gifSink} from '../src/recorder/sinks';
import {drawAtlasUnit,drawAtlasBuilding,drawAtlasGround} from '../src/client/atlas-art';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
installHeadlessCanvas();mkdirSync('docs/art/combat-refinement',{recursive:true});
const canvas=createCanvas(960,360),b=canvas.getContext('2d'),c=b as unknown as CanvasRenderingContext2D;
const sink=gifSink('docs/art/combat-refinement/details.gif',{fps:20});
for(let i=0;i<80;i++){
 drawAtlasGround(c,960,360,{x:0,y:0});
 b.fillStyle='#303b34';b.font='bold 21px sans-serif';b.fillText('LESS NOISE / CLEARER CONTACT',24,32);
 b.font='13px sans-serif';b.fillText('Worker: neck + tool clearance',24,65);b.fillText('Knight: rigid lance + fixed grip',344,65);b.fillText('Building: foundation + contact shadow',644,65);
 const phase=i%40;
 const pose:UnitAnimationFrame=phase<20?{mode:'idle',frame:0}:{mode:'attack',frame:Math.min(5,Math.floor((phase-20)*6/20))};
 drawAtlasUnit(c,'worker',{x:122,y:210},2.5,'#476f69',1,pose);
 drawAtlasUnit(c,'knight',{x:435,y:210},2.5,'#476f69',1,pose);
 drawAtlasBuilding(c,'townHall',{x:782,y:190},150,'#476f69');
 drawAtlasUnit(c,'worker',{x:218,y:300},.75,'#476f69',1,pose);
 drawAtlasUnit(c,'knight',{x:536,y:300},.75,'#476f69',1,pose);
 drawAtlasBuilding(c,'townHall',{x:812,y:296},76,'#476f69');
 b.fillStyle='#485145';b.font='12px sans-serif';b.fillText('Actual game scale below each study',24,342);
 await sink.write({index:i,tick:i,width:960,height:360,canvas,rgba:b.getImageData(0,0,960,360).data});
 if(i===0)writeFileSync('docs/art/combat-refinement/details.png',canvas.toBuffer('image/png'));
}await sink.finish();
