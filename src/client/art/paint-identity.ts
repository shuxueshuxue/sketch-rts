/** Cache identities follow the inputs each authored painter actually reads.
 * This changes sharing only; painters still receive their original arguments. */
import type {UnitKind} from '../../shared/types';
import type {UnitAnimationFrame} from '../unit-animation';
import {animationKey} from './action-direction';
import {creatures,figures} from './appearance';
import {hasWarfareUnit} from './warfare-units';

const SIEGE=new Set<UnitKind>(['siegeRam','ballista','catapult','organGun']);
const IDLE_KEY='idle:0:0:0';

/** Density, authored domain, facing and equipment remain separate identities.
 * Story variants are opaque painters and retain every original input. */
export function unitPaintKey(kind:UnitKind,team:string,pose:UnitAnimationFrame,variant?:string):string {
  let color=team,action=animationKey(pose);
  if(variant===undefined){
    const stock=(!!figures[kind]||!!creatures[kind])&&!hasWarfareUnit(kind);
    // The stock idle drawings render these breathing phases identically. Keep
    // every other key field, and keep the original pose in the painter/tracker.
    // Full-domain CPU proofs and the observed trace inputs cover these pairs.
    if(stock&&pose.mode==='idle'){
      const frame=pose.frame===4?0:pose.frame===3?1:pose.frame===7?5:pose.frame;
      if(frame!==pose.frame)action=action.replace(`idle:${pose.frame}:`,`idle:${frame}:`);
    }
    // CreatureLook carries team for the public composer contract, but the
    // stock creature bodies and equipment use their authored material colors.
    if(creatures[kind]&&!figures[kind]&&!hasWarfareUnit(kind))color='intrinsic';
    // paintSiege reads recoil and walking wheel phase. It does not read idle
    // breathing, action variant, aim or carried-weapon directions. Retain the
    // original action frame and wheel phase rather than changing animation.
    if(SIEGE.has(kind))action=pose.mode==='attack'&&pose.frame<5?`attack:${pose.frame}:0:0`
      :pose.mode==='walk'?`walk:${pose.frame}:0:0`:IDLE_KEY;
  }
  return `${kind}:${color}:${action}:${variant??''}`;
}
