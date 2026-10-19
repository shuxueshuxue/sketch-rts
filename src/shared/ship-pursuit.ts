import { strikeGap, strikePoint } from './combat-geometry';
import { shipMotionLimits } from './ship-handling';
import { distanceToHull, hullContact, shareShipProfile, shipProfile, shipsIn } from './ship-geometry';
import { headingDifference, hullPassageClear } from './ship-navigation';
import { polygonRadius } from './navigation-math';
import { shipTraffic } from './ship-avoidance';
import { detCos, detSin } from './det-math';
import { SIM_TICKS_PER_SECOND } from './time';
import { isStaggered } from './push';
import type { Building, GameMap, Obstacle, Unit } from './types';

type Target = Unit | Building | Obstacle;
const STATION_OFFSETS = [0, ...Array.from({ length: 11 }, (_, index) => [(index + 1) * Math.PI / 12, -(index + 1) * Math.PI / 12]).flat(), Math.PI];
export type PursuitGoal = { x: number; y: number; intent: 'pursuit'; targetId: string; arrivalRadius: number; targetSpeed?: number; fireHeading?: number; retreat?: boolean };

/** Leave a turning battery room before braking would put both hulls in its
 * sweep. The station stays reserved; this limits drive, never collision tests. */
function friendlyManeuverSpeed(ship: Unit, units: readonly Unit[], targetId: string) {
  const own = shipProfile(ship)!, motion = ship.sailing!, limits = shipMotionLimits(ship);
  const c = detCos(motion.heading), s = detSin(motion.heading);
  let limit = Infinity;
  for (const other of shipsIn(units)) {
    const peer = other.sailing, route = peer?.route;
    if (other === ship || other.hp <= 0 || other.owner !== ship.owner
      || (other.order.type !== 'attack' && other.order.type !== 'attackMove')
      || peer?.pursuit?.targetId !== targetId || peer.pursuit.phase !== 'approach'
      || route?.intent !== 'pursuit' || route.targetId !== targetId
      || (route.age ?? 0) >= SIM_TICKS_PER_SECOND * 8) continue;
    // Stopped clocks must not turn an eight-second active maneuver into an
    // indefinite reservation by a disabled or damaged friendly hull.
    const peerLimits = shipMotionLimits(other);
    if (peerLimits.speed <= 0 || peerLimits.turnRate <= 0 || isStaggered(other)
      || other.effects.some(effect => effect.remaining > 0 && (effect.type === 'stun' || effect.type === 'root'))) continue;
    const profile = shipProfile(other)!, first = route.points[0];
    if (!first || first.pivot) continue;
    const dx = other.x - ship.x, dy = other.y - ship.y;
    const along = dx * c + dy * s, across = Math.abs(-dx * s + dy * c);
    const headway = (own.length + profile.length) * .5 + Math.max(own.beam, profile.beam) * .5;
    const braking = motion.speed ** 2 / (2 * limits.acceleration);
    if (along <= 0 || along > headway + braking + own.length * .5
      || across > (own.beam + profile.beam) * .6) continue;
    const speed = Math.hypot(peer.velocityX ?? 0, peer.velocityY ?? 0);
    const yaw = Math.abs(headingDifference(peer.heading, first.heading));
    const turning = route.cruise === false && first.exact && speed < 1
      && Math.hypot(first.x - other.x, first.y - other.y) < 1 && yaw > .01
      && yaw / peerLimits.turnRate <= 8;
    // After the exact turn is consumed, keep the same short departure room
    // while this saved route starts moving. Its finite age bounds the yield.
    const departing = route.cruise === true && !first.exact
      && route.startX !== undefined && route.startY !== undefined && route.startHeading !== undefined
      && Math.abs(headingDifference(route.startHeading, peer.heading)) > .15
      && Math.hypot(other.x - route.startX, other.y - route.startY) < profile.beam
      && speed < peerLimits.speed * .35;
    if (!turning && !departing) continue;
    // Sampled curves often start with a seven-pixel tangent. Require a real
    // onward leg, not merely point[1], which cannot show that the ship leaves.
    const onward = route.points.find(point => Math.hypot(point.x - other.x, point.y - other.y) >= profile.beam);
    if (!onward) continue;
    const exitAcross = Math.abs(-(onward.x - ship.x) * s + (onward.y - ship.y) * c);
    if (exitAcross < across + profile.beam * .5) continue;
    limit = Math.min(limit, Math.sqrt(2 * limits.acceleration * Math.max(0, along - headway)));
  }
  return limit;
}

