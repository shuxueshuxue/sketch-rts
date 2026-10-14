/** The three hired companies have their own authored bodies and costumes.
 * Only compatible contact drawings and rigid equipment are shared with troops. */
import type { MercenaryUnitKind, UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
import { figures, type Figure } from './appearance';
import { arm, boot, hand } from './body-parts';
import type { CorpsePresentation } from './corpses';
import { paintEquipmentAsset, shield } from './equipment';
import { type Brush, type XY, darker, lighter, line, ellipse, polygon } from './kit';
import { INK, SKIN, HIDE, paintedPlane as plane, segment } from './materials';
import { sampleFigurePose, type FigurePose, type FigurePresentation } from './rig';

export function hasMercenaryModel(kind: UnitKind): kind is MercenaryUnitKind {
  return kind === 'mercenary' || kind === 'contractArcher' || kind === 'fieldMedic';
}

const IRON = '#737c76', IRON_SHADOW = '#444e4c', LEATHER = '#756044';
const LINEN = '#c5b89a', LINEN_SHADOW = '#908a76', HAIR = '#55483a';

function companyShield(b: Brush, grip: XY, team: string, facing: 1 | -1) {
  const [x, y] = grip;
  plane(b, [[x-8,y-11],[x-4,y-13],[x+4,y-12],[x+8,y-8],[x+7,y+6],[x,y+12],[x-7,y+7]], '#918366', INK, .8);
  plane(b, [[x-6,y-9],[x-3,y-11],[x+3,y-10],[x+6,y-7],[x+5,y+5],[x,y+10],[x-5,y+6]], darker(team,.23));
  plane(b, [[x-6,y-2],[x+5,y-7],[x+6,y-2],[x-5,y+4]], '#c9b994', 'transparent', 0);
  line(b, [[x-6,y-8],[x-6,y+5],[x,y+10]], facing===1?'#c4bca4':'#6c6855', .9);
  line(b, [[x-3,y+5],[x+2,y+3]], '#41463d', .8);
  ellipse(b,x,y,1.9,2.2,IRON,INK);
  for(const [a,z] of [[-5,-8],[5,-6],[-4,5],[3,5]])ellipse(b,x+a!,y+z!,.45,.5,'#d0c5a6');
}

/** The artist owns costume and overlap here; the exact sampled wrist, release
 * and weapon axis are the same ones used by shots and weapon blood surfaces. */
function equipment(b: Brush, kind: MercenaryUnitKind, f: Figure, team: string, facing: 1 | -1,
  rig: FigurePose, cloth: string, layer: 'back' | 'front') {
  const sleeve=kind==='mercenary'?darker(cloth,.15):cloth;
  if(layer===rig.primaryLayer)arm(b,rig.shoulder,rig.elbow,rig.wrist,sleeve,!!f.armor,layer==='front');
  if(layer===rig.equipmentLayer){paintEquipmentAsset(b,f,rig);hand(b,rig.wrist);}
  if(layer==='front'){
    arm(b,rig.supportShoulder,rig.supportElbow,rig.support,sleeve,!!f.armor,true);
    if(rig.shield){
      if(rig.shieldStyle==='round')shield(b,...rig.support,team,false,facing,true);
      else companyShield(b,rig.support,team,facing);
    }else hand(b,rig.support);
  }
}

function legs(b: Brush, kind: MercenaryUnitKind, stride: number, drop: number, facing: 1 | -1) {
  const near=kind==='mercenary'?'#726954':kind==='contractArcher'?'#7a7459':'#645d50';
  const far=darker(near,.23);
  for(const [side,hip,knee,foot] of [
    [-1,[-3,-4+drop],[-4-stride*3,5+drop*.4],[-5-stride*5,16-Math.max(0,stride)*2.2]],
    [1,[3,-4+drop],[5+stride*2,5+drop*.4],[6+stride*5,16-Math.max(0,-stride)*2.2]],
  ] as const){
    const lit=side===facing, color=lit?near:far;
    segment(b,[...hip],[...knee],4.7,color,lit);
    segment(b,[...knee],[foot[0],foot[1]-3],3.8,kind==='mercenary'?IRON_SHADOW:'#4d4b3f',lit);
    if(kind==='mercenary'){
      plane(b,[[knee[0]-2.2,knee[1]-1.3],[knee[0]+1.6,knee[1]-2],[knee[0]+2.1,knee[1]+2.2],[knee[0]-1.8,knee[1]+3]],lit?IRON:IRON_SHADOW);
      line(b,[[knee[0]-1.5,knee[1]+4],[foot[0]-.7,foot[1]-4]],'#a69f83',.65);
    }else{
      for(const y of [1,3.3,5.5]){
        const t=y/7, x=knee[0]+(foot[0]-knee[0])*t;
        line(b,[[x-1.8,knee[1]+y],[x+1.5,knee[1]+y-.5]],kind==='fieldMedic'?'#999078':'#afa383',.65);
      }
    }
    boot(b,...foot);
  }
}

function face(b: Brush, kind: MercenaryUnitKind, facing: 1 | -1, headwear: boolean) {
  // Small, angled human faces; the nose and jaw carry the reading at game size.
  plane(b,[[-3.2,-36],[-1.3,-39.1],[1.8,-38.5],[3.3,-35.3],[4.9,-34.3],[3.5,-33.3],[3.1,-30.4],[.3,-29.1],[-2.8,-31.1]],SKIN);
  plane(b,[[1.2,-37],[3.2,-35.2],[4.9,-34.3],[3.5,-33.3],[3.1,-30.4],[.5,-29.8]],facing===1?'#987259':'#7d614f','transparent',0);
  line(b,[[2,-35.5],[3.5,-35.2]],'#35322d',.55);
  line(b,[[1.2,-31.7],[3.1,-31.2]],'#725744',.45);
  if(kind==='mercenary'){
    plane(b,[[-2,-31.9],[.3,-30.4],[3,-31],[2.7,-28.9],[.1,-28.3],[-2,-30]],'#665543','transparent',0);
    if(headwear){
      plane(b,[[-5.4,-33.7],[-4.6,-39.2],[-1.6,-42],[2.5,-41.2],[4.2,-38.3],[4.9,-35.8],[1.7,-36.1],[-.9,-34.8]],IRON);
      plane(b,[[-4.1,-38.7],[-1.5,-40.7],[.2,-39.7],[-.5,-36],[-4.7,-34.6]],facing===1?'#a7aea0':IRON_SHADOW,'transparent',0);
      plane(b,[[-5.3,-34.8],[-1.8,-33.7],[-2.3,-29.5],[-4.3,-30.4]],IRON_SHADOW);
      line(b,[[-4,-39],[-.9,-41],[2.2,-40.4]],'#c7c4af',.7);
      line(b,[[1,-39],[2.9,-38.1]],'#444d48',.6);
    }
  }else{
    plane(b,[[-4,-33.1],[-4.2,-38],[-2,-40.2],[1.3,-40.1],[3.1,-38],[.2,-38.3],[-1.4,-34.6],[-1.4,-31.6]],HAIR);
    if(headwear&&kind==='contractArcher'){
      plane(b,[[-6.8,-37.7],[-4.6,-42],[-.3,-43.1],[3.7,-40.3],[3.8,-37.5]],'#686951');
      plane(b,[[-8,-36.8],[-5.1,-38.8],[3.6,-38.8],[7.2,-36.9],[3.8,-35.6],[-2.5,-36.1]],'#919077');
      line(b,[[-4.5,-41.7],[.2,-42.1],[3,-40.3]],'#b4aa87',.65);
      line(b,[[-4,-38.8],[3.4,-38.4]],'#484d40',1);
      plane(b,[[-5,-39],[-5,-42.5],[-7.8,-44.2],[-7.1,-39.6]],'#b6ab8b');
    }else if(headwear){
      plane(b,[[-4.5,-37.1],[-2.6,-40.3],[.3,-41.1],[3.3,-38.9],[3.3,-36.7]],LINEN);
      line(b,[[-3.9,-37.3],[3.3,-36.9]],'#ded0ae',1.2);
      plane(b,[[-4.2,-37.4],[-5.7,-36.1],[-7.7,-30.6],[-5.1,-31.5],[-3.7,-35.9]],LINEN_SHADOW);
    }
  }
}

function swordsmanBody(b: Brush, team: string, cloth: string, flutter: number) {
  plane(b,[[-8,-26],[-3,-29],[4,-27],[1,-14],[-8+flutter,3],[-16+flutter,1],[-13,-13]],darker(team,.33));
  line(b,[[-10,-22],[-12,-4],[-9+flutter,1]],lighter(team,.06),.8);
  plane(b,[[-7,-25],[-2,-28],[4,-27],[7,-23],[5,-10],[-5,-9],[-7,-17]],LEATHER);
  plane(b,[[.5,-26],[6,-23],[5,-12],[.8,-11]],'#514b3b','transparent',0);
  // Overlapping brigandine plates, rather than the regular troop breastplate.
  for(const [x,y,w] of [[-5,-23,4.5],[.6,-23,4.4],[-4.5,-18,4.5],[.7,-18,4.1]]){
    plane(b,[[x!,y!],[x!+w!,y!+.6],[x!+w!-.2,y!+3.8],[x!-.3,y!+3.2]],IRON);
    line(b,[[x!+.4,y!+.3],[x!+w!-.5,y!+.6]],'#abb0a0',.55);
    ellipse(b,x!+.8,y!+1.6,.35,.4,'#c0b594');
  }
  plane(b,[[-9,-27],[-5,-28.5],[-1,-26],[-2,-22],[-8,-23]],cloth);
  line(b,[[-8,-26],[-3,-25]],'#c3b393',.9);
  plane(b,[[-6,-10],[5,-10],[7,-1],[2,1],[-5,0],[-8,-2]],'#7b6950');
  for(const x of [-5,-1,3])line(b,[[x,-8],[x+1,-1]],'#c0ad88',.7);
  line(b,[[-6,-10],[5,-10]],'#423c30',2.3);
  plane(b,[[0,-11],[2,-11],[2,-9],[0,-9]],'#b5a071');
  plane(b,[[5,-12],[8,-11],[8,-4],[5,-3]],HIDE);
  line(b,[[5.7,-11],[7.5,-10]],'#bb9b75',.6);
}

function archerBody(b: Brush, team: string, cloth: string, flutter: number) {
  // A low shoulder wrap and a split travelling coat, distinct from a hooded archer.
  plane(b,[[-10,-26],[-5,-29],[4,-28],[6,-21],[-3,-20],[-9,-13],[-14,-15]],darker(team,.3));
  line(b,[[-10,-24],[-5,-26],[1,-25]],lighter(team,.1),.8);
  plane(b,[[-6,-22],[4,-23],[6,-11],[8+flutter,9],[2+flutter*.4,10],[0,-4],[-4,11],[-10+flutter,9],[-7,-6]],LEATHER);
  plane(b,[[1,-20],[4,-21],[5,-8],[7+flutter,8],[3,8],[.2,-3]],'#534d3b','transparent',0);
  plane(b,[[-7,-25],[-2,-28],[4,-27],[7,-23],[5,-10],[-5,-9],[-7,-17]],cloth);
  plane(b,[[1,-26],[6,-23],[5,-11],[1,-10]],darker(cloth,.23),'transparent',0);
  line(b,[[-5,-23],[-1,-25],[2,-24]],lighter(cloth,.25),.8);
  plane(b,[[-5,-27],[-2,-28],[5,-12],[2,-11]],'#514535');
  line(b,[[-3.8,-26],[3,-12]],'#b3a17b',.8);
  line(b,[[-6,-10],[5,-10]],'#423c30',2);
  plane(b,[[3,-9],[10,-8],[10,-2],[7,1],[3,-1]],'#8c7654');
  plane(b,[[3,-9],[10,-8],[9,-5],[4,-5]],'#a39168');
  ellipse(b,7,-5.5,.5,.55,'#d4be89');
}

function medicBody(b: Brush, team: string, cloth: string, flutter: number) {
  plane(b,[[-9,-25],[-4,-28],[4,-27],[4,-14],[-2,4],[-12+flutter,3],[-12,-15]],darker(team,.36));
  plane(b,[[-7,-25],[-2,-28],[4,-27],[7,-23],[5,-13],[8+flutter,8],[3,10],[0,-3],[-3,10],[-9+flutter,8],[-6,-9]],cloth);
  plane(b,[[1,-26],[6,-23],[4,-9],[7+flutter,7],[3,8],[.8,-4]],darker(cloth,.25),'transparent',0);
  line(b,[[-5,-24],[-3,-26],[-1,-23],[-1,-13]],'#e3d4b1',.9);
  plane(b,[[-4,-12],[4,-12],[5,5],[1,7],[-5,5]],'#80745d');
  line(b,[[-3,-10],[-3,4],[1,5]],'#b3a389',.75);
  line(b,[[-6,-12],[5,-12]],'#514737',1.8);
  // Working satchel and stoppered bottles identify a field healer at small size.
  plane(b,[[-5,-26],[-3,-27],[6,-12],[4,-11]],HIDE);
  line(b,[[-4,-25],[5,-12]],'#b5a181',.7);
  plane(b,[[4,-11],[11,-10],[12,-4],[9,0],[4,-2]],'#73533e');
  plane(b,[[4,-11],[11,-10],[11,-7],[5,-7]],'#967354');
  line(b,[[6,-8],[9,-8]],'#d1b995',.8);
  line(b,[[7.5,-9.5],[7.5,-6.5]],'#d1b995',.8);
  for(const [x,y] of [[-6,-8],[-3,-7]]){
    plane(b,[[x!-.8,y!-1],[x!+.6,y!-1],[x!+1.2,y!+3],[x!-.9,y!+3]],'#a7aea1');
    line(b,[[x!-.6,y!-1.5],[x!+.6,y!-1.5]],'#6c5540',1.2);
  }
}

export function paintMercenary(b: Brush, kind: MercenaryUnitKind, team: string,
  pose: UnitAnimationFrame, facing: 1 | -1, presentation: FigurePresentation = {}) {
  const base=figures[kind]!, f=presentation.appearance?{...base,...presentation.appearance}:base;
  const rig=sampleFigurePose(f,pose,presentation),stride=rig.motion.stride;
  const cloth=presentation.cloth??(kind==='fieldMedic'?LINEN:kind==='contractArcher'?'#827a60':darker(team,.25));
  b.save();b.lineJoin='round';b.lineCap='round';
  legs(b,kind,stride,rig.bodyDrop,facing);
  b.translate(rig.impact*2,rig.motion.lift+rig.motion.breathe+rig.bodyDrop);
  b.translate(0,-4);b.rotate(rig.lean);b.translate(0,4);
  const flutter=stride*1.4+rig.impact*2;
  if(kind==='contractArcher'){
    plane(b,[[-12,-28],[-7,-29],[-5,-13],[-10,-11]],'#574b36');
    plane(b,[[-12,-27],[-8,-28],[-7,-22],[-11,-21]],'#9b8660');
    for(const [x,y] of [[-11,-32],[-8,-34],[-6,-31]]){
      line(b,[[x!,y!],[x!+3,-16]],'#bcae89',.65);
      plane(b,[[x!-1.1,y!-2],[x!+.5,y!-4],[x!+1,y!+2]],'#c7bb97',INK,.35);
    }
  }
  equipment(b,kind,f,team,facing,rig,cloth,'back');
  plane(b,[[-2.2,-31],[2,-31],[2.5,-26],[-2.5,-26]],SKIN);
  if(kind==='mercenary')swordsmanBody(b,team,cloth,flutter);
  else if(kind==='contractArcher')archerBody(b,team,cloth,flutter);
  else medicBody(b,team,cloth,flutter);
  presentation.detail?.(b,rig,'body');
  face(b,kind,facing,presentation.headwear!==false);
  presentation.detail?.(b,rig,'head');
  equipment(b,kind,f,team,facing,rig,cloth,'front');
  presentation.detail?.(b,rig,'equipment');
  b.restore();return true;
}

/** Costume-specific low remains. Dropped rigid weapons are added by corpses.ts;
 * captured equipment and historical defaults use the existing corpse contract. */
export function paintMercenaryRemains(b: Brush, kind: MercenaryUnitKind, options: CorpsePresentation) {
  const ink='#555247',wash=options.cloth??(kind==='fieldMedic'?'#a29a84':kind==='contractArcher'?'#8b866f':'#85816f');
  const patch=(points:number[][],fill=wash)=>{polygon(b,points,fill,ink,.65);line(b,[points[1]!,points[2]!],'#c0b8a466',.55);};
  const limb=(points:number[][],width=3)=>{line(b,points,ink,width+.8);line(b,points,'#929082',width);};
  limb([[-7,-1],[-13,2],[-15,7]],2.5);
  patch([[-9,-5],[-2,-7],[9,-2],[11,4],[4,7],[-8,2]]);
  if(kind==='mercenary'){
    patch([[-7,-5],[-1,-6],[6,-3],[5,3],[-2,3]],'#777d72');
    for(const x of [-4,0,3])line(b,[[x,-4],[x+1,1]],'#b1ae97',.55);
    patch([[2,4],[11,3],[16,7],[7,9]],'#77715e');
  }else{
    patch([[0,-5],[12,-2],[16,4],[12,9],[7,7],[5,3]],wash);
    patch([[8,-1],[14,0],[16,4],[12,5],[8,3]],kind==='fieldMedic'?'#826f58':'#817358');
  }
  limb([[8,4],[16,5],[24,3]],3.4);limb([[7,6],[14,10],[22,10]],3);
  patch([[-9,-4],[-11,-7],[-16,-7],[-19,-4],[-17,0],[-12,1]],'#aaa594');
  if(options.headwear!==false){
    if(kind==='mercenary')patch([[-20,-5],[-17,-10],[-12,-9],[-10,-6],[-15,-4]],'#8b9186');
    else if(kind==='contractArcher'){
      patch([[-20,-6],[-18,-10],[-14,-11],[-11,-8],[-12,-5]],'#858570');
      patch([[-22,-4],[-19,-6],[-12,-6],[-8,-3],[-15,-2]],'#a39c81');
    }else{line(b,[[-19,-6],[-16,-8],[-12,-7]],'#c0b8a2',2);patch([[-18,-6],[-23,-1],[-21,1],[-17,-3]],'#a69f89');}
  }
  limb([[-5,-3],[1,0],[-1,6]],2.5);
  const visibleShield=options.shield??kind==='mercenary';
  if(visibleShield){
    if(options.shieldStyle==='round'){ellipse(b,-3,11,7,4.5,'#6b6c60',ink);ellipse(b,-3,11,2,1.4,'#aaa594',ink);}
    else{patch([[-11,7],[-6,5],[2,8],[3,12],[-3,16],[-10,13]],'#7e806c');line(b,[[-9,11],[1,8]],'#b5ad91',1.6);ellipse(b,-4,10,1.5,1.1,'#929082',ink);}
  }
  if(kind==='contractArcher')for(const x of [12,15])line(b,[[x,-2],[x+6,7]],'#b6ae94',.55);
  if(kind==='fieldMedic'){ellipse(b,14,6,1.2,2,'#a4ad9a',ink);line(b,[[13.4,4],[14.6,4]],'#76634c',.8);}
}
