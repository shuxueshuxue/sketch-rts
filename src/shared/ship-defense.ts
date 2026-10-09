import { combatCapability } from './combat-capabilities';
import { sameGround } from './terrain';
import { shipsIn, shipProfile } from './ship-geometry';
import { areEnemyOwners } from './sim/command-validation';
import type { GameSnapshot, Unit } from './types';
import { isTransportKind } from './transport-role';

export const SHIP_GUARD_LEASH = 900;
export const SHIP_GUARD_RETURN_RADIUS = 24;
export type ShipDefenseIntent = { target?: Unit; returnTo?: { x: number; y: number } };
export type ShipDefenseFrame = Map<string, ShipDefenseIntent>;
type DefenseSnapshot = Pick<GameSnapshot, 'units' | 'items' | 'variants' | 'map' | 'teams'>;
/** The caller supplies its existing spatial query. A fleet never scans the
 * entire army again for every idle hull. */
export type NearbyEnemyShips = (ship: Unit, range: number, visit: (enemy: Unit) => void) => void;

/** Carrying soldiers or sheltered crew does not turn a ferry into a hunter. */
export function combatHull(ship: Unit): boolean {
  return Boolean(shipProfile(ship)) && !isTransportKind(ship.kind);
}

/** Idle defense retains a saved home station and hull target without replacing
 * the player's order. Hold and every explicit task remain movement authorities. */
export function prepareShipDefenseFrame(snapshot: DefenseSnapshot, nearby: NearbyEnemyShips, held: ReadonlySet<string> = new Set()): ShipDefenseFrame {
  const result: ShipDefenseFrame = new Map();
  const ships = shipsIn(snapshot.units), byId = new Map(ships.map(ship => [ship.id, ship]));
  if (!ships.length) return result;
  const reserved = new Set(held);
  const claims = new Map<string, Unit['owner'][]>();
  for (const crew of snapshot.units) {
    if (crew.hp <= 0 || crew.order.type !== 'board') continue;
    reserved.add(crew.order.transportId);
    const claimants = claims.get(crew.order.transportId);
    if (claimants) claimants.push(crew.owner); else claims.set(crew.order.transportId, [crew.owner]);
    if (crew.deck) reserved.add(crew.deck.shipId);
    if (crew.order.rendezvous) reserved.add(crew.order.rendezvous.sourceId);
  }
  const capabilities = new Map(ships.map(ship => [ship.id, combatCapability(snapshot, ship)]));
  for (const ship of ships) {
    if (!ship.sailing) continue;
    const capability = capabilities.get(ship.id)!;
    if (ship.hp <= 0 || ship.owner === 'neutral' || ship.order.type !== 'idle' || ship.orderQueue?.length
      || !combatHull(ship) || !capability.armed || reserved.has(ship.id)) {
      if (ship.sailing.defense) {
        delete ship.sailing.defense;
        delete ship.sailing.pursuit;
        if (ship.sailing.route?.intent === 'pursuit') ship.sailing.route = undefined;
      }
      continue;
    }
    const guard = ship.sailing.defense ??= { originX: ship.x, originY: ship.y };
    const origin = { x: guard.originX, y: guard.originY };
    const homeGap = Math.hypot(ship.x - origin.x, ship.y - origin.y);
    const acquisition = Math.min(700, Math.max(450, capability.range + shipProfile(ship)!.length * .4 + 100));
    const valid = (enemy: Unit) => enemy.hp > 0 && enemy.owner !== 'neutral'
      && enemy.id !== ship.id && Boolean(shipProfile(enemy)) && capabilities.get(enemy.id)?.armed
      && areEnemyOwners(snapshot, ship.owner, enemy.owner)
      && !claims.get(enemy.id)?.some(owner => !areEnemyOwners(snapshot, ship.owner, owner))
      && Math.hypot(enemy.x - origin.x, enemy.y - origin.y) <= SHIP_GUARD_LEASH
      && sameGround(snapshot.map, ship, enemy, 'sea');
    let target = guard.targetId ? byId.get(guard.targetId) : undefined;
    if (homeGap > SHIP_GUARD_LEASH || guard.targetId && (!target || !valid(target))) {
      target = undefined;
      delete guard.targetId;
      guard.returning = homeGap > SHIP_GUARD_RETURN_RADIUS;
      delete ship.sailing.pursuit;
      ship.sailing.route = undefined;
    }
    if (guard.returning) {
      if (homeGap > SHIP_GUARD_RETURN_RADIUS) {
        result.set(ship.id, { returnTo: origin });
        continue;
      }
      delete guard.returning;
    }
    if (!target) {
      let bestGap = Infinity, bestId = '\uffff';
      const best: { target?: Unit } = {};
      nearby(ship, acquisition, enemy => {
        const gap = Math.hypot(enemy.x - ship.x, enemy.y - ship.y);
        if (gap > acquisition || !valid(enemy)) return;
        if (gap < bestGap || gap === bestGap && enemy.id < bestId) { best.target = enemy; bestGap = gap; bestId = enemy.id; }
      });
      target = best.target;
      if (target) guard.targetId = target.id;
    }
    if (target) result.set(ship.id, { target });
    else if (homeGap > SHIP_GUARD_RETURN_RADIUS) {
      guard.returning = true;
      delete ship.sailing.pursuit;
      ship.sailing.route = undefined;
      result.set(ship.id, { returnTo: origin });
    }
  }
  return result;
}
