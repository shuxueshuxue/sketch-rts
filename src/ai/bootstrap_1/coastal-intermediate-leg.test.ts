import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { coastalBatteryWaypoint, coastalBombardment, continuingCoastalVoyage } from '../policy/coastal-bombardment';
import { coastalFireDisks, coastalLegArrivalSafe, coastalVoyagePrefixSafe, planCoastalIntermediateLeg } from '../policy/coastal-voyage';
import * as voyage from '../policy/coastal-voyage';
import * as navigation from '../../shared/ship-navigation';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';

const battery = 'unit-p0-bombardShip-50739';
function actual() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-installed-prefix-226650.json.gz', import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>; nextId: number;
  };
  const s = saved.snapshot, ship = s.units.find(u => u.id === battery)!;
  setBuildingBodies(s.map, [...s.buildings, ...s.obstacles ?? []]);
  const memory = structuredClone(saved.memories.p0!), current = memory.naval!.coastalVoyages![battery]!;
  return { saved, s, ship, current, options: { memory, teams: s.teams! }, goal: current.waypoint };
}
afterEach(() => vi.restoreAllMocks());

it('queries a complete ordinary leg before the actual installed hazardous suffix, keeping the strategic target separate', () => {
  const { saved, s, ship, current, options, goal } = actual(), before = JSON.stringify(saved);
  expect(coastalVoyagePrefixSafe(s, ship, ship.sailing!.route, options)).toBe(false);
  const leg = planCoastalIntermediateLeg(s, ship, goal, options)!;
  expect(leg.proof).toBe('leg');
  expect(leg.waypoint).toEqual({ x: 3170.1107608723505, y: 5312.77432524415 });
  expect(leg.waypoint).not.toEqual(goal);
  expect(leg).not.toHaveProperty('reference');
  expect(leg.legs).toHaveLength(1);
  expect(leg.legs[0]!.points.at(-1)).toMatchObject(leg.waypoint);
  expect(coastalVoyagePrefixSafe(s, ship, { points: leg.legs[0]!.points, partial: false }, options)).toBe(true);
  expect(coastalLegArrivalSafe(s, ship, leg.waypoint, options)).toBe(true);
  const target = s.buildings.find(b => b.id === current.targetId)!;
  expect(coastalBatteryWaypoint(s, ship, { ...current.goal, heading: 0, target, voyage: leg }, options)).toEqual(leg.waypoint);
  expect(options.memory.naval!.coastalVoyages![battery]).toEqual({ targetId: current.targetId, goal: current.goal, waypoint: leg.waypoint, proof: 'leg' });
  expect(JSON.stringify(saved)).toBe(before);
});

it('uses the observed same-target prefix leg without repeating the strategic voyage search', () => {
  const { s, ship, current, options } = actual(), target = s.buildings.find(b => b.id === current.targetId)!;
  const query = vi.spyOn(voyage, 'planCoastalVoyage');
  const plan = coastalBombardment(s, ship, [target], options)!;
  expect(plan.voyage?.proof).toBe('leg');
  expect(query).not.toHaveBeenCalled();
});

it('does not borrow another helm, queued action or rendezvous route as a coastal leg', () => {
  for (const changed of ['goal', 'queue', 'rendezvous'] as const) {
    const { s, ship, options, goal } = actual();
    if (changed === 'goal') goal.x += 1000;
    if (changed === 'queue') ship.orderQueue = [{ type: 'hold', x: ship.x, y: ship.y }];
    if (changed === 'rendezvous' && ship.order.type === 'move') ship.order.rendezvousFor = 'counterfactual-owner';
    expect(planCoastalIntermediateLeg(s, ship, goal, options)).toBeUndefined();
  }
});

it('does not publish a safe vertex when its independently queried ordinary route is partial', () => {
  const { s, ship, options, goal } = actual();
  vi.spyOn(navigation, 'planVoyageRoute').mockReturnValue({ points: [{ x: ship.x + 10, y: ship.y, heading: ship.sailing!.heading }], partial: true });
  expect(planCoastalIntermediateLeg(s, ship, goal, options)).toBeUndefined();
});

it('rejects an intermediate destination that can enter the existing policy fire envelope within one think', () => {
  const { s, ship, options } = actual(), mark = { x: 3170.1107608723505, y: 5312.77432524415 };
  const archer = s.units.find(u => u.id === 'unit-p1-archer-1263')!;
  const disk = coastalFireDisks(s, ship, options).find(d => d.id === archer.id)!;
  // Counterfactual enemy location only: current coverage stops 1px short of
  // the destination, but this actual archer can walk farther within 15 ticks.
  archer.x = mark.x + disk.radius + 1; archer.y = mark.y;
  expect(Math.hypot(archer.x - mark.x, archer.y - mark.y)).toBeGreaterThan(disk.radius);
  expect(coastalLegArrivalSafe(s, ship, mark, options)).toBe(false);
});

function installQueriedLeg() {
  const f = actual(), leg = planCoastalIntermediateLeg(f.s, f.ship, f.goal, f.options)!;
  const record = { ...f.current, waypoint: leg.waypoint, proof: 'leg' as const };
  f.options.memory.naval!.coastalVoyages![battery] = record;
  f.ship.order = { type: 'move', ...leg.waypoint, avoidCombat: true };
  f.ship.sailing!.route = { goalX: leg.waypoint.x, goalY: leg.waypoint.y, points: leg.legs[0]!.points, partial: false, end: leg.waypoint };
  return { ...f, leg, record };
}

it('retains a safe installed leg through JSON memory without stopping or re-querying its strategic goal', () => {
  const f = installQueriedLeg();
  f.options.memory = JSON.parse(JSON.stringify(f.options.memory)) as AiPolicyMemory;
  expect(continuingCoastalVoyage(f.s, f.ship, f.options)).toEqual(f.record);
  const query = vi.spyOn(voyage, 'planCoastalVoyage'), target = f.s.buildings.find(b => b.id === f.current.targetId)!;
  const plan = coastalBombardment(f.s, f.ship, [target], f.options)!;
  expect(coastalBatteryWaypoint(f.s, f.ship, plan, f.options)).toEqual(f.leg.waypoint);
  expect(query).not.toHaveBeenCalled();
});

it('releases a completed intermediate leg for strategic replanning even before a new native order is chosen', () => {
  const f = installQueriedLeg();
  f.ship.x = f.leg.waypoint.x; f.ship.y = f.leg.waypoint.y;
  expect(continuingCoastalVoyage(f.s, f.ship, f.options)).toBeUndefined();
  expect(f.options.memory.naval!.coastalVoyages![battery]!.goal).toEqual(f.current.goal);
});

it('rejects a newly unsafe installed leg rather than retaining a stale proof', () => {
  const f = installQueriedLeg(), enemy = f.s.units.find(u => u.id === 'unit-p1-archer-1263')!;
  enemy.x = f.leg.waypoint.x; enemy.y = f.leg.waypoint.y;
  expect(continuingCoastalVoyage(f.s, f.ship, f.options)).toBeUndefined();
});
