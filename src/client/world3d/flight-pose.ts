import type {ProjectileOrigin} from '../projectile-origins';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import { projectileLook } from '../art/effect-presentation';
import type { WorldEffect } from '../../shared/types';

/** Interpolate within the latest simulation step, never beyond an unconfirmed
 * impact. Pausing or a delayed network packet cannot make a shot disappear. */
export function flightPose(effect:WorldEffect,elapsed:number,origin?:ProjectileOrigin){
  const fraction=Math.max(0,Math.min(.999,elapsed*SIM_TICKS_PER_SECOND/1000));
  const p=Math.max(0,Math.min(1,1-(effect.remaining-fraction)/effect.duration));
  const from=origin??{x:effect.fromX??effect.x,y:effect.fromY??effect.y},to={x:effect.toX??effect.x,y:effect.toY??effect.y};
  const flash=effect.type==='muzzleFlash',look=flash?'flash':effect.type==='shellFlight'?'shell':projectileLook(effect.sourceKind,effect.attackKind);
  const distance=Math.hypot(to.x-from.x,to.y-from.y);
  const arc=effect.type==='shellFlight'?Math.min(110,distance*.2):effect.type==='projectile'&&['arrow','spear'].includes(look)?Math.min(36,distance*.12):0;
  const fromHeight=origin?.height??effect.fromHeight??0;
  const height=fromHeight+((effect.toHeight??0)-fromHeight)*p+4*p*(1-p)*arc/Math.tan(SHIP_CAMERA.tilt);
  const slope=(effect.toHeight??0)-fromHeight+4*(1-2*p)*arc/Math.tan(SHIP_CAMERA.tilt);
  return{pitch:Math.atan2(slope,distance),x:flash?from.x:from.x+(to.x-from.x)*p,y:flash?from.y:from.y+(to.y-from.y)*p,height:flash?effect.fromHeight??0:height,heading:Math.atan2(to.y-from.y,to.x-from.x),look,scale:flash?2+8*(1-p):1,p};
}
