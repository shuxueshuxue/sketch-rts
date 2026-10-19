import type { BenchmarkTracker } from '../../sdk/benchmark/core';
import { UNIT_DEFS } from '../../shared/catalog';
import { beginShipCollisionFrame, sweepShipCollision } from '../../shared/ship-collisions';
import { isShipKind, shipPassengers, shipProfile } from '../../shared/ship-geometry';
import { hasShipPlanningWork } from '../../shared/ship-planning-budget';
import { headingDifference, hullPassageClear, type ShipPose } from '../../shared/ship-navigation';
import { shipTraffic } from '../../shared/ship-avoidance';
import { installedWeapons, SHIP_HULL_COST, SHIP_WEAPONS } from '../../shared/ship-equipment';
import { SIM_TICKS_PER_SECOND as TPS } from '../../shared/time';
import type { Building, GameSnapshot, Obstacle, Unit } from '../../shared/types';
import type { AiGameAgent } from '../game-runner';

export type ObstacleEvidence = {
  second: number; shipId: string; shipKind: string; shipGold: number; cargoGold: number;
  position: ShipPose; leg: ShipPose; order: Unit['order'];
  obstruction: { id: string; kind: string; owner?: string; x: number; y: number; radius: number };
  fraction: number; stationarySeconds: number; terrainClear: boolean; shipTrafficClear: boolean;
};
type Episode = { startSecond: number; lastSecond: number; samples: number; maxExposedGold: number; first: ObstacleEvidence };
export type ObstacleShip = {
  gold: number; maxCargoGold: number; conflictSeconds: number; immediateBlockSeconds: number;
  stationaryBlockSeconds: number; episodes: Episode[];
};
type Owner = { routeSamples: number; conflictSeconds: number; immediateBlockSeconds: number; stationaryBlockSeconds: number; ships: Record<string, ObstacleShip> };
type State = { owners: Record<string, Owner>; poses: Map<string, ShipPose & { since: number }> };

/** Measures the committed route against physical solids, independently of the planner's current implementation.
 * In particular, fixing the planner's predicate alone cannot make an unsafe emitted route disappear from this metric.
 * The probe owns a separate collision-frame key; it never replaces the simulation's frame or moves an entity.
 */
export function createNavalObstacleTracker(): BenchmarkTracker<AiGameAgent, State, Record<string, Owner>> {
  return {
    id: 'navalObstacles',
    create: ({ players }) => ({ owners: Object.fromEntries(players.map(owner => [owner, { routeSamples: 0, conflictSeconds: 0, immediateBlockSeconds: 0, stationaryBlockSeconds: 0, ships: {} }])), poses: new Map() }),
    afterStep(state, { after: s, game }) {
      if (s.tick % TPS !== 0) return;
      const second = s.tick / TPS;
      const hulls = s.units.filter(unit => unit.hp > 0 && isShipKind(unit.kind) && unit.owner in state.owners);
      for (const boat of hulls) {
        const pose = { x: boat.x, y: boat.y, heading: boat.sailing!.heading };
        const previous = state.poses.get(boat.id);
        if (!previous || Math.hypot(boat.x - previous.x, boat.y - previous.y) > 32
          || Math.abs(headingDifference(previous.heading, pose.heading)) * shipProfile(boat)!.length / 2 > 32) state.poses.set(boat.id, { ...pose, since: second });
      }
      const candidates = hulls.filter(boat => boat.sailing?.route?.points.length && hasShipPlanningWork(boat, s.units));
      if (!candidates.length) return;
      const probeUnits = [...s.units], probeMap = { ...s.map };
      beginShipCollisionFrame(probeUnits, probeMap, [...s.buildings, ...(game.obstacles ?? [])]);
      for (const boat of candidates) {
        const owner = state.owners[boat.owner]!;
        owner.routeSamples++;
        const from = { x: boat.x, y: boat.y, heading: boat.sailing!.heading }, leg = boat.sailing!.route!.points[0]!;
        const contact = sweepShipCollision(probeMap, boat, probeUnits, from, leg);
        if (!contact?.other || contact.kind !== 'building' && contact.kind !== 'obstacle') continue;
        const solid = contact.other as Building | Obstacle;
        const gold = shipGold(s, boat), cargoGold = shipPassengers(s.units, boat).reduce((sum, unit) => sum + UNIT_DEFS[unit.kind].cost, 0);
        const stationarySeconds = second - state.poses.get(boat.id)!.since;
        const immediate = contact.fraction <= 1e-7, stationary = immediate && stationarySeconds >= 30;
        owner.conflictSeconds++;
        if (immediate) owner.immediateBlockSeconds++;
        if (stationary) owner.stationaryBlockSeconds++;
        const ship = owner.ships[boat.id] ??= { gold, maxCargoGold: 0, conflictSeconds: 0, immediateBlockSeconds: 0, stationaryBlockSeconds: 0, episodes: [] };
        ship.gold = Math.max(ship.gold, gold); ship.maxCargoGold = Math.max(ship.maxCargoGold, cargoGold);
        ship.conflictSeconds++;
        if (immediate) ship.immediateBlockSeconds++;
        if (stationary) ship.stationaryBlockSeconds++;
        const last = ship.episodes.at(-1);
        if (last && last.lastSecond === second - 1 && last.first.obstruction.id === solid.id) {
          last.lastSecond = second; last.samples++; last.maxExposedGold = Math.max(last.maxExposedGold, gold + cargoGold);
        } else {
          const evidence: ObstacleEvidence = { second, shipId: boat.id, shipKind: boat.kind, shipGold: gold, cargoGold,
            position: from, leg: structuredClone(leg), order: structuredClone(boat.order),
            obstruction: { id: solid.id, kind: solid.kind, ...('owner' in solid ? { owner: solid.owner } : {}), x: solid.x, y: solid.y, radius: solid.radius },
            fraction: contact.fraction, stationarySeconds, terrainClear: hullPassageClear(s.map, boat, from, leg), shipTrafficClear: shipTraffic(boat, s.units, 600, s.map)(from, leg) };
          ship.episodes.push({ startSecond: second, lastSecond: second, samples: 1, maxExposedGold: gold + cargoGold, first: evidence });
        }
      }
    },
    finish: state => state.owners,
  };
}

function shipGold(snapshot: GameSnapshot, ship: Unit) {
  return SHIP_HULL_COST[ship.kind as keyof typeof SHIP_HULL_COST]
    + installedWeapons(snapshot, ship).reduce((sum, item) => sum + SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].cost, 0);
}
