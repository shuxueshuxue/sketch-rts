/** Pure presentation offsets. The caller locks these to a release event's origin;
 * moving a unit, changing its order or a later equipment swap cannot move a shot. */
import type { UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
import type { UnitModel } from '../../story/cast';
import { unitGlyphScale } from '../glyphs';
import { figures } from './appearance';
import { solveFigureRig, type FigurePresentation } from './rig';
import { creatureReleaseSocket } from './painted-creatures';

/** Authored coordinates before facing mirror. ground is the local foot line. */
export type ArtReleaseSocket={x:number;y:number;ground:number};
export function figureReleaseSocket(kind:UnitKind,pose:UnitAnimationFrame,presentation:FigurePresentation={},size=1):ArtReleaseSocket|undefined {
 const base=figures[kind];if(!base)return undefined;
 const f=presentation.appearance?{...base,...presentation.appearance}:base;
 const rig=solveFigureRig(f,pose,presentation);
 // A thrown missile leaves the palm. A spell leaves the raised tool or free
 // casting hand. Arrow sprites are tip-anchored: their tail starts by the nock.
 const socket=rig.weapon==='javelin'||rig.weapon==='sling'?rig.wrist
   :rig.weapon==='none'?rig.support
   :rig.release;
 const [x,y]=socket,c=Math.cos(rig.lean),s=Math.sin(rig.lean);
 let px=x*c-(y+4)*s+rig.impact*(f.mounted?.65:2);
 let py=x*s+(y+4)*c-4+rig.motion.lift+rig.motion.breathe;
 if(f.mounted){px=-3+px*.84;py=-17+py*.84;}
 return {x:px*size,y:py*size+17*(1-size),ground:17};
}
export type ReleaseSocketInput={kind:UnitKind;pose:UnitAnimationFrame;radius:number;presentation?:FigurePresentation;model?:UnitModel};
/** Returns a scaled art offset. Native ships and engineering machines return
 * undefined, retaining the muzzle/deck hardpoint already captured in their event. */
export function resolveReleaseSocket(input:ReleaseSocketInput):ArtReleaseSocket|undefined {
 const {kind,pose,radius,presentation,model}=input;
 const local=model?.paint.release?model.paint.release(pose,presentation):figureReleaseSocket(kind,pose,presentation)??creatureReleaseSocket(kind,pose);
 if(!local)return undefined;
 const scale=model?Math.max(.72,radius/18):unitGlyphScale(radius);
 return {x:local.x*scale,y:local.y*scale,ground:local.ground*scale};
}
