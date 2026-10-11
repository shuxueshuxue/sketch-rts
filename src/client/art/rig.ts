import type { UnitAnimationFrame } from '../unit-animation';
import type { Brush, XY } from './kit';
import { sampleMotion, actionDirection, type MotionFamily } from './motion';
import { figures, creatures, type Figure } from './appearance';
import type { UnitKind } from '../../shared/types';
import type { EquipmentKind } from './equipment';
// Lift, wind up, strike, follow through, recover, ready. The tool remains in
// the worker's hand; only the upper body moves during a work stroke.
const WORK_POSES: {lean:number;wrist:XY;tool:number}[] = [
  {lean:.025,wrist:[10,-24],tool:-.35}, {lean:-.025,wrist:[10,-29],tool:-.7},
  {lean:.1,wrist:[16,-14],tool:.9}, {lean:.14,wrist:[16,-12],tool:1.2},
  {lean:.09,wrist:[14,-16],tool:.45}, {lean:.035,wrist:[11,-20],tool:-.1},
];

/** Presentation overrides are deliberately absent from simulation Unit state. */
export interface FigurePresentation {
  weapon?: EquipmentKind; motion?: MotionFamily; shield?: boolean; shieldStyle?:'round'|'kite';
  appearance?: Partial<Figure>; cloth?: string; headwear?: boolean;
  detail?: (b: Brush, rig: FigurePose, stage: 'body' | 'head' | 'equipment') => void;
}
export function defaultEquipment(f: Figure): EquipmentKind {
  if(f.weapon)return f.weapon;
  return f.role === 'sword' ? 'sword' : f.role === 'axe' ? 'axe' : f.role === 'pike' ? 'pike'
    : f.role === 'bow' ? 'bow' : f.role === 'worker' ? 'pick' : f.role === 'priest' ? 'crozier' : 'staff';
}
/** The source unit of an issued weapon may have a compatible nonhuman body. */
export function equipmentForKind(kind: UnitKind): EquipmentKind | undefined {
  const figure=figures[kind];return figure?defaultEquipment(figure):creatures[kind]?.weapon;
}
export function equipmentFamily(weapon: EquipmentKind): MotionFamily {
  return weapon === 'pike' || weapon === 'pitchfork' || weapon === 'javelin' || weapon === 'sling' ? 'thrust' : weapon === 'bow' ? 'bow' : weapon === 'staff' || weapon === 'crozier' ? 'staff' : weapon === 'pick' ? 'work' : 'slash';
}
export function socketPoint(grip: XY, angle: number, x: number, y: number): XY {
  return [grip[0]+Math.cos(angle)*x-Math.sin(angle)*y,grip[1]+Math.sin(angle)*x+Math.cos(angle)*y];
}
/** Projected joints are drawing coordinates, not fixed anatomical lengths.
 * Each weapon owns its silhouette. The renderer consumes it without solving
 * or correcting the artist's elbow, wrist or overlap choices. */
