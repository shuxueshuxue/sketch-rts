import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { coastalBoardingThreats, coastalWithdrawalArrived, coastalWithdrawalCrewCommands, outmatchingBoarders } from './coastal-boarding';
import { outmatchingCoast } from './coastal-risk';
import { coastalFireDisks, coastalFireSegmentClear } from './coastal-voyage';

// Exact normal d352 beforeP0, SHA256 e3e2d79e4a09d9739e6152e3fb04dfa125f5a4c5461dadeca4df04bb5823aa42.
function actual() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-mortar-boarding-232740.json.gz', import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = saved.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  beginShipCollisionFrame(snapshot.units, snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const ship = snapshot.units.find(unit => unit.id === 'unit-p0-bombardShip-50739')!;
  const crew = snapshot.units.find(unit => unit.id === 'unit-p0-emberRavager-23742')!;
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', { memory: saved.memories.p0! });
  return { snapshot, ship, crew, options };
}

describe('coastal boarding and withdrawing deck duties', () => {
  it('sees the real accessible deck orders before the current odds predicate admits a coast threat', () => {
    const { snapshot, ship, options } = actual();
    expect(outmatchingCoast(snapshot, ship.owner, ship, ship, options)).toEqual([]);
    const pose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    expect(coastalFireSegmentClear(pose, pose, coastalFireDisks(snapshot, ship, options))).toBe(false);
    const threats = coastalBoardingThreats(snapshot, ship, options);
    expect(threats.map(unit => unit.id).sort()).toEqual([
      'unit-p1-archer-1146', 'unit-p1-archer-1263', 'unit-p1-archer-1572',
      'unit-p1-footman-11807', 'unit-p2-emberRavager-1081',
      'unit-p2-emberRavager-1183', 'unit-p2-emberRavager-1286',
    ].sort());
    expect(outmatchingBoarders(snapshot, ship, options).map(unit => unit.id).sort()).toEqual(threats.map(unit => unit.id).sort());
  });

  it('does not infer a deck order from a nearby normal attack or its world coordinates', () => {
    const { snapshot, ship, options } = actual();
    for (const foe of coastalBoardingThreats(snapshot, ship, options)) {
      foe.order = { type: 'attackMove', x: ship.x, y: ship.y };
    }
    expect(coastalBoardingThreats(snapshot, ship, options)).toEqual([]);
  });

  it('does not turn dead, friendly, already attached, or wrong-deck troops into approaching boarders', () => {
    const { snapshot, ship, options } = actual();
    const threats = coastalBoardingThreats(snapshot, ship, options);
    for (const [i, foe] of threats.entries()) {
      if (i % 4 === 0) foe.hp = 0;
      else if (i % 4 === 1) foe.owner = ship.owner;
      else if (i % 4 === 2) foe.deck = { shipId: ship.id, x: 0, y: 0 };
      else foe.order = { type: 'attackMove', x: ship.x, y: ship.y, deckShipId: 'another-hull' };
    }
    expect(coastalBoardingThreats(snapshot, ship, options)).toEqual([]);
  });

  it('requires the actual native ground road rather than a deck intention from another island', () => {
    const { snapshot, ship, options } = actual();
    const threats = coastalBoardingThreats(snapshot, ship, options);
    const candidate = threats.find(unit => unit.id === 'unit-p2-emberRavager-1183')!;
    for (const foe of threats.filter(unit => unit !== candidate)) foe.order = { type: 'idle' };
    const hall = snapshot.buildings.find(building => building.owner === candidate.owner && building.kind === 'townHall')!;
    candidate.x = hall.x; candidate.y = hall.y;
    expect(coastalBoardingThreats(snapshot, ship, options)).toEqual([]);
  });

  it('keeps the existing odds against an actual wounded attacker that the sole deck defender can beat', () => {
    const { snapshot, ship, options } = actual();
    for (const foe of coastalBoardingThreats(snapshot, ship, options)) {
      if (foe.id !== 'unit-p2-emberRavager-1183') foe.order = { type: 'idle' };
    }
    expect(coastalBoardingThreats(snapshot, ship, options)).toHaveLength(1);
    expect(outmatchingBoarders(snapshot, ship, options)).toEqual([]);
  });

  it('holds the actual idle sole defender and stops an off-deck pursuit', () => {
    const { snapshot, ship, crew } = actual();
    expect(coastalWithdrawalCrewCommands(snapshot, ship)).toEqual([{ type: 'holdPosition', unitIds: [crew.id] }]);
    crew.order = { type: 'attack', targetId: 'unit-p2-emberRavager-1183' };
    expect(coastalWithdrawalCrewCommands(snapshot, ship)).toEqual([{ type: 'holdPosition', unitIds: [crew.id] }]);
  });

  it('retains real deck defense and higher work or transfer orders', () => {
    const { snapshot, ship, crew } = actual();
    const intruder = snapshot.units.find(unit => unit.id === 'unit-p2-emberRavager-1183')!;
    intruder.deck = { shipId: ship.id, x: 0, y: 0 };
    crew.order = { type: 'attack', targetId: intruder.id };
    expect(coastalWithdrawalCrewCommands(snapshot, ship)).toEqual([]);
    crew.order = { type: 'board', transportId: 'other-hull' };
    expect(coastalWithdrawalCrewCommands(snapshot, ship)).toEqual([]);
    crew.order = { type: 'idle' };
    crew.orderQueue = [{ type: 'move', x: 1, y: 2 }];
    expect(coastalWithdrawalCrewCommands(snapshot, ship)).toEqual([]);
    crew.orderQueue = [];
    crew.cabin = { shipId: ship.id };
    expect(coastalWithdrawalCrewCommands(snapshot, ship)).toEqual([]);
  });

  it('keeps a boarding withdrawal through the final native approach and requires the same completed public goal', () => {
    const { ship } = actual();
    const goal = { x: ship.x + 40, y: ship.y };
    expect(coastalWithdrawalArrived(ship, goal)).toBe(false);
    const route = ship.sailing!.route!;
    route.goalX = goal.x; route.goalY = goal.y; route.partial = false; route.points = [];
    ship.arrivedAt = { ...goal }; ship.order = { type: 'idle' };
    // Empty stale route memory by itself does not mean arrival.
    expect(coastalWithdrawalArrived(ship, goal)).toBe(false);
    ship.x = goal.x; ship.y = goal.y;
    expect(coastalWithdrawalArrived(ship, goal)).toBe(true);
    ship.order = { type: 'move', ...goal, avoidCombat: true };
    expect(coastalWithdrawalArrived(ship, goal)).toBe(false);
    ship.order = { type: 'idle' }; route.points = [{ ...goal, heading: ship.sailing!.heading }];
    expect(coastalWithdrawalArrived(ship, goal)).toBe(false);
    route.points = []; route.partial = true;
    expect(coastalWithdrawalArrived(ship, goal)).toBe(false);
    route.partial = false; route.goalX++;
    expect(coastalWithdrawalArrived(ship, goal)).toBe(false);
    route.goalX = goal.x; ship.arrivedAt.x++;
    expect(coastalWithdrawalArrived(ship, goal)).toBe(false);
  });
});
