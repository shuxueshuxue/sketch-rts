import { actionPaintSize } from '../src/client/art/action-direction';
/** Exhaustive catalog contact sheets using the actual Canvas world/portrait painters. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {installHeadlessCanvas} from '../src/recorder/record';
import {UNIT_CARDS} from '../src/client/content/units';
import {BUILDING_CARDS} from '../src/client/content/buildings';
import {drawAtlasUnit,drawAtlasCorpse,drawAtlasBuilding,drawAtlasUnitPortrait,drawAtlasBuildingPortrait} from '../src/client/atlas-art';
import {drawPaintedItem} from '../src/client/art/items';
import type {UnitKind,BuildingKind,ItemKind} from '../src/shared/types';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
import {ITEM_DEFS} from '../src/shared/equipment';
const output=resolve(process.argv[2]??'work/art-catalog');mkdirSync(output,{recursive:true});installHeadlessCanvas();
const units=Object.keys(UNIT_CARDS) as UnitKind[],buildings=Object.keys(BUILDING_CARDS) as BuildingKind[],items=Object.keys(ITEM_DEFS) as ItemKind[];
function sheet(name:string,keys:string[],paint:(ctx:CanvasRenderingContext2D,key:string,index:number)=>void,columns=8,width=220,height=200,anchorY=.58){
 const canvas=createCanvas(columns*width,Math.ceil(keys.length/columns)*height),ctx=canvas.getContext('2d');
 ctx.fillStyle='#e6dfcc';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(const [index,key]of keys.entries()){
  const x=index%columns*width,y=Math.floor(index/columns)*height;
  ctx.save();ctx.translate(x+width/2,y+height*anchorY);paint(ctx as unknown as CanvasRenderingContext2D,key,index);ctx.restore();
  ctx.fillStyle='#303738';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText(key,x+width/2,y+height-9,width-8);
  ctx.strokeStyle='#9a968533';ctx.strokeRect(x,y,width,height);
 }
 writeFileSync(resolve(output,`${name}.png`),canvas.toBuffer('image/png'));
}
sheet('units',units,(c,k)=>drawAtlasUnit(c,k as UnitKind,{x:0,y:0},1.6,'#65908c'));
sheet('corpses',units,(c,k)=>drawAtlasCorpse(c,k as UnitKind,{x:0,y:0},1.6));
sheet('buildings',buildings,(c,k)=>drawAtlasBuilding(c,k as BuildingKind,{x:0,y:0},70,'#65908c'),6,210,180);
sheet('unit-portraits',units,(c,k)=>drawAtlasUnitPortrait(c,k as UnitKind,-48,-55,96,'#65908c'));
sheet('building-portraits',buildings,(c,k)=>drawAtlasBuildingPortrait(c,k as BuildingKind,100,'#65908c'));
sheet('items',items,(c,k)=>drawPaintedItem(c,k as ItemKind,{x:0,y:-10},68));
for(const mode of ['idle','walk','attack','cast','work'] as const){
 const keys=units.flatMap(kind=>Array.from({length:6},(_,frame)=>`${kind}:${frame}`));
 // Reserve the real authored domain at review scale, including the enlarged
 // combat envelope; narrow cells could overlap or crop the last column's tool.
 const scale=1.7,domain=actionPaintSize({mode,frame:0}),cell=Math.ceil(domain*scale)+40;
 sheet(`animation-${mode}`,keys,(c,key)=>{const [kind,frame]=key.split(':');drawAtlasUnit(c,kind as UnitKind,{x:0,y:0},scale,'#65908c',1,{mode,frame:Number(frame)} as UnitAnimationFrame);},6,cell,cell,.5);
}
writeFileSync(resolve(output,'inventory.json'),JSON.stringify({units,buildings,items,animations:['idle','walk','attack','cast','work'],framesPerMode:6,notes:'Full catalog world painters and shared UI portrait paths. Contact sheets reveal silhouette/clipping and phase progression, not live hit correctness. Naval world geometry is reviewed separately in browser fixture.'},null,2)+'\n');
console.log(JSON.stringify({units:units.length,buildings:buildings.length,items:items.length,animationFrames:units.length*30}));
