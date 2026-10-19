import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBenchmarkMatch, type BenchmarkTracker } from '../../sdk/benchmark/core';
import { combatCapability } from '../../shared/combat-capabilities';
import { UNIT_DEFS, unitMover } from '../../shared/catalog';
import { BOARDING_GAP, carries } from '../../shared/naval';
import { bodyMass } from '../../shared/physical-body';
import { routeArrivals } from '../../shared/route-selection';
import { SHIP_HULL_COST, installedWeapons, SHIP_WEAPONS } from '../../shared/ship-equipment';
import { distanceToHull, isShipKind, shipPassengers } from '../../shared/ship-geometry';
import { sameGround, walkableGoal } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND as TPS } from '../../shared/time';
import type { AiGameAgent } from '../game-runner';
import type { AiPolicyMemory } from '../memory';
import { strengthOf } from '../policy/v6/strength';
import { navalObservedPlanner } from './naval-room-worker';
import type { NavalRoomMatch } from './naval-room';

type Evidence = { second: number; shipId: string; riderId: string; targetId: string; gold: number; shoreGap: number; ownEligible: number; ownStrength: number; filteredStrength: number; enemyDemand: number; fullGuardSufficient: boolean };
type Owner = { blockedSeconds: number; fullGuardSufficientSeconds: number; ships: Record<string, { gold: number; blockedSeconds: number; fullGuardSufficientSeconds: number; first: Evidence; sufficientExample?: Evidence }> };

/** A sufficient blocking condition in the existing loading gate, read without rerunning policy.
 * Only dock-ready, empty creep ferries with a living eligible rider and a reachable land road qualify.
 * The full-guard comparison is a diagnostic upper bound; it predicts no win or successful voyage.
 */
export function createNavalLoadingDiagnostics(memory: (owner: string) => AiPolicyMemory | undefined): BenchmarkTracker<AiGameAgent, Record<string, Owner>, Record<string, Owner>> {
  return {
    id: 'navalLoadingDiagnostics',
    create: ({ players }) => Object.fromEntries(players.map(owner => [owner, { blockedSeconds: 0, fullGuardSufficientSeconds: 0, ships: {} }])),
    afterStep(state, { after: s, players }) {
      if (s.tick % TPS !== 0) return;
      for (const owner of players) {
        const naval = memory(owner)?.naval;
        if (!naval?.ferries) continue;
        for (const [id, mission] of Object.entries(naval.ferries)) {
          if (mission.purpose !== 'creep' || mission.phase !== 'loading' || (naval.ferryRetryUntil?.[id] ?? 0) > s.tick || naval.outfit?.shipId === id) continue;
          const boat = s.units.find(unit => unit.id === id && unit.owner === owner && unit.hp > 0);
          if (!boat || shipPassengers(s.units, boat).length || s.units.some(unit => unit.order.type === 'board' && unit.order.transportId === id)) continue;
          const shore = walkableGoal(s.map, mission.from.x, mission.from.y);
          const shoreGap = distanceToHull(boat, shore);
          if (shoreGap > UNIT_DEFS.worker.radius + BOARDING_GAP) continue;
          const soldiers = s.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker' && unitMover(unit.kind) === 'land' && !unit.expiresTick && sameGround(s.map, unit, shore) && unit.order.type !== 'board' && unit.order.type !== 'cast');
          const rider = soldiers.find(unit => unit.id === mission.riderId);
          if (!rider || bodyMass(rider) > carries(boat) || !routeArrivals(s.map, [rider], shore, 'land').length) continue;
          const enemies = s.units.filter(unit => unit.owner !== 'neutral' && (s.teams?.[unit.owner] ?? unit.owner) !== (s.teams?.[owner] ?? owner) && sameGround(s.map, unit, shore) && combatCapability(s, unit).armed);
          const enemyDemand = strengthOf(enemies) * 1.3;
          if (enemyDemand <= 0) continue;
          const ownStrength = strengthOf(soldiers), filteredStrength = strengthOf([rider]);
          const fullGuardSufficient = ownStrength - filteredStrength >= enemyDemand;
          const gold = isShipKind(boat.kind) ? SHIP_HULL_COST[boat.kind] + installedWeapons(s, boat).reduce((sum, item) => sum + SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].cost, 0) : UNIT_DEFS[boat.kind].cost;
          const evidence = { second: s.tick / TPS, shipId: id, riderId: rider.id, targetId: mission.targetId, gold, shoreGap, ownEligible: soldiers.length, ownStrength, filteredStrength, enemyDemand, fullGuardSufficient };
          const stats = state[owner]!;
          stats.blockedSeconds++;
          const ship = stats.ships[id] ??= { gold, blockedSeconds: 0, fullGuardSufficientSeconds: 0, first: evidence };
          ship.blockedSeconds++;
          if (fullGuardSufficient) { stats.fullGuardSufficientSeconds++; ship.fullGuardSufficientSeconds++; ship.sufficientExample ??= evidence; }
        }
      }
    },
    finish: state => state,
  };
}

export function runBenchmarkParallelMatch(match: NavalRoomMatch) {
  const memories: Record<string, AiPolicyMemory> = {};
  const report = runBenchmarkMatch({ ...match, commandPlanner: navalObservedPlanner(memories) }, [createNavalLoadingDiagnostics(owner => memories[owner]) as never]);
  if (match.naval.outDir) {
    mkdirSync(match.naval.outDir, { recursive: true });
    writeFileSync(join(match.naval.outDir, `${match.name.replaceAll(' ', '_')}.json`), JSON.stringify(report));
  }
  return report;
}
