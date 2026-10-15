import { unitMover } from '../../shared/catalog';
import { walkDestination, isWalkable } from '../../shared/terrain';
import { canBoard, deckPlacement, deckPointFits, deckWalkPathExists } from '../../shared/decks';
import { connectedSurfacePath, decksCanTransfer } from '../../shared/connected-decks';
import { capsuleClearsCircles } from '../../shared/navigation-math';
import { distanceToHull, localToWorld, shipProfile, worldToLocal } from '../../shared/ship-geometry';
import type { GameCommand, GameSnapshot, PlayerId, Unit, GameMap } from '../../shared/types';
import { distance } from './spatial';
import { followStopDistance } from '../../shared/follow-distance';

const cache = new WeakMap<GameSnapshot, Map<PlayerId, GameCommand[]>>();
/** AI troops clear a crowded quay with ordinary movement. The usable crossing
 * extends into the deck, so clearing just the shore's centre line is insufficient.
 * Human units and combat orders retain their own control. */
export function clearTransferLanes(snapshot: GameSnapshot, owner: PlayerId): GameCommand[] {
  let owners = cache.get(snapshot);
  if (!owners) { owners = new Map(); cache.set(snapshot, owners); }
  const known = owners.get(owner);
  if (known) return known;
  const own = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land');
  const commands: GameCommand[] = [], assigned = new Set<string>();
  const destinations: { x: number; y: number; radius: number }[] = [];
  for (const passenger of own) {
    const order = passenger.order;
    if (order.type !== 'board' || !order.berth) continue;
    const boat = snapshot.units.find(unit => unit.id === order.transportId);
    if (!boat) continue;
    const shore = order.berth.shore ?? order.berth;
    if (distance(passenger, shore) > 300) continue;
    const dx = passenger.x - shore.x, dy = passenger.y - shore.y, length = Math.hypot(dx, dy) || 1;
    for (const unit of own) {
      if (assigned.has(unit.id) || distance(unit, shore) > 220) continue;
      if (unit.order.type === 'move' && unit.order.avoidCombat) {
        assigned.add(unit.id);
        commands.push({ type: 'move', unitIds: [unit.id], x: unit.order.x, y: unit.order.y, avoidCombat: true });
        continue;
      }
      if (!['idle', 'hold'].includes(unit.order.type)) continue;
      let goal: { x: number; y: number } | undefined;
      for (const reach of [250, 330, 410]) {
        for (const lateral of [0, 80, -80, 160, -160]) {
          const point = walkDestination(snapshot.map, unit, { x: shore.x + dx / length * reach - dy / length * lateral, y: shore.y + dy / length * reach + dx / length * lateral });
          if (!isWalkable(snapshot.map, point.x, point.y) || distance(point, shore) < 220 || distanceToHull(boat, point) < unit.radius + 80) continue;
          if (destinations.some(d => distance(d, point) < d.radius + unit.radius + 8)) continue;
          if (snapshot.units.some(other => other.id !== unit.id && !other.deck && distance(other, point) < other.radius + unit.radius + 8)) continue;
          goal = point; break;
        }
        if (goal) break;
      }
      if (!goal) continue;
      assigned.add(unit.id); destinations.push({ ...goal, radius: unit.radius });
      commands.push({ type: 'move', unitIds: [unit.id], ...goal, avoidCombat: true });
    }
  }
  commands.push(...clearDeckTransfers(snapshot,owner,assigned));
  owners.set(owner, commands);
  return commands;
}

