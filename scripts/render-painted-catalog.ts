/** node --import tsx scripts/render-painted-catalog.ts */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { installHeadlessCanvas } from '../src/recorder/record';
import { drawAtlasUnit,drawAtlasBuilding,drawAtlasUnitPortrait } from '../src/client/atlas-art';
import type { UnitKind,BuildingKind } from '../src/shared/types';
installHeadlessCanvas();
const canvas=createCanvas(1440,980),b=canvas.getContext('2d');
const c=b as unknown as CanvasRenderingContext2D;
b.fillStyle='#b9b49e';b.fillRect(0,0,1440,980);
b.fillStyle='#303a35';b.font='bold 28px sans-serif';b.fillText('PAINTED FRONTIER / ACTUAL CANVAS ART',32,43);
b.font='15px sans-serif';b.fillText('Hand-authored figures + projected building geometry. Enlarged studies above; native scale below.',32,72);
const units:UnitKind[]=['worker','footman','archer','lancer','ashWarden','knight','priest','witch','emberRavager','sparkArcher','ashChieftain','pyreCaller'];
units.forEach((kind,i)=>{
 const x=30+(i%6)*232,y=100+Math.floor(i/6)*245;
 b.fillStyle='#c8c2af';b.fillRect(x,y,218,230);
 const team=i<8?'#476f69':'#935747';
 drawAtlasUnit(c,kind,{x:x+95,y:y+140},2.1,team);
 drawAtlasUnit(c,kind,{x:x+175,y:y+162},.75,team);
 drawAtlasUnitPortrait(c,kind,x+153,y+13,48,team);
 b.font='bold 13px sans-serif';b.fillStyle='#37413b';b.fillText(kind,x+12,y+207);
});
const buildings:BuildingKind[]=['townHall','barracks','archeryRange','farm','defenseTower','sanctum','stables','workshop','moonWell','emberForge','cinderSpire','ashenHall'];
buildings.forEach((kind,i)=>{
 const x=30+(i%6)*232,y=605+Math.floor(i/6)*178;
 b.fillStyle='#c8c2af';b.fillRect(x,y,218,163);
 drawAtlasBuilding(c,kind,{x:x+110,y:y+88},125,'#476f69');
 b.font='bold 13px sans-serif';b.fillStyle='#37413b';b.fillText(kind,x+12,y+149);
});
mkdirSync('docs/art/painted-frontier',{recursive:true});
writeFileSync('docs/art/painted-frontier/catalog.png',canvas.toBuffer('image/png'));
