/** All fourteen actual building sprites, enlarged and at gameplay scale. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installHeadlessCanvas} from '../src/recorder/record';
import {drawAtlasBuilding} from '../src/client/atlas-art';
import {BUILDING_CARDS} from '../src/client/content/buildings';
import type {BuildingKind} from '../src/shared/types';
installHeadlessCanvas();
const canvas=createCanvas(1280,1030),b=canvas.getContext('2d'),c=b as unknown as CanvasRenderingContext2D;
b.fillStyle='#b9b49e';b.fillRect(0,0,1280,1030);b.fillStyle='#303b34';b.font='bold 26px sans-serif';b.fillText('NEW ARCHITECTURE / 14 BUILDINGS',24,37);
b.font='14px sans-serif';b.fillText('Actual cached geometry. Enlarged study + gameplay-size sprite in each panel.',24,66);
(Object.keys(BUILDING_CARDS) as BuildingKind[]).forEach((kind,i)=>{
 const x=20+i%4*315,y=90+Math.floor(i/4)*230;
 b.fillStyle='#c8c2af';b.fillRect(x,y,305,218);
 drawAtlasBuilding(c,kind,{x:x+115,y:y+127},150,'#476f69');
 drawAtlasBuilding(c,kind,{x:x+263,y:y+154},kind==='townHall'?76:58,'#476f69');
 b.fillStyle='#303b34';b.font='bold 14px sans-serif';b.fillText(BUILDING_CARDS[kind].name.en,x+13,y+204);
});
mkdirSync('docs/art/combat-refinement',{recursive:true});
writeFileSync('docs/art/combat-refinement/buildings.png',canvas.toBuffer('image/png'));