function hullSupport(unit: Unit, heading: number, toward: number) {
  const c = detCos(toward - heading), s = detSin(toward - heading);
  let reach = -Infinity;
  for (const point of shipProfile(unit)!.hull) reach = Math.max(reach, point.x * c + point.y * s);
  return reach;
}

/** Gunnery may select a crew member; the navigator follows the carrying hull. */
export function shipNavigationTarget(target: Target, units: readonly Unit[]): Target {
  if ('order' in target && target.deck) return units.find(unit => unit.id === target.deck!.shipId && unit.hp > 0) ?? target;
  return target;
}

/** A bounded constant-velocity intercept. An escaping faster quarry still has
 * a finite lead; a distant turn cannot send the pursuer across the whole map. */
export function interceptTime(dx: number, dy: number, vx: number, vy: number, speed: number): number {
  const a = vx * vx + vy * vy - speed * speed, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
  let time = Math.sqrt(c) / Math.max(1, speed);
  if (Math.abs(a) < 1e-7) {
    if (b < -1e-7) time = -c / b;
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant), first = (-b - root) / (2 * a), second = (-b + root) / (2 * a);
      if (first >= 0) time = first;
      if (second >= 0 && (first < 0 || second < first)) time = second;
    }
  }
  return Math.min(6, Math.max(0, time));
}

/** The tactical layer owns range bands and target identity. It never supplies
 * a docking heading, changes sail state, or resets a committed sailing leg. */
