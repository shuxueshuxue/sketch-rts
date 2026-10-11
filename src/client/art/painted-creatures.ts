/** Non-human silhouettes use the same warm light, cool shadow and fine ink as
 * the soldiers. Anatomy and equipment remain legible at battlefield scale. */
import type { UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
import { sampleMotion, type MotionPose } from './motion';
import { type Brush, ellipse, line, darker, lighter } from './kit';

import { creatures } from './appearance';
import { paintRigidEquipment } from './equipment';
export const hasPaintedCreature = (kind: UnitKind) => !!creatures[kind];
/** Remains and story projections use actual anatomy rather than card labels. */
export function creatureAnatomy(kind: UnitKind): 'beast' | 'construct' | 'wood' | 'foot' | 'spirit' | undefined {
  const shape=creatures[kind]?.shape;
  return shape===undefined?undefined:shape==='stone'?'construct':shape==='wood'?'wood':shape==='ogre'||shape==='fish'?'foot':shape==='spirit'?'spirit':'beast';
}
export function creatureShadow(kind: UnitKind) {
  const def = creatures[kind];
  if (!def || def.shape === 'spirit') return undefined;
  const rx = def.shape === 'ogre' || def.shape === 'stone' || def.shape === 'wood' ? 22 : def.shape === 'fish' ? 18 : def.shape === 'spider' ? 29 : 31;
  return { rx: rx * (def.size ?? 1), ry: (def.shape === 'ogre' ? 5.5 : 5) * (def.size ?? 1), y: def.shape === 'ogre' ? 18 : (def.shape === 'stone' || def.shape === 'wood' ? 23 : 18) * (def.size ?? 1) };
}
const ink='#30312e';
import { creaturePlane as plane } from './materials';
function limb(b: Brush, points: number[][], color: string, width: number) {
  line(b,points,ink,width+1.3); line(b,points,color,width);
  line(b,points.map(([x,y])=>[x!-.7,y!-.6]),lighter(color,.2),Math.max(.7,width*.23));
}
export interface CreaturePresentation { color?: string; size?: number; crown?: boolean; detail?: (b: Brush, motion: MotionPose) => void }
/** Authored contact line, also used when normalizing custom story cast. */
export function creatureGround(kind: UnitKind, presentation: CreaturePresentation = {}): number {
  const def=creatures[kind];if(!def)return 18;
  if(def.shape==='ogre')return 18;
  return (def.shape==='stone'||def.shape==='wood'?23:18)*(presentation.size??def.size??1);
}
export function paintCreature(b: Brush, kind: UnitKind, team: string, pose: UnitAnimationFrame, presentation: CreaturePresentation = {}) {
  const def=creatures[kind]; if(!def) return false;
  const {shape}=def; const color=presentation.color??def.color, crown=presentation.crown??def.crown;
  const motion=sampleMotion(pose,'creature');
  const walk=motion.stride;
  const strike=pose.mode==='attack'?motion.reach:0;
  const casting=pose.mode==='cast'?motion.castGlow:0;
  const size = presentation.size ?? def.size ?? 1;
  b.save();
  if (shape === 'ogre') b.translate(0, 18 - 23 * size);
  b.scale(size,size);
  if(shape==='spider') {
    for(const side of [-1,1]) for(let i=0;i<4;i++) {
      const phase=walk*(i%2?1:-1)*3, thrust=i<2?strike*(2-i)*4:0;
      limb(b,[[side*6,-5+i*4],[side*(20+i*2)+thrust,-16+i*9+phase],[side*(31+i*2)+thrust,16+i*.3-strike*(i<2?7:0)]],darker(color,.18),1.5);
    }
    b.translate(0,motion.breathe*.6);
    ellipse(b,-8,-7,16,12,darker(color,.25),ink);
    plane(b,[[-23,-8],[-12,-20],[0,-17],[6,-7],[-8,2]],color);
    ellipse(b,9+strike*4,0,9,8,color,ink);
    for(const y of [-3,1]) ellipse(b,15+strike*4,y,1.1,1,'#c6b892');
    for(const side of [-1,1]) limb(b,[[15+strike*4,3+side*2],[23+strike*7,5+side*3],[22+strike*8,9+side*(2-strike*2)]],'#b6ac92',1.6);
    if(crown) line(b,[[-16,-13],[-8,-10],[-13,-6]],'#bba98a',1.5);
  } else if(shape==='stone'||shape==='wood'||shape==='ogre') {
    for(const side of [-1,1]) {
      const stride=side*walk*4;
      limb(b,[[side*9,-1],[side*12,9],[side*13+stride,20]],darker(color,.2),8);
      plane(b,[[side*13+stride-6,16],[side*13+stride+4,16],[side*13+stride+8,22],[side*13+stride-6,23]],color);
    }
    b.translate(0,motion.breathe);
    const grip:[number,number]=[24+strike*8,-1-strike*9-casting*11];
    for(const side of [-1,1])limb(b,[[side*17,-23],[side*23,-9],side===1?grip:[-24+strike*3,-1-casting*18]],color,9);
    plane(b,[[-20,-25],[-9,-33],[12,-32],[21,-20],[12,3],[-12,3]],color);
    plane(b,[[2,-30],[19,-22],[12,3],[2,0]],darker(color,.23));
    plane(b,[[-9,-43],[4,-46],[11,-38],[8,-27],[-7,-27],[-12,-35]],lighter(color,.05));
    line(b,[[-2,-35],[7,-35]],'#292d29',1.5);
    if(shape==='ogre'){
      plane(b,[[-3,-34],[1,-32],[5,-30],[3,-27],[-2,-28]],darker(color,.12));
      line(b,[[-5,-29],[5,-29]],'#4b4138',.8);
      for(const x of [-5,5]) plane(b,[[x-1,-27],[x,-32],[x+2,-27]],'#c7bfa6');
      line(b,[[-14,-19],[-4,-21],[0,-13],[8,-21],[16,-19]],lighter(color,.18),1.2);
      line(b,[[0,-10],[0,-2]],darker(color,.25),.8);
    }
    if(shape==='ogre') {
      plane(b,[[-13,-1],[12,-1],[18,11],[-16,11]],'#655747');
      paintRigidEquipment(b,def.weapon==='staff'?'staff':'club',grip,.32+motion.weaponAngle,casting);
      ellipse(b,grip[0],grip[1],3.8,3.2,color,ink);
      plane(b,[[-16,-23],[-7,-25],[-6,-15],[-16,-12]],team);
    } else for(let i=0;i<5;i++) line(b,[[-14+i*6,-24+i%2*4],[-9+i*5,-16],[-12+i*5,-8]],darker(color,.32),.7);
    if(crown) for(const x of [-7,0,7]) plane(b,[[x-3,-43],[x,-51],[x+3,-43]],'#b2a684');
  } else if(shape==='fish') {
    limb(b,[[-5,1],[-11,14],[-18,17]],color,4); limb(b,[[7,2],[13,12+walk*3],[22,14]],color,4);
    b.translate(0,motion.breathe);
    plane(b,[[-13,-23],[-7,-35],[5,-27],[15,-20],[11,4],[-8,6]],color);
    plane(b,[[-9,-22],[-20,-27],[-13,-8],[-18,0],[-8,5]],darker(color,.22));
    plane(b,[[6,-26],[23,-20],[27,-14],[9,-13]],lighter(color,.1));
    ellipse(b,16,-23,1.3,1.5,'#d8c9a5');
    const grip:[number,number]=[25+strike*2,-11-strike*7-casting*5];
    limb(b,[[9,-9],[19,-4],grip],color,3);
    if(def.weapon==='javelin'){
      if(strike<.7)paintRigidEquipment(b,'javelin',grip,.45+strike*.95+motion.weaponAngle);
      limb(b,[[-5,-12],[-10,-5],[-8,1]],color,3);
    }else{
      paintRigidEquipment(b,def.weapon==='staff'?'staff':'pike',grip,motion.weaponAngle,casting);
      limb(b,[[-5,-12],[-10,-5],[-8-casting*3,1-casting*12]],color,3);
    }
    ellipse(b,grip[0],grip[1],2.2,2,color,ink);
    if(crown) plane(b,[[-7,-33],[-8,-46],[3,-36],[10,-43],[9,-29]],'#a69f81');
  } else if(shape==='spirit') {
    b.translate(0,motion.breathe*2);
    for(let i=3;i>0;i--) ellipse(b,strike*5,-11,i*(6+strike*2),i*10,`rgba(185,198,188,${.07+i*.015+strike*.06})`);
    plane(b,[[-4+strike*4,-35],[7+strike*4,-34],[11+strike*12,-20],[6+strike*8,-5],[13,13],[0,7],[-8,17],[-5,-5],[-12,-17]],'#b6bfb0aa');
    line(b,[[-2+strike*4,-29],[3+strike*4,-29]],'#f4e8c9',1+strike);
  } else {
    const dragon=shape==='dragon', stag=shape==='stag', turtle=shape==='turtle';
    for(const side of [-1,1]) for(const x of [-17,16]) {
      const stride=walk*side*(x<0?-1:1)*5+side*2.5, brace=strike*(x<0?-3:5);
      limb(b,[[x,0],[x+stride+brace,10],[x+stride+4,18]],darker(color,side===1?.08:.27),turtle?4:3);
    }
    b.translate(0,motion.breathe*.7);
    plane(b,[[-28,-8],[-17,-18],[12,-18],[26,-7],[15,6],[-18,6]],color);
    plane(b,[[-24,-4],[3,-2],[23,-8],[15,6],[-18,6]],darker(color,.2));
    if(turtle) {
      plane(b,[[-27,-7],[-15,-25],[8,-27],[23,-14],[17,0],[-14,4]],'#686953');
      for(let i=0;i<4;i++) line(b,[[-17+i*9,-19],[-14+i*8,-7],[-18+i*9,2]],'#a6a58b',.8);
    }
    // Feet and shell stay planted while the neck reaches and the jaws snap.
    const neck=(stag?-27:dragon?-20:-13)+strike*(stag?11:turtle?-2:3);
    b.save(); b.translate(strike*(turtle?12:stag?8:7),0);
    plane(b,[[15,-8],[19,neck],[28,neck-5],[35,neck+1],[39,neck+5],[26,neck+10],[23,2]],color);
    if(!stag) {
      plane(b,[[29,neck+5],[39+strike*3,neck+5],[35+strike*3,neck+8+strike*4],[27,neck+9+strike*3]],darker(color,.18));
      line(b,[[30,neck+5],[39+strike*3,neck+5]],'#292d29',.9);
    }
    ellipse(b,30,neck+1,1,1,'#d3c49a');
    if(stag) for(const side of [-1,1]) {
      limb(b,[[24,neck-3],[24+side*8,neck-14],[25+side*14,neck-21]],'#b9b09a',1.5);
      limb(b,[[24+side*8,neck-14],[22+side*3,neck-21]],'#b9b09a',1.1);
    }
    b.restore();
    limb(b,[[-25,-4],[-36,-1],[-45,dragon?-12:6]],color,dragon?4:2);
    if(dragon) {
      const lift=walk*4+strike*6;
      for(const side of [-1,1]) {
        b.save(); if(side===-1)b.translate(12,-2);
        plane(b,[[-3,-11],[-20,-39-lift],[-43,-29],[-32,-16],[-27,-4],[-18,-14]],side===1?'#896451':'#5b5550');
        plane(b,[[-20,-39-lift],[-38,-29],[-31,-20],[-24,-21]],side===1?'#a18164':'#776a59');
        for(const tip of [[-43,-29],[-32,-16],[-27,-4]])line(b,[[-20,-39-lift],tip],side===1?'#c1a27a':'#93856d',.75);
        line(b,[[-3,-11],[-20,-39-lift],[-43,-29]],'#cfb28b',1.1);
        b.restore();
      }
      b.save();b.translate(strike*7,0);
      plane(b,[[24,neck+8],[35,neck+5],[31,neck+12],[23,2]],'#b39a73');
      line(b,[[30,neck+3],[35,neck+3]],'#e1bc6d',1.1);
      for(const x of [24,29])plane(b,[[x,neck-1],[x-6,neck-10],[x+2,neck-3]],'#c3b798');
      b.restore();
      for(let i=0;i<5;i++)plane(b,[[-22+i*7,-16],[-25+i*7,-24+i*.5],[-17+i*7,-16]],'#b29f7d');
      for(const x of [-15,20])for(let i=0;i<3;i++)line(b,[[x+i*2,16],[x+i*2+2,19]],'#d2c5a4',.9);
      if(crown)line(b,[[19,-19],[23,-16],[24,-10]],'#d3ac6e',1);

    }
  }
  if(casting){
    b.save();b.globalAlpha*=casting;
    ellipse(b,shape==='fish'?25:0,-34,6+casting*5,7+casting*3,'#d8dcc144');
    line(b,[[-6,-35],[0,-43],[6,-35]],'#e6d9ad',.8);b.restore();
  }
  presentation.detail?.(b,motion);
  b.restore(); return true;
}
