/** Capture the authored release socket once per actual projectile. Movement,
 * later gear changes and later animation poses cannot pull a missile backward. */
import {UNIT_DEFS} from '../shared/catalog';
import {SHIP_CAMERA} from '../shared/ship-geometry';
import type {GameSnapshot,UnitKind,WorldEffect} from '../shared/types';
import type {UnitModel} from '../story/cast';
import {releasePoseForEffect} from './unit-animation';
import {projectActionFrame,projectPaperDirection} from './art/action-direction';
import {resolveReleaseSocket} from './art/release-socket';
import {appearanceFor,appearanceForKind} from './art/unit-appearance';
import {unitGlyphScale} from './glyphs';
export type ProjectileOrigin={x:number;y:number;height:number};
type Origins={gpu:ProjectileOrigin;canvas:ProjectileOrigin};
export class ProjectileOriginTracker {
 private origins=new Map<string,Origins|undefined>();
 private tick=-1;
 private snapshot:GameSnapshot|undefined;
 private effects:WorldEffect[]|undefined;
 private effectCount=-1;
 reset(){this.origins.clear();this.tick=-1;this.snapshot=undefined;this.effects=undefined;this.effectCount=-1;}
 update(snapshot:GameSnapshot,models?:(variant:string)=>UnitModel|undefined,facing?:(id:string)=>1|-1){
  if(snapshot===this.snapshot&&snapshot.tick===this.tick&&snapshot.effects===this.effects&&snapshot.effects.length===this.effectCount)return;
  if(snapshot.tick<this.tick)this.reset();this.tick=snapshot.tick;this.snapshot=snapshot;this.effects=snapshot.effects;this.effectCount=snapshot.effects.length;
  const active=new Set<string>();let units:Map<string,GameSnapshot['units'][number]>|undefined;
  for(const effect of snapshot.effects){
   if(effect.type!=='projectile')continue;active.add(effect.id);if(this.origins.has(effect.id))continue;
   const pose=releasePoseForEffect(effect);
   if(!pose||effect.fromX===undefined||effect.fromY===undefined){this.origins.set(effect.id,undefined);continue;}
   units??=new Map(snapshot.units.map(unit=>[unit.id,unit]));
   const unit=effect.sourceId?units.get(effect.sourceId):undefined;
   const corpse=!unit&&effect.sourceId?snapshot.corpses?.find(corpse=>corpse.unitId===effect.sourceId):undefined;
   // A corpse has no deck metadata: preserve an elevated event hardpoint when
   // its shooter was already absent at first observation.
   if(!unit&&(effect.fromHeight??0)!==0){this.origins.set(effect.id,undefined);continue;}
   const kind=unit?.kind??corpse?.kind??effect.sourceKind;
   if(!kind||!(kind in UNIT_DEFS)){this.origins.set(effect.id,undefined);continue;}
   const variant=unit?.variant??corpse?.variant,model=variant?models?.(variant):undefined;
   const radius=unit?.radius??corpse?.radius??UNIT_DEFS[kind as UnitKind].radius;
   const direction=pose.direction?projectPaperDirection(pose.direction):undefined;
   const fallback=effect.sourceId?facing?.(effect.sourceId)??1:1;
   const mirror=direction&&Math.abs(direction.x)>=Math.max(1,Math.abs(direction.y)*.08)?(direction.x<0?-1:1):fallback;
   const presentation=unit?appearanceFor(snapshot,unit):appearanceForKind(kind as UnitKind,snapshot.players[corpse?.owner??effect.owner??'neutral']?.race);
   const socket=resolveReleaseSocket({kind:kind as UnitKind,pose:projectActionFrame(pose,mirror),radius,presentation,...(model?{model}:{})});
   if(!socket){this.origins.set(effect.id,undefined);continue;}
   const tilt=Math.tan(SHIP_CAMERA.tilt),aboard=Boolean(unit?.deck),floor=(effect.fromHeight??0)-(aboard?18:0),x=effect.fromX+socket.x*mirror,y=effect.fromY;
   this.origins.set(effect.id,{gpu:{x,y,height:floor+(socket.ground-socket.y)/tilt},canvas:{x,y,height:floor+((aboard?18*unitGlyphScale(radius):0)-socket.y)/tilt}});
  }
  for(const id of this.origins.keys())if(!active.has(id))this.origins.delete(id);
 }
 origin(effect:WorldEffect,space:'gpu'|'canvas'='gpu'){return this.origins.get(effect.id)?.[space];}
 get size(){return this.origins.size;}
}