type HandDrawing = { wrist: XY; elbow: XY; angle: number };
const mix=(a:XY,b:XY,t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const blend=(a:HandDrawing,b:HandDrawing,t:number):HandDrawing=>({
 wrist:mix(a.wrist,b.wrist,t),elbow:mix(a.elbow,b.elbow,t),angle:a.angle+(b.angle-a.angle)*t,
});
const hand=(wrist:XY,elbow:XY,angle:number):HandDrawing=>({wrist,elbow,angle});

// These are projected drawings: near-horizontal forearms can be short, and
// rear upper arms disappear behind the breastplate. Never infer an elbow from
// a grip distance. Contact poses are authored independently for each tool.
function bladeDrawing(weapon:EquipmentKind,source:number,variant:number,thrust:boolean){
 const ready=hand([12,-12],[10,-17],weapon==='axe'?.15:weapon==='pick'?.24:.32);
 const contacts=[hand([17,-27],[10,-21],.52),hand([19,-17],[10,-18],ready.angle+1.45),hand([14,-24],[10,-20],2.65)];
 const contact=contacts[source+1]!;
 if(thrust){contact.wrist[0]+=3;contact.elbow[0]+=2;contact.angle-=.15;}
 if(variant===1){contact.wrist[1]-=2;contact.angle-=.2;}
 if(variant===2){contact.wrist[0]-=2;contact.elbow[1]+=1;contact.angle+=.12;}
 return {ready,contact};
}
function shaftDrawing(mounted:boolean,source:number){
 const ready=mounted?hand([9,-16],[7,-17],-.2):hand([8,-19],[7,-17],-.95);
 const contact=(mounted?
  [hand([18,-25],[11,-22],-Math.PI/3),hand([12,-16],[8,-17],-.04),hand([19,-15],[11,-18],Math.PI/3)]:
  [hand([18,-25],[10,-22],-Math.PI/3),hand([13,-19],[8,-17],-.4),hand([19,-15],[10,-18],Math.PI/3)])[source+1]!;
 return {ready,contact};
}
function bowDrawing(source:number){
 return {ready:hand([18,-21],[10,-21],0),contact:[
  hand([16,-30],[10,-25],-Math.PI/3),hand([18,-21],[10,-21],0),hand([17,-13],[10,-17],Math.PI/3),
 ][source+1]!};
}
function staffDrawing(source:number,casting:boolean){
 // A caster carries and invokes a staff; it is not a rifle pointed downrange.
 return {ready:hand([12,-12],[10,-17],0),contact:[
  hand([13,-20],[10,-22],.12),hand([14,-15],[10,-19],.08),hand([14,-12],[10,-17],-.12),
 ][source+1]!,strength:casting?1:.65};
}
/** One authored drawing supplies both render passes and release/equipment sockets. */
export function sampleFigurePose(f: Figure, pose: UnitAnimationFrame, options: FigurePresentation = {}) {
 const weapon=options.weapon??defaultEquipment(f),family=equipmentFamily(weapon),requested=options.motion;
 const compatible=requested===family||((family==='slash'||family==='thrust')&&(requested==='slash'||requested==='thrust'));
 const motion=sampleMotion(pose,compatible?requested:family),direction=actionDirection(pose);
 const working=weapon==='pick'&&pose.mode==='work',work=working?WORK_POSES[pose.frame]:undefined;
 const impact=pose.mode==='attack'?motion.reach:0,cast=pose.mode==='cast'?motion.castGlow:0;
 const shaft=weapon==='pike'||weapon==='pitchfork',staff=weapon==='staff'||weapon==='crozier';
 const shield=weapon!=='greatSword'&&weapon!=='bow'&&weapon!=='pick'&&(options.shield??(weapon==='sword'||shaft&&(!!f.mounted||!!f.elite)));
 const supported=weapon==='bow'||weapon==='greatSword'||weapon==='pick'||shaft&&!shield;
 const variant=Math.abs(Math.trunc(pose.variant??0))%3;
 let drawing:HandDrawing;
 let weight=pose.mode==='attack'?motion.reach:0;
 const source=direction.source;
 if(staff){
  const authored=staffDrawing(source,cast>0);weight=(cast||impact)*authored.strength;
  drawing=blend(authored.ready,authored.contact,weight);
  drawing.angle+=(pose.mode==='attack'?[0,-.08,.09][variant]!:0)*weight;
 }else if(weapon==='bow'){
  const authored=bowDrawing(source);weight=pose.mode==='attack'?([1,.76,.48,.24,.08,0][pose.frame]??0):0;
  drawing=blend(authored.ready,authored.contact,weight);
  drawing.angle+=direction.correction*weight;
 }else if(shaft){
  const authored=shaftDrawing(!!f.mounted,source);drawing=blend(authored.ready,authored.contact,weight);
  drawing.angle+=direction.correction*weight;
 }else if(weapon==='none'||weapon==='sling'||weapon==='javelin'){
  const ready=hand(weapon==='none'?[8,-3]:[12,-12],[7,-14],weapon==='javelin'?.45:0);
  const contact=[hand([13,-34],[8,-25],-.4),hand([24,-20],[13,-20],1.4),hand([17,-9],[9,-15],2.2)][source+1]!;
  drawing=blend(ready,contact,weight);
 }else{
  const authored=bladeDrawing(weapon,source,variant,requested==='thrust');
  drawing=blend(authored.ready,authored.contact,weight);
  drawing.angle+=direction.correction*weight;
 }
 if(work)drawing=hand(work.wrist,[7,-22],work.tool);
 if(cast&&shield){
  // A shield arm stays braced. Invoke with the weapon hand instead of moving
  // the entire shield through the face as though it were an empty palm.
  drawing.wrist=mix(drawing.wrist,([[12,-27],[16,-21],[14,-15]] as XY[])[source+1]!,cast);
  drawing.elbow=mix(drawing.elbow,([[8,-22],[10,-20],[9,-17]] as XY[])[source+1]!,cast);
  drawing.angle-=.18*cast;
 }
 const action=Math.max(0,cast||weight);
 const lean=work?.lean??source*action*(shaft?.075:weapon==='bow'?.065:staff?.045:.04);
 const bodyDrop=source>0?action*(shaft?1.2:.65):0;
 // Keep the drawn shaft/arrow axis aimed while the body shifts under it.
 if(shaft||weapon==='bow')drawing.angle-=lean;
 // Cast with the free hand while retaining the weapon's own carry silhouette.
 // Staff poses additionally raise the staff; no sword-slash pose is reused.
 const freeReady:XY=shield?[-9,-10]:staff?[-13,-12]:[-9,-8];
 const freeElbow:XY=[-10,-15];
 const spellHands:XY[]=[[12,-34],[16,-22],[14,-8]];
 const spellElbows:XY[]=[[0,-25],[-3,-20],[-1,-15]];
 const gesture=shield?0:cast||(staff?Math.max(0,impact)*.55:0);
 let support=mix(freeReady,spellHands[source+1]!,gesture);
 let supportElbow=mix(freeElbow,spellElbows[source+1]!,gesture);
 const {wrist,elbow,angle}=drawing;
 if(supported){
  const sx=weapon==='bow'?-3-motion.bowDraw*9:weapon==='greatSword'||weapon==='pick'?0:-9;
  const sy=weapon==='greatSword'?5:weapon==='pick'?-4:0;
  support=socketPoint(wrist,angle,sx,sy);
  // Authored supporting elbows follow the contact drawing, never an IK branch.
  const readyElbow:XY=weapon==='bow'?[-.4,-18]:shaft?[-3,-15]:[0,-16];
  const contactElbows:XY[]=weapon==='bow'?[[-1,-26],[1,-18],[-1,-13]]:
   shaft?[[0,-20],[-2,-16],[0,-14]]:[[-2,-24],[2,-17],[-2,-20]];
  supportElbow=mix(readyElbow,contactElbows[source+1]!,weight);
  if(cast){support=mix(support,spellHands[source+1]!,cast);supportElbow=mix(supportElbow,spellElbows[source+1]!,cast);}
 }
 const release=socketPoint(wrist,angle,shaft?48:weapon==='bow'?16:0,staff?-23:shaft||weapon==='bow'?0:-31);
 return {weapon,shieldStyle:options.shieldStyle??'kite',shield,motion,impact,cast,working,wrist,angle,
  lean,bodyDrop,shoulder:[5,-23] as XY,elbow,support,supportShoulder:[-5,-23] as XY,supportElbow,
  twoHanded:supported&&!cast,release,direction,
  // Independent layering: a hidden upper arm must not hide the held weapon.
  primaryLayer:shaft||weapon==='bow'?'front' as const:'back' as const,
  equipmentLayer:'front' as 'front'|'back'};
}
export type FigurePose = ReturnType<typeof sampleFigurePose>;
