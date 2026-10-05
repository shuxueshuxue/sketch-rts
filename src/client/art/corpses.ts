/** Quiet ground-level remains: folded silhouettes, broken contour and pencil
 * hatching. No rotated living sprites, hit markers or saturated blood pools. */
import type {UnitKind} from '../../shared/types';
import {UNIT_CARDS} from '../content/units';
import {type Brush, polygon, line, ellipse} from './kit';
const INK='#555247', WASH='#929082', LIGHT='#aaa594', DARK='#6b6c60';
const bow=new Set(['archer','sparkArcher','contractArcher','murlocHunter','thornSlinger']);
const staff=new Set(['priest','summoner','witch','emberAcolyte','ashHexer','pyreCaller','fieldMedic','barkMender','gladeWitch','tidePriest','ogreMage']);
const pike=new Set(['lancer','groveWarden','knight']);
function sketch(b:Brush,p:number[][],fill=WASH){
 polygon(b,p,fill,INK,.65);b.save();b.clip();
 const xs=p.map(q=>q[0]!),ys=p.map(q=>q[1]!),lo=Math.min(...xs),hi=Math.max(...xs),y=Math.min(...ys),bottom=Math.max(...ys);
 for(let x=lo-10;x<hi+12;x+=3.1)line(b,[[x,y],[x-7,bottom]],'#4c50433d',.45);
 b.restore();
 // Selective contour breaks keep the edge light instead of an icon-like outline.
 if(p.length>3)line(b,[p[1]!,p[2]!],'#c0b8a466',.55);
}
function limb(b:Brush,p:number[][],width=3){line(b,p,INK,width+.8);line(b,p,WASH,width);}
function weapon(b:Brush,kind:UnitKind){
 if(bow.has(kind)){
  b.beginPath();b.moveTo(-19,8);b.quadraticCurveTo(0,20,13,10);b.strokeStyle=INK;b.lineWidth=1;b.stroke();
  line(b,[[-19,8],[13,10]],'#777365',.55);line(b,[[4,13],[24,16]],INK,.65);
 }else if(staff.has(kind)||pike.has(kind)){
  line(b,[[-25,9],[25,16]],INK,1.3);line(b,[[-23,8.5],[24,15.5]],LIGHT,.5);
  if(pike.has(kind))sketch(b,[[24,14],[32,17],[24,18]],LIGHT);
  else ellipse(b,26,16,2.6,1.7,'transparent',INK);
 }else if(kind==='worker'){
  line(b,[[5,12],[26,7]],INK,1.6);sketch(b,[[22,3],[27,5],[30,11],[25,7]],DARK);
 }else{
  const axe=kind==='emberRavager'||kind==='ashChieftain';
  line(b,[[6,13],[26,10]],INK,1.5);
  if(axe)sketch(b,[[21,9],[22,4],[29,5],[30,12],[25,13]],DARK);
  else sketch(b,[[13,11],[29,8],[27,11],[13,13]],LIGHT);
 }
}
function fallenPerson(b:Brush,kind:UnitKind,wild=false){
 const robe=staff.has(kind),heavy=kind.startsWith('ogre');
 b.save();if(heavy)b.scale(1.2,1.15);
 // Head remains attached to shoulder; the far arm folds underneath the body.
 limb(b,[[-6,-2],[-13,1],[-17,6]],2.7);
 sketch(b,[[-9,-5],[-2,-7],[9,-2],[11,4],[4,7],[-8,2]],wild?'#858976':WASH);
 if(robe)sketch(b,[[1,-5],[18,-2],[24,5],[9,8],[4,4]],'#89877c');
 else {limb(b,[[8,2],[16,4],[24,2]],3.6);limb(b,[[7,4],[13,9],[22,10]],3.3);}
 sketch(b,[[-9,-4],[-11,-7],[-16,-7],[-19,-4],[-17,0],[-12,1]],wild?'#94927b':LIGHT);
 limb(b,[[-5,-3],[1,0],[-1,6]],2.5);
 if(kind==='worker')sketch(b,[[-24,3],[-18,1],[-14,3],[-13,5],[-21,6]],'#a29577');
 else if(!robe&&!bow.has(kind)&&!wild){
  sketch(b,[[-9,8],[-4,6],[3,9],[1,15],[-6,14]],DARK);
  line(b,[[-7,9],[-4,12],[0,10]],LIGHT,.65);
 }
 if(wild&&kind.startsWith('murloc'))sketch(b,[[9,1],[23,-4],[19,2],[13,5]],DARK);
 if(wild&&kind==='wildling')for(const x of [-7,-1,5])line(b,[[x,-5],[x-3,-10]],INK,1);
 weapon(b,kind);b.restore();
}
export function paintCorpse(b:Brush,kind:UnitKind){
 const card=UNIT_CARDS[kind],bearing=card.art.bearing;
 b.save();b.lineJoin='round';b.lineCap='round';
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
 }else if(bearing==='construct'){
  const pieces=[[-18,-3,8],[-5,-5,10],[9,0,9],[21,5,6],[-12,7,5],[2,10,5]];
  for(const [x,y,r] of pieces)sketch(b,[[x!-r!,y!],[x!-r!*.4,y!-r!*.6],[x!+r!*.6,y!-r!*.35],[x!+r!,y!+2],[x!,y!+r!*.6]],WASH);
  line(b,[[-7,-6],[-4,-2],[-8,1]],'#b7af9666',.7);
 }else if(bearing==='mounted'){
  sketch(b,[[-26,-5],[-18,-10],[4,-8],[15,-3],[14,5],[-5,9],[-23,6]],DARK);
  for(const x of [-18,-8,6,12])limb(b,[[x,4],[x+7,10],[x+13,9]],2);
  sketch(b,[[10,-4],[20,-9],[26,-7],[32,-4],[29,0],[22,0],[15,5]],WASH);
  line(b,[[-26,-1],[-31,3],[-35,2]],INK,1.4);
  b.save();b.translate(-5,-4);b.scale(.72,.72);fallenPerson(b,kind);b.restore();
 }else if(bearing==='beast'){
  const spider=kind.toLowerCase().includes('spider'),dragon=kind.toLowerCase().includes('dragon');
  sketch(b,[[-19,-2],[-12,-8],[4,-7],[15,-1],[11,6],[-5,8],[-17,4]],DARK);
  if(spider){
   for(const side of [-1,1])for(let i=0;i<4;i++)limb(b,[[-11+i*7,side*3],[-17+i*9,side*9],[-8+i*6,side*6]],1.1);
  }else{
   sketch(b,[[12,-3],[21,-5],[26,-1],[23,3],[13,4]],WASH);
   for(const x of [-12,4])limb(b,[[x,4],[x+6,10],[x+11,9]],2);
   if(dragon){sketch(b,[[-9,-3],[-25,-15],[-6,-10],[5,-19],[9,-4]],'#95927e');line(b,[[-18,1],[-30,5],[-35,2]],INK,1.7);}
   if(kind==='ancientStag')for(const d of [0,4])line(b,[[20,-4],[16+d,-12],[13+d,-15],[18+d,-13],[21+d,-15]],INK,.9);
   if(kind==='deepSnapper'||kind==='stonebackBrute')sketch(b,[[-19,-2],[-12,-9],[3,-8],[13,-2],[5,4],[-10,5]],'#9c9985');
  }
 }else fallenPerson(b,kind,card.art.faction==='wild');
 b.restore();
}