/** Make room on the actual receiving deck, without changing passenger bodies or capacity. */
function clearDeckTransfers(snapshot:GameSnapshot,owner:PlayerId,assigned:Set<string>):GameCommand[] {
  const commands:GameCommand[]=[];
  for(const passenger of snapshot.units.filter(unit=>unit.owner===owner && unit.deck && pendingDeckBoarding(unit))) {
    const boarding=pendingDeckBoarding(passenger)!;
    const source=snapshot.units.find(unit=>unit.id===passenger.deck!.shipId);
    const target=snapshot.units.find(unit=>unit.id===boarding.transportId);
    if(!source || !target || source.id===target.id || target.owner!==owner
      || !decksCanTransfer(source,target,passenger) || !canBoard(target,passenger,snapshot.units))continue;
    if(passenger.order.type!=='board') {
      if((passenger.order.type==='hold' || passenger.order.type==='follow')
        && connectedSurfacePath(passenger,target,snapshot.units,snapshot.map)?.complete)
        commands.push({type:'board',unitIds:[passenger.id],transportId:target.id});
      continue;
    }
    const bystanders=snapshot.units.filter(unit=>unit.owner===owner && unit.id!==passenger.id && unit.deck
      && [source.id,target.id].includes(unit.deck.shipId) && !unit.cabin && !unit.gangway && !assigned.has(unit.id)
      && (['idle','hold'].includes(unit.order.type) || unit.order.type==='move' && unit.order.avoidCombat));
    if(!bystanders.length || connectedSurfacePath(passenger,target,snapshot.units,snapshot.map)?.complete)continue;
    const ids=new Set(bystanders.map(unit=>unit.id));
    const route=connectedSurfacePath(passenger,target,snapshot.units.filter(unit=>!ids.has(unit.id)),snapshot.map);
    if(!route?.complete)continue;
    const blocks=(body:{x:number;y:number;radius:number})=>route.points.slice(1)
      .some((point,index)=>!capsuleClearsCircles(route.points[index]!,point,passenger.radius+1,[body]));
    for(const unit of bystanders) {
      if(!blocks(unit))continue;
      const ships=[source,target];
      let goal=deckYieldPoint(unit,ships,snapshot.units,snapshot.map,blocks);
      if(!goal && passenger.order.type==='board') {
        const profile=shipProfile(source)!;
        for(const preferred of [{x:0,y:0},{x:profile.length/4,y:0},{x:-profile.length/4,y:0}]) {
          const retreat=deckPlacement(source,passenger,snapshot.units,preferred);
          if(!retreat)continue;
          const at=localToWorld(source,retreat);
          if(distance(passenger,at)<passenger.radius || !connectedSurfacePath(passenger,at,snapshot.units,snapshot.map)?.complete)continue;
          if(passenger.kind==='worker' && distance(at,source)>followStopDistance(passenger,source))continue;
          const backed={...passenger,...at,deck:{shipId:source.id,...retreat}};
          const units=snapshot.units.map(other=>other.id===passenger.id?backed:other);
          goal=deckYieldPoint(unit,ships,units,snapshot.map,blocks);
          if(!goal)continue;
          commands.push({type:'move',unitIds:[passenger.id],...at,avoidCombat:true},
            passenger.kind==='worker' ? {type:'follow',unitIds:[passenger.id],targetId:source.id,queued:true}
              : {type:'holdPosition',unitIds:[passenger.id],queued:true},
            {type:'board',unitIds:[passenger.id],transportId:target.id,queued:true});
          assigned.add(passenger.id);
          break;
        }
      }
      if(!goal)continue;
      assigned.add(unit.id);
      commands.push({type:'move',unitIds:[unit.id],...goal,avoidCombat:true});
    }
  }
  return commands;
}

/** Queued boarding keeps a physical yielding maneuver attached to its original crossing. */
export function pendingDeckBoarding(unit:Unit) {
  return unit.order.type==='board' ? unit.order : unit.deck && (unit.order.type==='hold'
    || unit.order.type==='move' && unit.order.avoidCombat
    || unit.kind==='worker' && unit.order.type==='follow' && unit.order.targetId===unit.deck.shipId)
    ? unit.orderQueue?.find(order=>order.type==='board') : undefined;
}
function deckYieldPoint(unit:Unit,ships:Unit[],units:readonly Unit[],map:GameMap,blocks:(body:{x:number;y:number;radius:number})=>boolean) {
  for(const ship of [...ships].sort((a,b)=>Number(b.id===unit.deck!.shipId)-Number(a.id===unit.deck!.shipId))) {
    if(ship.id!==unit.deck!.shipId && !canBoard(ship,unit,units))continue;
    const profile=shipProfile(ship)!;
    const clear=(point:{x:number;y:number})=>deckPointFits(ship,unit,point,units)
      && !blocks({...unit,...localToWorld(ship,point)});
    const saved=unit.order.type==='move' && (unit.order.deckShipId??unit.deck!.shipId)===ship.id
      ? worldToLocal(ship,unit.order) : undefined;
    const reachable=(point:{x:number;y:number})=>ship.id===unit.deck!.shipId ? deckWalkPathExists(ship,unit,point,units)
      : connectedSurfacePath(unit,localToWorld(ship,point),units,map)?.complete;
    if(saved && clear(saved) && reachable(saved))return localToWorld(ship,saved);
    const candidates:{x:number;y:number}[]=[];
    for(let y=-profile.beam/2;y<=profile.beam/2;y+=4)
      for(let x=-profile.length/2;x<=profile.length/2;x+=4)if(clear({x,y}))candidates.push({x,y});
    const point=candidates.sort((a,b)=>distance(localToWorld(ship,a),unit)-distance(localToWorld(ship,b),unit))
      .find(reachable);
    if(point)return localToWorld(ship,point);
  }
}
