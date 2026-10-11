/** Quiet ground-level remains: folded silhouettes, broken contour and pencil
 * hatching. No rotated living sprites, hit markers or saturated blood pools. */
import type {UnitKind} from '../../shared/types';
import {UNIT_CARDS} from '../content/units';
import {type Brush, polygon, line, ellipse} from './kit';
import { REMAINS_MATERIAL } from './materials';
const {ink:INK,wash:WASH,light:LIGHT,dark:DARK}=REMAINS_MATERIAL;
import { equipmentForKind, solveFigureRig } from './rig';
import { figures } from './appearance';
import { IDLE_FRAME } from '../unit-animation';
import type { EquipmentKind } from './equipment';
import { creatureAnatomy } from './painted-creatures';
export interface CorpsePresentation {
  anatomy?: 'foot' | 'mounted' | 'beast' | 'construct' | 'wood' | 'spirit' | 'vessel';
  weapon?: EquipmentKind; shield?: boolean; headwear?: boolean; robe?: boolean; cloth?: string; size?: number;
  detail?: (b: Brush) => void;
}
const loadout=equipmentForKind;
const isStaff=(equipment:EquipmentKind|undefined)=>equipment==='staff'||equipment==='crozier';
function sketch(b:Brush,p:number[][],fill:string=WASH){
 polygon(b,p,fill,INK,.65);b.save();b.clip();
 const xs=p.map(q=>q[0]!),ys=p.map(q=>q[1]!),lo=Math.min(...xs),hi=Math.max(...xs),y=Math.min(...ys),bottom=Math.max(...ys);
 for(let x=lo-10;x<hi+12;x+=3.1)line(b,[[x,y],[x-7,bottom]],'#4c50433d',.45);
 b.restore();
 // Selective contour breaks keep the edge light instead of an icon-like outline.
 if(p.length>3)line(b,[p[1]!,p[2]!],'#c0b8a466',.55);
}
function limb(b:Brush,p:number[][],width=3){line(b,p,INK,width+.8);line(b,p,WASH,width);}
function weapon(b:Brush,equipment:EquipmentKind|undefined){
 if(!equipment||equipment==='none')return;
 if(equipment==='sling'){
  line(b,[[4,12],[11,15],[16,12],[25,14]],INK,.8);
  line(b,[[4,13],[10,16],[16,14],[25,14]],INK,.6);
  sketch(b,[[12,12],[16,11],[19,13],[16,15]],DARK);ellipse(b,22,10,1.7,1.2,LIGHT,INK);
 }else if(equipment==='bow'){
  b.beginPath();b.moveTo(-19,8);b.quadraticCurveTo(0,20,13,10);b.strokeStyle=INK;b.lineWidth=1;b.stroke();
  line(b,[[-19,8],[13,10]],'#777365',.55);line(b,[[4,13],[24,16]],INK,.65);
 }else if(equipment==='javelin'){
  line(b,[[-13,10],[20,15]],INK,1.2);sketch(b,[[19,13],[26,16],[19,17]],LIGHT);
 }else if(isStaff(equipment)||equipment==='pike'||equipment==='pitchfork'){
  line(b,[[-25,9],[25,16]],INK,1.3);line(b,[[-23,8.5],[24,15.5]],LIGHT,.5);
  if(equipment==='pitchfork'){line(b,[[23,12],[22,19]],INK,1);for(const y of [12,15.5,19])line(b,[[22,y],[30,y+1]],INK,.9);}
  else if(equipment==='pike')sketch(b,[[24,14],[32,17],[24,18]],LIGHT);
  else ellipse(b,26,16,2.6,1.7,'transparent',INK);
 }else if(equipment==='club'){
  line(b,[[5,13],[28,8]],INK,2.4);sketch(b,[[21,4],[30,2],[34,9],[23,12]],DARK);
 }else if(equipment==='pick'){
  line(b,[[5,12],[26,7]],INK,1.6);sketch(b,[[22,3],[27,5],[30,11],[25,7]],DARK);
 }else{
  const axe=equipment==='axe';
  line(b,[[6,13],[26,10]],INK,1.5);
  if(axe)sketch(b,[[21,9],[22,4],[29,5],[30,12],[25,13]],DARK);
  else sketch(b,[[13,11],[29,8],[27,11],[13,13]],LIGHT);
 }
}
function fallenPerson(b:Brush,kind:UnitKind,options:CorpsePresentation,wild=false){
 const equipment=options.weapon??loadout(kind);
 const robe=options.robe??isStaff(equipment),heavy=kind.startsWith('ogre');
 b.save();if(heavy)b.scale(1.2,1.15);
 // Head remains attached to shoulder; the far arm folds underneath the body.
 limb(b,[[-6,-2],[-13,1],[-17,6]],2.7);
 sketch(b,[[-9,-5],[-2,-7],[9,-2],[11,4],[4,7],[-8,2]],options.cloth??(wild?'#858976':WASH));
 if(robe)sketch(b,[[1,-5],[18,-2],[24,5],[9,8],[4,4]],options.cloth??'#89877c');
 else {limb(b,[[8,2],[16,4],[24,2]],3.6);limb(b,[[7,4],[13,9],[22,10]],3.3);}
 sketch(b,[[-9,-4],[-11,-7],[-16,-7],[-19,-4],[-17,0],[-12,1]],wild?'#94927b':LIGHT);
 limb(b,[[-5,-3],[1,0],[-1,6]],2.5);
 if(kind==='worker'&&options.headwear!==false)sketch(b,[[-24,3],[-18,1],[-14,3],[-13,5],[-21,6]],'#a29577');
 if(options.shield??(figures[kind]?solveFigureRig(figures[kind]!,IDLE_FRAME).shield:false)){
  sketch(b,[[-9,8],[-4,6],[3,9],[1,15],[-6,14]],DARK);
  line(b,[[-7,9],[-4,12],[0,10]],LIGHT,.65);
 }
 if(wild&&kind.startsWith('murloc'))sketch(b,[[9,1],[23,-4],[19,2],[13,5]],DARK);
 if(wild&&kind==='wildling')for(const x of [-7,-1,5])line(b,[[x,-5],[x-3,-10]],INK,1);
 weapon(b,equipment);b.restore();
}
export function paintCorpse(b:Brush,kind:UnitKind,options:CorpsePresentation={}){
 const card=UNIT_CARDS[kind],bearing=options.anatomy??creatureAnatomy(kind)??card.art.bearing;
 b.save();b.lineJoin='round';b.lineCap='round';
 if(options.size!==undefined)b.scale(options.size,options.size);
 if(bearing==='vessel'){
  // Naval units leave a low wreck, never a human outline on the water.
  ellipse(b,0,2,33,9,'#7b817729');
  sketch(b,[[-31,-3],[-23,-7],[-14,-3],[-4,-6],[6,-2],[20,-5],[30,0],[19,8],[-18,9]],DARK);
  for(let i=0;i<5;i++)line(b,[[-20+i*9,-2],[-24+i*9,7]],LIGHT,.7);
  line(b,[[-19,9],[20,-10]],INK,2);sketch(b,[[2,0],[20,-10],[14,0],[7,5]],LIGHT);
  if(kind==='warship')sketch(b,[[-6,2],[-2,-1],[5,1],[4,6],[-5,6]],INK);
 }else if(bearing==='spirit'){
  for(let i=0;i<5;i++)line(b,[[-17+i*6,2+i%2],[ -10+i*5,-3],[ -6+i*5,0]],'#8b8c7980',.7);
  ellipse(b,0,1,17,4,'#a1a59024');
 }else if(bearing==='wood'){
  // A fallen trunk with broken roots and a leaf crown, not a rubble golem or
  // quadruped. Its actual anatomy comes from the living creature registry.
  sketch(b,[[-24,-5],[-14,-9],[13,-4],[24,3],[12,8],[-16,5]],options.cloth??'#898574');
  for(const y of [-3,1,4])line(b,[[-18,y],[14,y+2]],'#625e50',.75);
  for(const side of [-1,1]){
   limb(b,[[side*12,3],[side*20,9],[side*29,7]],2.5);
   limb(b,[[side*20,9],[side*25,12]],1.7);
  }
  for(const [x,y,r] of [[-21,-7,6],[-10,-9,7],[-28,-3,4]])ellipse(b,x!,y!,r!,r!*.6,'#858975',INK);
 }else if(bearing==='construct'){
  const pieces=[[-18,-3,8],[-5,-5,10],[9,0,9],[21,5,6],[-12,7,5],[2,10,5]];
  for(const [x,y,r] of pieces)sketch(b,[[x!-r!,y!],[x!-r!*.4,y!-r!*.6],[x!+r!*.6,y!-r!*.35],[x!+r!,y!+2],[x!,y!+r!*.6]],WASH);
  line(b,[[-7,-6],[-4,-2],[-8,1]],'#b7af9666',.7);
 }else if(bearing==='mounted'){
  sketch(b,[[-26,-5],[-18,-10],[4,-8],[15,-3],[14,5],[-5,9],[-23,6]],DARK);
  for(const x of [-18,-8,6,12])limb(b,[[x,4],[x+7,10],[x+13,9]],2);
  sketch(b,[[10,-4],[20,-9],[26,-7],[32,-4],[29,0],[22,0],[15,5]],WASH);
  line(b,[[-26,-1],[-31,3],[-35,2]],INK,1.4);
  b.save();b.translate(-5,-4);b.scale(.72,.72);fallenPerson(b,kind,options);b.restore();
 }else if(bearing==='beast'){
  const spider=kind.toLowerCase().includes('spider'),dragon=kind.toLowerCase().includes('dragon');
  sketch(b,[[-19,-2],[-12,-8],[4,-7],[15,-1],[11,6],[-5,8],[-17,4]],options.cloth??DARK);
  if(spider){
   for(const side of [-1,1])for(let i=0;i<4;i++)limb(b,[[-11+i*7,side*3],[-17+i*9,side*9],[-8+i*6,side*6]],1.1);
  }else{
   sketch(b,[[12,-3],[21,-5],[26,-1],[23,3],[13,4]],WASH);
   for(const x of [-12,4])limb(b,[[x,4],[x+6,10],[x+11,9]],2);
   if(dragon){sketch(b,[[-9,-3],[-25,-15],[-6,-10],[5,-19],[9,-4]],'#95927e');line(b,[[-18,1],[-30,5],[-35,2]],INK,1.7);}
   if(kind==='ancientStag')for(const d of [0,4])line(b,[[20,-4],[16+d,-12],[13+d,-15],[18+d,-13],[21+d,-15]],INK,.9);
   if(kind==='deepSnapper'||kind==='stonebackBrute')sketch(b,[[-19,-2],[-12,-9],[3,-8],[13,-2],[5,4],[-10,5]],'#9c9985');
  }
 }else fallenPerson(b,kind,options,card.art.faction==='wild');
 options.detail?.(b);
 b.restore();
}