export function shipPursuitGoal(ship: Unit, requested: Target, units: readonly Unit[], range: number, minimum = 0, following = false, stationaryFire?: () => boolean, map?: GameMap, fireHeading?: number, stationBowReach = 0, stationCanFire?: (station: Unit) => boolean, stationSearchAdmitted?: () => boolean): PursuitGoal | undefined {
  const target = shipNavigationTarget(requested, units), motion = ship.sailing!;
  const targetMotion = 'order' in target ? target.sailing : undefined;
  const vx = targetMotion?.velocityX ?? 0, vy = targetMotion?.velocityY ?? 0, speed = Math.hypot(vx, vy);
  const previous = motion.pursuit?.targetId === target.id ? motion.pursuit : undefined;
  const underway = targetMotion !== undefined && 'order' in target && (target.order.type === 'move' || target.order.type === 'unload'
    || target.order.type === 'attackMove' && !target.order.targetId);
  const moving = underway || speed > (previous?.moving ? 1 : 4);
  const dx = target.x - ship.x, dy = target.y - ship.y, distance = Math.hypot(dx, dy);
  const ownLength = shipProfile(ship)!.length, targetLength = 'order' in target ? shipProfile(target)?.length ?? 0 : 0;
  // A crossing hull presents its beam, rather than its full length, to the
  // attacker. Project both physical outlines onto their separation axis so a
  // short-range weapon can close without first backing out of a valid approach.
  const direction = Math.atan2(dy, dx);
  const safeGap = following ? (ownLength + targetLength) * .55 + 12
    : hullSupport(ship, fireHeading ?? direction, direction)
      + ('order' in target && shipProfile(target) ? hullSupport(target, targetMotion?.heading ?? 0, direction + Math.PI) : target.radius) + 12;
  // Following ends at a center separation with room to brake. Comparing this
  // to weapon-style edge distance asks the follower to enter its own stand-off
  // circle, so a stopped leader can become the center of an endless orbit.
  const gap = strikeGap(ship, target), phaseGap = following ? distance : gap;
  const enter = following ? safeGap + ownLength * .35 : range * .82;
  const leave = following ? safeGap + ownLength * .6 : range * 1.05;
  const firing = !following ? stationaryFire?.() : undefined;
  // A moving quarry at the edge of a gun's band is in and out of reach tick by tick: the chase stays engaged until it
  // falls back out of range or into the dead zone, as the ranged phases below do.
  const phase = firing !== undefined ? firing || moving && previous?.phase === 'engage' && gap <= leave + Math.max(0, stationBowReach) && gap >= minimum ? 'engage' : 'approach'
    : previous?.phase === 'engage' ? phaseGap > leave || gap < minimum ? 'approach' : 'engage' : phaseGap <= enter && gap >= minimum ? 'engage' : 'approach';
  if (previous) { previous.phase = phase; previous.moving = moving; }
  else motion.pursuit = { targetId: target.id, phase, moving };
  if (phase === 'engage' && !moving && motion.speed <= 1) return undefined;

  const limits = shipMotionLimits(ship);
  // An opponent closing to fight is not an escaping constant-velocity quarry.
  // Leading each other's pursuit by several seconds makes equal ships run
  // side by side forever without closing to a useful firing position.
  const mutual = 'order' in target && (target.order.type === 'attack' || target.order.type === 'attackMove')
    && (target.order.targetId === ship.id || targetMotion?.pursuit?.targetId === ship.id);
  const lead = moving && !mutual ? interceptTime(dx, dy, vx, vy, Math.max(limits.speed * .8, motion.speed)) : 0;
  const at = !moving && !following ? requested : target;
  const predicted = { x: at.x + vx * lead, y: at.y + vy * lead };
  // The nearest hull edge defines weapon reach, while the navigation goal is
  // a center position. Keep enough center separation for both complete hulls.
  const edgeOffset = Math.max(0, distance - gap);
  // @@@dead-zone-band - Out of a weapon's dead zone a ship backs off to where it can fire again: past the minimum by
  // most of a bow mortar's reach from the hull's middle, but never beyond the middle of the band between minimum and
  // range, and its approach stops no nearer. A broadside's band is narrow (200 to 312): backing a ship of the line out
  // by its own length's margin put it past its range, and two of them under attack orders lay apart for good.
  // The dead zone is the guns', so it is measured to what they are fired at (a gun with one fires at a crew's hull,
  // see @@@hull-reach).
  // A bow gun fires from ahead of the hull's middle: the back-off clears the minimum from that muzzle, not the middle.
  const backOff = minimum > 0 ? Math.min(minimum + ownLength * .45, Math.max((minimum + range) / 2, minimum + Math.max(0, stationBowReach) + 8)) : 0;
  // A moving quarry is kept off by the engagement's own closing speed (below), not by stopping to back away.
  if (!following && !moving && minimum > 0 && !firing && strikeGap(ship, requested) < backOff) {
    // Keep a bow mortar facing the opponent while backing out of its dead
    // zone. A full sailing turn only brings its stern closer to the danger.
    const separation = Math.max(safeGap, edgeOffset + backOff);
    return { x: target.x - dx / (distance || 1) * separation, y: target.y - dy / (distance || 1) * separation,
      intent: 'pursuit', targetId: target.id, arrivalRadius: Math.max(4, ownLength * .04),
      fireHeading: Math.atan2(dy, dx), retreat: true, targetSpeed: limits.reverseSpeed };
  }
  // A stationary occupied deck can put the actual fighting crew farther than
  // its nearest hull edge. Its firing approach aims at that fighting position;
  // ordinary hull sweep validation still prevents penetration.
  const stationary = !moving && !following && stationaryFire !== undefined;
  const standoff = stationary
    ? Math.max(safeGap, minimum + 24, range * .9) : Math.max(safeGap, edgeOffset + Math.max(minimum + 24, range * .68, backOff));
  // A gun with a dead zone strikes a hull only by its nearest side (see @@@hull-reach), so a station on a bearing keeps
  // that side mid-band from the gun: as far from the hull's middle as its edge lies on that bearing, and the band beyond.
  const bandHull = stationary && minimum > 0 && 'order' in target && shipProfile(target) ? target : undefined;
  const ringAt = (angle: number) => {
    if (!bandHull) return standoff;
    const edge = strikePoint({ x: predicted.x + detCos(angle) * 4000, y: predicted.y + detSin(angle) * 4000 }, bandHull);
    return Math.hypot(edge.x - predicted.x, edge.y - predicted.y) + (minimum + range) / 2;
  };
  // Keep the waiting station astern when the leader stops. Basing it on the
  // follower's own position makes the destination orbit with every correction.
  const followHeading = speed > 1 ? Math.atan2(vy, vx) : targetMotion?.heading ?? Math.atan2(dy, dx);
  const bearingX = following ? detCos(followHeading) : predicted.x - ship.x;
  const bearingY = following ? detSin(followHeading) : predicted.y - ship.y;
  const bearingLength = Math.hypot(bearingX, bearingY) || 1;
  const approach = following ? standoff : ringAt(Math.atan2(-bearingY, -bearingX));
  const goal: PursuitGoal = {
    x: predicted.x - bearingX / bearingLength * approach,
    y: predicted.y - bearingY / bearingLength * approach,
    intent: 'pursuit', targetId: target.id, arrivalRadius: Math.max(4, ownLength * .04),
  };
  if(moving && !following && 'order' in target && shipProfile(target)){
    const heading=fireHeading ?? Math.atan2(goal.y-ship.y,goal.x-ship.x);
    const station={...ship,x:goal.x,y:goal.y,sailing:{...motion,heading}};
    if(hullContact(station,target)){
      // A long intercept can put its trailing firing station inside the
      // quarry's present hull. Static route admission then replaces a useful
      // chase with repeated precision pivots. Keep a clear station on our
      // side of the real hull until a farther predicted station is available.
      goal.x=target.x-dx/(distance || 1)*standoff;
      goal.y=target.y-dy/(distance || 1)*standoff;
    }
  }
  if (!moving && !following && stationaryFire !== undefined && !firing) {
    // A firing station needs room to rotate the hull. A point on the nearest
    // edge of the target's deck is a berth and can trap the broadside battery.
    const radius = polygonRadius(shipProfile(ship)!.hull) + 4;
    const bearing = Math.atan2(ship.y - predicted.y, ship.x - predicted.x);
    const ships = shipsIn(units);
    // A battery already firing is a fixed obstruction. A destination on
    // the far side of that hull can be vacant yet require a long detour.
    const parked=ships.filter(other=>other!==ship && other.owner===ship.owner && other.hp>0
      && other.sailing?.pursuit?.targetId===target.id && other.sailing.pursuit.phase==='engage'
      && Math.hypot(other.sailing.velocityX??0,other.sailing.velocityY??0)<1);
    const approachTraffic=shipTraffic(ship,parked,Infinity,map);
    const accessible=(candidate:{x:number;y:number})=>{
      if(!parked.length)return true;
      const heading=Math.atan2(candidate.y-ship.y,candidate.x-ship.x);
      const start={x:ship.x,y:ship.y,heading};
      return approachTraffic(start,{...candidate,heading});
    };
    // The caller may supply a working bow mount whose range covers this
    // band. Side batteries cannot borrow the hull profile's bow pivot.
    const bowReach=Math.max(0,stationBowReach);
    const inRange=(candidate:{x:number;y:number},margin=.9)=>{
      const separation=Math.hypot(candidate.x-predicted.x,candidate.y-predicted.y) || 1;
      const pivot={x:candidate.x-(candidate.x-predicted.x)/separation*bowReach,
        y:candidate.y-(candidate.y-predicted.y)/separation*bowReach};
      return requested!==target ? Math.hypot(pivot.x-requested.x,pivot.y-requested.y)-requested.radius<=range*margin
        : 'order' in target && shipProfile(target) ? distanceToHull(target,pivot)<=range*margin
        : Math.hypot(pivot.x-target.x,pivot.y-target.y)-target.radius<=range*margin;
    };
    const valid = (candidate: { x: number; y: number }) => {
      for (const other of ships) {
        if (other === ship || other.hp <= 0) continue;
        if (distanceToHull(other, candidate) < radius) return false;
        const reserved = other.sailing?.route;
        // Incoming friendly batteries need different places to fight, even
        // before either hull reaches the firing ring. A route is the saved
        // reservation: replacing an attack order releases it immediately.
        if (other.owner === ship.owner && (other.order.type === 'attack' || other.order.type === 'attackMove')
          && reserved?.intent === 'pursuit' && reserved.targetId === target.id
          && (other.sailing?.pursuit?.phase!=='engage' || (other.sailing.speed??0)>1
            || Math.hypot(other.sailing.velocityX??0,other.sailing.velocityY??0)>1)
          && Math.hypot(candidate.x - reserved.goalX, candidate.y - reserved.goalY) < radius + polygonRadius(shipProfile(other)!.hull) + 4) return false;
      }
      return !map || hullPassageClear(map, ship, { ...candidate, heading: 0 }, { ...candidate, heading: Math.PI })
        && hullPassageClear(map, ship, { ...candidate, heading: Math.PI }, { ...candidate, heading: Math.PI * 2 });
    };
    const armedStation=(candidate:{x:number;y:number})=>{
      if(!stationCanFire)return true;
      const station={...ship,...candidate,sailing:{...motion}};
      shareShipProfile(ship,station);
      return stationCanFire(station);
    };
    const committed = motion.route;
    const previousStation = committed?.intent === 'pursuit' && committed.targetId === target.id
      ? { x: committed.goalX, y: committed.goalY } : undefined;
    let best: { x: number; y: number } | undefined, bestCost = Infinity;
    let retained = false, nearSpace = false;
    const consider=(candidate:{x:number;y:number})=>{
      const distance = Math.hypot(candidate.x - ship.x, candidate.y - ship.y);
      // Equal-distance stations on opposite sides of the target are not
      // equal sailing approaches. Include the turn needed to reach one so
      // a ship already heading south does not commit to a 270-degree orbit
      // around a northward station merely because that sector came first.
      const turn = Math.abs(headingDifference(motion.heading, Math.atan2(candidate.y - ship.y, candidate.x - ship.x)));
      const cost = distance + ownLength * .75 * turn + (accessible(candidate)?0:ownLength*3);
      if (cost >= bestCost - 1e-7 || !valid(candidate) || !armedStation(candidate)) return;
      best = candidate; bestCost = cost;
    };
    // Prefer the same useful station through a turn. Re-centering the ring
    // on the pursuer's new bearing otherwise makes a stopped enemy appear
    // to drag the destination sideways on every tick. Near the station,
    // let gunnery refine range to crew standing on the far side of a deck.
    const previousRing = previousStation ? ringAt(Math.atan2(previousStation.y - predicted.y, previousStation.x - predicted.x)) : standoff;
    if (previousStation && Math.hypot(previousStation.x - ship.x, previousStation.y - ship.y) > ownLength * .5
      && (Math.hypot(previousStation.x - predicted.x, previousStation.y - predicted.y) >= previousRing-ownLength*.25
        || requested===target && 'order' in target && shipProfile(target) && distanceToHull(target,previousStation)>=radius+8)
      && Math.hypot(previousStation.x - predicted.x, previousStation.y - predicted.y) <= previousRing+ownLength*1.15
      && inRange(previousStation,1)
      && valid(previousStation) && accessible(previousStation) && armedStation(previousStation)) { best = previousStation; retained = true; }
    // A still useful station only needs validation, rather than another full
    // search which would consume the hull's pending navigation request.
    if (!retained && stationSearchAdmitted && !stationSearchAdmitted()) {
      if (!previousStation) return undefined;
      best = previousStation; retained = true;
      goal.arrivalRadius = committed!.arrivalRadius ?? goal.arrivalRadius;
      if (committed!.targetSpeed !== undefined) goal.targetSpeed = committed!.targetSpeed;
      if (committed!.fireHeading !== undefined) goal.fireHeading = committed!.fireHeading;
      if (committed!.retreat !== undefined) goal.retreat = committed!.retreat;
    }
    for (const offset of best ? [] : STATION_OFFSETS) {
      const angle=bearing+offset,c=detCos(angle),s=detSin(angle),standoff=ringAt(angle);
      const station=(separation:number)=>({x:predicted.x+separation*c,y:predicted.y+separation*s});
      // A fixed circle sends a rear battery to the enemy's opposite side
      // once nearby slots are reserved. Also consider an outer station in
      // the real firing band, retaining full hull and rotation clearance.
      const base=station(standoff),baseClear=requested===target && valid(base);
      const nearSide=Math.abs(offset)<=Math.PI/2+1e-7;
      if(nearSide && baseClear)nearSpace=true;
      let outer=standoff;
      if(requested===target && !baseClear && inRange(base)){
        let low=standoff,high=standoff+ownLength*.9;
        if(inRange(station(high)))low=high;
        else for(let i=0;i<8;i++){const middle=(low+high)/2;if(inRange(station(middle)))low=middle;else high=middle;}
        outer=low;
      }
      for(const separation of outer>standoff+4?[standoff,outer]:[standoff]){
        const candidate=separation===standoff?base:station(separation);
        if(requested===target && nearSide && !nearSpace && separation>standoff && valid(candidate))nearSpace=true;
        consider(candidate);
      }
    }
    if(!retained && !nearSpace && requested===target && 'order' in target && shipProfile(target) && (!best
      || (best.x-predicted.x)*detCos(bearing)+(best.y-predicted.y)*detSin(bearing)<0)){
      // The approach's head-on stand-off is too wide at the quarry's beam.
      // When every ordinary near-side slot is physically unavailable and
      // would send a battery to the far side, search only 25 near-side
      // angles for a smaller clear band.
      // Each inner radius still leaves the complete turning circle plus
      // twelve pixels outside the target, then uses the same hull, traffic,
      // terrain and actual weapon admission as every ordinary station.
      // A temporary obstruction of a gun's lane alone must not replace a
      // viable approach with a tempting inner slot behind the front fleet.
      for(let index=-12;index<=12;index++){
        const angle=bearing+index*Math.PI/24,c=detCos(angle),s=detSin(angle);
        const station=(separation:number)=>({x:predicted.x+separation*c,y:predicted.y+separation*s});
        if(distanceToHull(target,station(standoff))<radius+8)continue;
        let low=0,high=standoff;
        for(let i=0;i<8;i++){
          const middle=(low+high)/2;
          if(distanceToHull(target,station(middle))<radius+8)low=middle;else high=middle;
        }
        consider(station(high));
        if(standoff-high>8)consider(station((high+standoff)/2));
      }
    }
    if (best) { goal.x = best.x; goal.y = best.y; }
  }
  if (moving && phase === 'engage') {
    // Closing error changes speed continuously. A target moving away remains
    // a voyage even while the guns already have range.
    // A gun with a dead zone strikes a hull only by its nearest side (see @@@hull-reach): hold that side mid-band from
    // the gun, which on the bow stands ahead of the hull's middle.
    const closingGap = following ? distance - safeGap : gap - (minimum > 0 ? (minimum + range) / 2 + Math.max(0, stationBowReach) : range * .68);
    // Kept engaged through a tick out of reach (see the phase above), it keeps the firing heading it sails on.
    const heading = fireHeading ?? (motion.route?.intent === 'pursuit' && motion.route.targetId === target.id ? motion.route.fireHeading : undefined);
    if (heading !== undefined && !following) {
      goal.fireHeading = heading;
      const along = vx * detCos(heading) + vy * detSin(heading);
      goal.targetSpeed = Math.min(limits.speed, Math.max(0, along + closingGap * .2));
    } else goal.targetSpeed = Math.min(limits.speed, Math.max(speed * .55, speed + closingGap * .2));
  }
  if (!moving && phase === 'engage') goal.targetSpeed = 0;
  if (!moving && !following && phase === 'approach') {
    const maneuverSpeed = friendlyManeuverSpeed(ship, units, target.id);
    if (maneuverSpeed !== Infinity) goal.targetSpeed = Math.min(goal.targetSpeed ?? Infinity, maneuverSpeed);
  }
  return goal;
}

export function shipCanTurnForAttack(ship: Unit): boolean {
  return ship.sailing?.pursuit?.phase === 'engage' && !ship.sailing.pursuit.moving && ship.sailing.speed <= 1;
}
