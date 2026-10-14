import {hasWarfareUnit,paintWarfareUnit} from './warfare-units';
/** Hand-painted cutout figures. Geometry is authored here, not generated artwork.
 * One restrained material set; six action keys and eight locomotion keys.
 * Feet stay at y=16 and each figure lives inside the atlas's 128px tile. */
import { hasPaintedCreature, paintCreature } from './painted-creatures';
import { hasMercenaryModel, paintMercenary } from './painted-mercenaries';
import type { UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
import { type Brush, line, ellipse, darker, lighter } from './kit';

import { figures, type Figure } from './appearance';
export const hasPaintedUnit = (kind: UnitKind) => hasWarfareUnit(kind) || !!figures[kind] || hasPaintedCreature(kind);
import { INK, STEEL, EDGE, SHADE, SKIN, HIDE, LINEN, paintedPlane as poly, segment as seg } from './materials';
import { leg } from './body-parts';
import { sampleFigurePose, type FigurePresentation } from './rig';
import { paintEquipment } from './equipment';
function face(b:Brush,kind:Figure,team:string,facing:number,headwear=true,clothOverride?:string){
  // A 7px face on a 47px body: no eyes or cartoon head proportions.
  poly(b,[[-3,-34],[-2,-38],[2,-38.5],[4,-35],[3.7,-30.5],[1,-28.7],[-2.7,-31]],SKIN);
  poly(b,[[1,-37],[3,-36],[4,-33],[3,-30],[.8,-29.5]],'#84634e','transparent',0);
  line(b,[[2,-34],[4.2,-34]],'#35322d',.7);
  if(!headwear)return;
  if(kind.armor){
    poly(b,[[-4,-33],[-3.5,-39],[-.6,-41],[3.4,-39.4],[4.5,-34],[1,-35],[-1,-32]],kind.ember?'#716d65':STEEL);
    poly(b,[[-3.1,-38.8],[-.6,-40],[1,-38],[.2,-34.4],[-3,-33.8]],facing===1?EDGE:SHADE,'transparent',0);
    line(b,[[1,-35],[4.2,-35]],INK,1);
    if(kind.ember){poly(b,[[1,-35],[5,-35],[4,-29],[1,-28]],'#5b5650');line(b,[[2,-33],[4,-33]],'#ba9d73',.65);}
    if(kind.elite){poly(b,[[-4,-35],[-3,-29],[-.5,-28],[1,-34]],SHADE); line(b,[[-1,-40],[-2,-45],[-7,-47],[-12,-46]],team,2);}
    else line(b,[[-5,-34],[-1,-35],[5,-34]],'#b4b8ab',1);
  } else if(kind.role==='worker'){
    poly(b,[[-4,-36],[-3,-40],[2,-40],[4,-36]],'#9f8556');
    poly(b,[[-7,-35],[-3,-37],[3,-36.7],[7,-34.5],[1,-33.5]],'#c2a46c');
  } else if(kind.role==='priest'){
    poly(b,[[-3.5,-35],[-3,-41],[0,-44],[3,-41],[4,-35]],kind.ember?'#9e7054':LINEN);
    line(b,[[0,-42],[0,-36]],'#ad9362',.8);
  } else {
    const cloth=clothOverride??(kind.role==='witch'?'#625666':darker(team,.28));
    poly(b,[[-5,-28],[-5,-37],[-1,-42],[3,-40],[5,-34],[3.7,-30],[2,-37],[-.5,-38],[-2.6,-35],[-2.3,-29]],cloth);
    line(b,[[-4.3,-36],[-1,-40],[2,-39]],lighter(cloth,.2),.8);
    if(kind.role==='witch') poly(b,[[-4,-40],[-2,-47],[2,-46],[1,-40]],cloth);
  }
}
function mount(b:Brush,team:string,phase:number,elite:boolean,facing:number){
  const coat=elite?'#85847b':'#685243';
  // Four different phase offsets, planted hind feet and flexed forelegs.
  for(const [x,off] of [[-17,0],[14,Math.PI],[-12,Math.PI],[19,0]]){
    const s=Math.sin(phase+off!)*5;
    seg(b,[x!,0],[x!+s*.4,8],2.6,darker(coat,.25),false);
    seg(b,[x!+s*.4,8],[x!+s,16-Math.max(0,s)*.4],2,coat,true);
    line(b,[[x!+s-1.5,17-Math.max(0,s)*.4],[x!+s+2,17-Math.max(0,s)*.4]],INK,2);
  }
  line(b,[[-22,-5],[-28,2],[-30,8]],'#35322d',3);
  poly(b,[[-24,-11],[-15,-17],[8,-16],[20,-10],[17,2],[-16,3],[-23,-2]],coat);
  poly(b,[[-20,-12],[-13,-15],[7,-14],[14,-10],[-14,-7]],lighter(coat,.2),'transparent',0);
  poly(b,[[10,-10],[13,-27],[20,-36],[25,-34],[26,-30],[33,-25],[33,-20],[28,-19],[23,-23],[23,-9]],coat);
  poly(b,[[14,-26],[20,-34],[21,-28],[17,-14]],facing===1?lighter(coat,.25):darker(coat,.2),'transparent',0);
  line(b,[[19,-33],[15,-26],[12,-15]],'#35322d',3);
  poly(b,[[20,-35],[20,-42],[24,-35]],coat);
  line(b,[[25,-27],[28,-26]],INK,1);
  line(b,[[25,-28],[28,-20],[33,-22]],'#b6a582',1);
  line(b,[[29,-22],[12,-17],[1,-16]],HIDE,1);
  poly(b,[[-17,-13],[6,-14],[11,-3],[7,8],[-16,6],[-20,1]],darker(team,.15));
  line(b,[[-17,4],[6,6],[9,0]],'#b5a176',1);
  if(elite){poly(b,[[21,-34],[25,-30],[26,-27],[23,-25],[19,-29]],STEEL);line(b,[[20,-33],[23,-30]],EDGE,1);}
}

export function paintFigure(b:Brush,kind:UnitKind,team:string,pose:UnitAnimationFrame,facing:1|-1,presentation:FigurePresentation={}):boolean{
  if(hasWarfareUnit(kind))return paintWarfareUnit(b,kind,team,pose);
  if(hasMercenaryModel(kind))return paintMercenary(b,kind,team,pose,facing,presentation);
 const base=figures[kind];if(!base)return paintCreature(b,kind,team,pose);
 const f=presentation.appearance?{...base,...presentation.appearance}:base;
  b.save();b.lineJoin='round';b.lineCap='round';
  const rig=sampleFigurePose(f,pose,presentation);
  const {motion,impact}=rig;
  const stride=motion.stride;
  const phase=pose.mode==='walk'?pose.frame*Math.PI/4:0;
  const robe=['priest','mage','witch'].includes(f.role);
  const armor=!!f.armor;
  const cloth=presentation.cloth??(f.role==='witch'?'#5d5061':f.role==='priest'?(f.ember?'#a78265':LINEN):darker(team,.13));
  if(f.mounted){mount(b,team,phase,!!f.elite,facing);b.translate(-3,-17);b.scale(.84,.84);}
  const bob=motion.lift+motion.breathe+rig.bodyDrop;
  if(!f.mounted){
    leg(b,[-3,-4+rig.bodyDrop],[-4-stride*3,5+rig.bodyDrop*.4],[-5-stride*5,16-Math.max(0,stride)*2.2],armor,false);
    leg(b,[3,-4+rig.bodyDrop],[5+stride*2,5+rig.bodyDrop*.4],[6+stride*5,16-Math.max(0,-stride)*2.2],armor,facing===1);
  }
  b.translate(impact*(f.mounted?.65:2),bob);
  b.translate(0,-4);b.rotate(rig.lean);b.translate(0,4); // Torso leans into the stroke while both feet stay planted.
  const flutter=stride*1.4+impact*2;
  if(robe||f.elite||f.role==='bow'){
    poly(b,[[-7,-25],[4,-25],[1,0],[-6+flutter,11],[-14+flutter,10],[-11,-7]],darker(cloth,.3));
    line(b,[[-8,-21],[-10,6],[-6+flutter,9]],lighter(cloth,.08),1);
  }
  paintEquipment(b,f,team,facing,rig,cloth,'back');
  if(rig.equipmentLayer==='back')presentation.detail?.(b,rig,'equipment');
  // Neck joins the jaw to the collar, including under the worker hat.
  poly(b,[[-2.2,-31],[2,-31],[2.5,-26],[-2.5,-26]],SKIN);
  // Pelvis, fitted torso and separate shoulder planes, rather than a trapezoid dress.
  poly(b,[[-6,-12],[6,-12],[7,-2],[3,1],[-6,-1]],HIDE);
  if(robe){
    poly(b,[[-6,-18],[6,-18],[7,0],[11+flutter,15],[3,16],[-2,13],[-10+flutter,15],[-7,-2]],cloth);
    poly(b,[[2,-15],[5,-14],[6,1],[9+flutter,14],[4,13]],darker(cloth,.3),'transparent',0);
    line(b,[[-4,-9],[-5,3],[-7+flutter,12]],lighter(cloth,.23),1);
    line(b,[[-8+flutter,14],[-2,12],[3,15],[9+flutter,14]],'#aa9472',.8);
  }
  poly(b,[[-7,-25],[-2,-28],[4,-27],[7,-23],[5,-10],[-5,-9],[-7,-17]],armor?STEEL:cloth);
  poly(b,[[1,-26],[6,-23],[5,-11],[1,-10]],armor?SHADE:darker(cloth,.3),'transparent',0);
  line(b,[[-5,-23],[-3,-25],[0,-25]],armor?EDGE:lighter(cloth,.3),1.2);
  if(armor){
    if(f.elite) { poly(b,[[-10,-27],[-4,-29],[-3,-22],[-10,-20]],f.ember?'#837563':STEEL);poly(b,[[4,-28],[10,-26],[11,-21],[5,-22]],SHADE); }
    poly(b,[[-8,-26],[-3,-25],[-4,-20],[-9,-21]],facing===1?EDGE:SHADE);
    line(b,[[-5,-16],[0,-14],[5,-16]],'#b2b5a7',.65);
    // Separate breastplate from the mail skirt; sparse metal links survive at 1x.
    for(let row=0;row<3;row++)for(let col=0;col<5;col++){
      const x=-4+col*1.8+(row%2)*.45,y=-13+row*1.25;
      line(b,[[x,y],[x+.6,y+.5],[x+1,y]],row%2?'#495653':'#bdbaa5',.45);
    }
    line(b,[[-4,-22],[-3,-18],[0,-16]],'#c8cbbb',.75);
    for(const x of [-3,3])ellipse(b,x,-18,.45,.5,'#d1c7a9');

    poly(b,[[-5,-10],[5,-10],[7,-2],[1,-3],[-5,-1]],darker(team,.1));
    for(const x of [-3,1,4])line(b,[[x,-9],[x+1,-3]],'#83938e',.5);
  }else if(f.role==='bow'||f.role==='worker'){
    poly(b,[[-5,-25],[-1,-26],[4,-11],[1,-10]],HIDE);
    line(b,[[-4,-24],[2,-12]],'#b29c77',.7);
  }
  line(b,[[-6,-10],[5,-10]],'#493f33',2.1);poly(b,[[-1,-11],[1,-11],[1,-9],[-1,-9]],'#b6a079');
  if(f.mounted)leg(b,[1,-5],[5,3],[6,12],armor,true);
  presentation.detail?.(b,rig,'body');
  face(b,f,team,facing,presentation.headwear,presentation.cloth);
  presentation.detail?.(b,rig,'head');
  paintEquipment(b,f,team,facing,rig,cloth,'front');
  if(rig.equipmentLayer==='front')presentation.detail?.(b,rig,'equipment');
  b.restore();return true;
}
