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
import type { GameSnapshot, Unit } from '../../shared/types';
import { combatHull } from '../../shared/ship-defense';
import type { AiGameAgent } from '../game-runner';
import type { AiPolicyMemory } from '../memory';
import { strengthOf } from '../policy/v6/strength';
import { navalObservedPlanner } from './naval-room-worker';
import type { NavalRoomMatch } from './naval-room';
import { createNavalMetricsTracker } from './naval-metrics';

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
          const gold = assetPrice(s, boat);
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

type Departure = { second: number; shipId: string; targetId: string; purpose: string; shipGold: number; cargoGold: number; cargo: string[]; origin: { x: number; y: number }; destination: { x: number; y: number }; originEnemies: string[]; originCover: string[]; destinationEnemies: string[] };
type TurnaroundOwner = { departures: number; immediateReturns: (Departure & { returnSecond: number; emptyDestinationBlockedOrigin: boolean })[]; pending: Record<string, Departure>; previous: Record<string, string> };

/** Observe the real loading -> sailing -> return transitions every tick. Asset values are counted once per event;
 * summaries must deduplicate hull IDs before adding exposed capital across repeated attempts. */
export function createNavalTurnaroundDiagnostics(memory: (owner: string) => AiPolicyMemory | undefined): BenchmarkTracker<AiGameAgent, Record<string, TurnaroundOwner>, unknown> {
  return {
    id: 'navalTurnaroundDiagnostics',
    create: ({ players }) => Object.fromEntries(players.map(owner => [owner, { departures: 0, immediateReturns: [], pending: {}, previous: {} }])),
    afterStep(state, { after: s, players }) {
      for (const owner of players) {
        const stats = state[owner]!, ferries = memory(owner)?.naval?.ferries ?? {};
        const previous: Record<string, string> = {};
        for (const [id, mission] of Object.entries(ferries)) {
          const key = `${id}:${mission.sinceTick}:${mission.targetId}`;
          previous[key] = mission.phase;
          const boat = s.units.find(unit => unit.id === id && unit.owner === owner);
          if (!boat) continue;
          if (mission.phase === 'sailing' && stats.previous[key] !== 'sailing') {
            const nearby = (point: { x: number; y: number }) => s.units.filter(unit => unitMover(unit.kind) === 'sea' && combatCapability(s, unit).armed && sameGround(s.map, unit, point, 'sea') && Math.hypot(unit.x - point.x, unit.y - point.y) < 900);
            const enemy = (unit: Unit) => unit.owner === 'neutral' || (s.teams?.[unit.owner] ?? unit.owner) !== (s.teams?.[owner] ?? owner);
            const cargo = shipPassengers(s.units, boat);
            stats.departures++;
            stats.pending[key] = { second: s.tick / TPS, shipId: id, targetId: mission.targetId, purpose: mission.purpose, shipGold: assetPrice(s, boat), cargoGold: cargo.reduce((sum, unit) => sum + UNIT_DEFS[unit.kind].cost, 0), cargo: cargo.map(unit => unit.id), origin: { x: boat.x, y: boat.y }, destination: { ...mission.to }, originEnemies: nearby(boat).filter(enemy).map(unit => unit.id), originCover: nearby(boat).filter(unit => unit.owner === owner && combatHull(unit) && unit.hp >= unit.maxHp * .4).map(unit => unit.id), destinationEnemies: nearby(mission.to).filter(enemy).map(unit => unit.id) };
          }
          const departure = stats.pending[key];
          if (mission.phase === 'return' && departure) {
            if (departure.cargo.length > 0 && shipPassengers(s.units, boat).length > 0 && s.tick / TPS - departure.second <= 2) stats.immediateReturns.push({ ...departure, returnSecond: s.tick / TPS, emptyDestinationBlockedOrigin: departure.destinationEnemies.length === 0 && departure.originEnemies.length > 0 && departure.originCover.length === 0 });
            delete stats.pending[key];
          }
        }
        stats.previous = previous;
      }
    },
    finish: state => Object.fromEntries(Object.entries(state).map(([owner, { departures, immediateReturns }]) => [owner, { departures, immediateReturns }])),
  };
}

function assetPrice(snapshot: GameSnapshot, unit: Unit) {
  return isShipKind(unit.kind) ? SHIP_HULL_COST[unit.kind] + installedWeapons(snapshot, unit).reduce((sum, item) => sum + SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].cost, 0) : UNIT_DEFS[unit.kind].cost;
}

export function runBenchmarkParallelMatch(match: NavalRoomMatch) {
  const memories: Record<string, AiPolicyMemory> = {};
  const report = runBenchmarkMatch({ ...match, commandPlanner: navalObservedPlanner(memories) }, [createNavalLoadingDiagnostics(owner => memories[owner]) as never, createNavalTurnaroundDiagnostics(owner => memories[owner]) as never, createNavalMetricsTracker({ memory: owner => memories[owner], ferriesOnly: !match.naval.fullMetrics, sampleSeconds: match.naval.sampleSeconds }) as never]);
  if (match.naval.fullMetrics) report.result.trackers.navalFerries = report.result.trackers.naval;
  if (match.naval.outDir) {
    mkdirSync(match.naval.outDir, { recursive: true });
    writeFileSync(join(match.naval.outDir, `${match.name.replaceAll(' ', '_')}.json`), JSON.stringify({ naval: match.naval, ...report }));
  }
  return report;
}
