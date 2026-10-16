import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { coastalBatteryWaypoint, continuingCoastalVoyage } from '../policy/coastal-bombardment';
import * as voyage from '../policy/coastal-voyage';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';

function nearEnd() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-leg-near-end-1a-226890.json.gz', import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>; nextId: number;
  };
  const s = saved.snapshot, ship = s.units.find(u => u.id === 'unit-p0-bombardShip-50739')!;
  setBuildingBodies(s.map, [...s.buildings, ...s.obstacles ?? []]);
  const options = { memory: structuredClone(saved.memories.p0!), teams: s.teams! }, current = options.memory.naval!.coastalVoyages![ship.id]!;
  return { saved, s, ship, current, options };
}
afterEach(() => vi.restoreAllMocks());

it('keeps the actual 3px-away leg while its native route still has one safe point', () => {
  const { saved, s, ship, current, options } = nearEnd(), before = JSON.stringify(saved);
  expect(s.tick).toBe(226890);
  expect(current.proof).toBe('leg');
  expect(ship.order.type).toBe('move');
  expect(Math.hypot(ship.x - current.waypoint.x, ship.y - current.waypoint.y)).toBeLessThan(5);
  expect(ship.sailing!.route!.points).toHaveLength(1);
  expect(continuingCoastalVoyage(s, ship, options)).toEqual(current);
  const query = vi.spyOn(voyage, 'planCoastalVoyage'), target = s.buildings.find(b => b.id === current.targetId)!;
  expect(coastalBatteryWaypoint(s, ship, { ...current.goal, heading: 0, target }, options)).toEqual(current.waypoint);
  expect(query).not.toHaveBeenCalled();
  expect(JSON.stringify(saved)).toBe(before);
});

it('accepts only a matching complete empty route at the real waypoint as native completion', () => {
  const { s, ship, current, options } = nearEnd(), route = ship.sailing!.route!;
  // Counterfactual final native route state on the real close approach, not
  // an assertion that the original 1a simulation reached idle here.
  route.points = []; route.partial = false;
  route.end = { ...current.waypoint };
  ship.sailing!.planningRequestedAtTick = s.tick;
  ship.sailing!.planningLastRequestedAtTick = s.tick;
  expect(continuingCoastalVoyage(s, ship, options)).toBeUndefined();
  route.partial = true;
  expect(continuingCoastalVoyage(s, ship, options)).toEqual(current);
  route.partial = false; route.end = { x: current.waypoint.x + 100, y: current.waypoint.y };
  expect(continuingCoastalVoyage(s, ship, options)).toEqual(current);
});

it('lets native idle release the leg independently of a stale fresh job timestamp', () => {
  const { s, ship, current, options } = nearEnd();
  ship.order = { type: 'idle' }; ship.arrivedAt = { ...current.waypoint };
  expect(continuingCoastalVoyage(s, ship, options)).toBeUndefined();
});
