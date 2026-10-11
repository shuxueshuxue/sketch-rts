/** Entry points shared by live cards, portraits, story models and release events. */
import type { UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
import type { Brush } from './kit';
import type { MotionPose } from './motion';
import { creatures } from './appearance';
import { creatureDrawing, type CreatureDrawing } from './creature-poses';
import { paintCreatureBody } from './creature-painters';
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
export interface CreaturePresentation {
 color?:string;size?:number;crown?:boolean;
 detail?:(b:Brush,motion:MotionPose,drawing:CreatureDrawing)=>void;
}
/** Authored contact line, also used when normalizing custom story cast. */
export function creatureGround(kind: UnitKind, presentation: CreaturePresentation = {}): number {
  const def=creatures[kind];if(!def)return 18;
  if(def.shape==='ogre')return 18;
  return (def.shape==='stone'||def.shape==='wood'?23:18)*(presentation.size??def.size??1);
}
export function creatureReleaseSocket(kind:UnitKind,frame:UnitAnimationFrame,presentation:CreaturePresentation={}){
 const def=creatures[kind];if(!def)return undefined;
 const drawing=creatureDrawing(def.shape,def.weapon,frame),size=presentation.size??def.size??1;
 return{x:drawing.release[0]*size,y:(drawing.release[1]+drawing.bob)*size+(def.shape==='ogre'?18-23*size:0),ground:creatureGround(kind,presentation)};
}
export function paintCreature(b:Brush,kind:UnitKind,team:string,frame:UnitAnimationFrame,presentation:CreaturePresentation={}){
 const def=creatures[kind];if(!def)return false;
 const size=presentation.size??def.size??1,drawing=creatureDrawing(def.shape,def.weapon,frame);
 b.save();if(def.shape==='ogre')b.translate(0,18-23*size);b.scale(size,size);
 paintCreatureBody(b,{kind,shape:def.shape,color:presentation.color??def.color,team,crown:presentation.crown??!!def.crown,weapon:def.weapon},drawing);
 presentation.detail?.(b,{...drawing.motion,reach:drawing.strike},drawing);
 b.restore();return true;
}
