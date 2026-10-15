import { describe, expect, it } from 'vitest';
import { createMap, createUnit } from './map';
import {
  advanceLiveShipRouteSearch, advanceShipRouteSearch, beginLiveShipRouteSearch,
  hullPassageClear, planShipRoute, type ShipPose, type ShipRouteSearchState,
} from './ship-navigation';
import type { GameMap } from './types';

function coast() {
  const cell = 32, cols = 80, rows = 64;
  const map: GameMap = { ...createMap('bareDuel'), width: cols * cell, height: rows * cell,
    wind: { direction: Math.PI / 2, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, i) =>
      i % cols >= 32 && i % cols < 45 && Math.floor(i / cols) >= 20 && Math.floor(i / cols) < 45
        ? '.' : '~').join('') } };
  const ship = createUnit('route', 'player', 'transport', 16.5 * cell, 32.5 * cell);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  return { map, ship, goal: { x: 62.5 * cell, y: 32.5 * cell } };
}

function reentrantCoast() {
  const cell = 32, cols = 48, rows = 40;
  const map: GameMap = { ...createMap('bareDuel'), width: cols * cell, height: rows * cell,
    wind: { direction: Math.PI / 2, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, i) =>
      i % cols >= 22 && i % cols <= 25 && Math.floor(i / cols) >= 11 && Math.floor(i / cols) <= 28
        ? '.' : '~').join('') } };
  const ship = createUnit('outer', 'player', 'cutter', 8.5 * cell, 20.5 * cell);
  const inner = createUnit('inner', 'player', 'cutter', 8.5 * cell, 15.5 * cell);
  for (const vessel of [ship, inner]) vessel.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  return { map, ship, inner, goal: { x: 39.5 * cell, y: 20.5 * cell } };
}

type Scene = ReturnType<typeof coast>;
type Traffic = (from: ShipPose, to: ShipPose) => boolean;
type Result = ReturnType<typeof planShipRoute> | undefined;

function traced(traffic: Traffic, events: number[]): Traffic {
  return (from, to) => {
    events.push(from.x, from.y, from.heading, to.x, to.y, to.heading);
    return traffic(from, to);
  };
}

// A live search keeps its graph records in memory between slices; every
// cursor a slice saves must still equal the general (saved-record) search's.
function cursor(state: ShipRouteSearchState): Record<string, unknown> {
  const { nodes: _nodes, trafficFits: _traffic, heap: _heap, prefixes: _prefixes, entrances: _entrances, fallback, ...rest } = state;
  return { ...rest, ...(fallback ? { fallback: cursor(fallback) } : {}) };
}

function primed(scene: Scene, live: boolean): ShipRouteSearchState {
  const state: ShipRouteSearchState = live ? beginLiveShipRouteSearch() : { phase: 'prepare' };
  const advance = live ? advanceLiveShipRouteSearch : advanceShipRouteSearch;
  for (let slice = 0; state.phase !== 'search' && slice < 80; slice++) {
    expect(advance(scene.map, scene.ship, scene.goal, () => true, Infinity, true, state)).toBeUndefined();
  }
  expect(state.phase).toBe('search');
  if (!live) {
    expect(state.nodes!.length).toBeGreaterThan(0);
    expect(state.heap!.length).toBeGreaterThan(0);
  }
  return state;
}

function assertDoneAliases(state: ShipRouteSearchState, result: Result) {
  if (!result) return;
  expect(result).toBe(state.result);
  if (state.path) expect(result.points).toBe(state.path);
}

describe('live ship planning continuation integration', () => {
  it('retains every yield, callback, record order and alias through bounded, coastal and fallback searches', () => {
    const scene = coast();
    const cases = [
      { budget: 12, traffic: (from: ShipPose, to: ShipPose) => Math.max(from.y, to.y) <= 44 * 32, fallback: false },
      { budget: Infinity, traffic: (from: ShipPose, to: ShipPose) => Math.max(from.y, to.y) <= 44 * 32, fallback: false },
      { budget: Infinity, traffic: (from: ShipPose, to: ShipPose) =>
        Math.min(from.y, to.y) >= 20 * 32 && Math.max(from.y, to.y) <= 45 * 32, fallback: true },
    ];
    for (const testCase of cases) {
      const expected = planShipRoute(scene.map, scene.ship, scene.goal, testCase.traffic, testCase.budget, true);
      const live = beginLiveShipRouteSearch(), general: ShipRouteSearchState = { phase: 'prepare' };
      let decoded: ShipRouteSearchState = { phase: 'prepare' };
      const phases = new Set<string>();
      let result: Result, steps = 0;
      while (!result && steps++ < 500) {
        const liveEvents: number[] = [], generalEvents: number[] = [], decodedEvents: number[] = [];
        const generalResult = advanceShipRouteSearch(scene.map, scene.ship, scene.goal,
          traced(testCase.traffic, generalEvents), testCase.budget, true, general);
        const decodedResult = advanceLiveShipRouteSearch(scene.map, scene.ship, scene.goal,
          traced(testCase.traffic, decodedEvents), testCase.budget, true, decoded);
        result = advanceLiveShipRouteSearch(scene.map, scene.ship, scene.goal,
          traced(testCase.traffic, liveEvents), testCase.budget, true, live);
        expect(cursor(live)).toEqual(cursor(general));
        expect(decoded).toEqual(general);
        expect(result).toEqual(generalResult);
        expect(decodedResult).toEqual(generalResult);
        expect(liveEvents).toEqual(generalEvents);
        expect(decodedEvents).toEqual(generalEvents);
        assertDoneAliases(live, result);
        assertDoneAliases(general, generalResult);
        assertDoneAliases(decoded, decodedResult);
        phases.add(live.phase);
        decoded = JSON.parse(JSON.stringify(decoded));
        // Interleave a different complete query against the shared scratch.
        planShipRoute(scene.map, scene.ship, { x: 600, y: 300 }, undefined, 8, true);
      }
      expect(steps).toBeGreaterThan(2);
      expect(result).toEqual(expected);
      expect(phases.has('entrance')).toBe(true);
      expect(phases.has('search')).toBe(true);
      expect(phases.has('fallback')).toBe(testCase.fallback);
      if (testCase.fallback) expect(result!.partial).toBe(true);
      if (Number.isFinite(testCase.budget)) expect(live.visited).toBeLessThanOrEqual(testCase.budget + 1);
      let previous = { x: scene.ship.x, y: scene.ship.y, heading: scene.ship.sailing!.heading };
      for (const point of result!.points) {
        expect(hullPassageClear(scene.map, scene.ship, previous, point)).toBe(true);
        previous = point;
      }
    }
  }, 60_000);

  it('isolates nested searches and restores scratch depth after search-phase callback errors', () => {
    const scene = reentrantCoast();
    const live = primed(scene, true), general = primed(scene, false);
    expect(cursor(live)).toEqual(cursor(general));
    const failure = new Error('nested live traffic query failed');
    const events: number[] = [], expectedEvents: number[] = [];
    let calls = 0, innerCalls = 0;
    const result = advanceLiveShipRouteSearch(scene.map, scene.ship, scene.goal, traced(() => {
      if (++calls === 1) {
        expect(() => planShipRoute(scene.map, scene.inner, scene.goal, () => {
          if (++innerCalls === 180) throw failure;
          return true;
        }, 2, true)).toThrow(failure);
      }
      return true;
    }, events), Infinity, true, live);
    const expected = advanceShipRouteSearch(scene.map, scene.ship, scene.goal,
      traced(() => true, expectedEvents), Infinity, true, general);
    expect(innerCalls).toBe(180);
    expect(calls).toBeGreaterThan(0);
    expect(result).toEqual(expected);
    expect(cursor(live)).toEqual(cursor(general));
    expect(events).toEqual(expectedEvents);
    assertDoneAliases(live, result);
    assertDoneAliases(general, expected);

    const interrupted = primed(scene, true);
    let outerCalls = 0;
    expect(() => advanceLiveShipRouteSearch(scene.map, scene.ship, scene.goal, () => {
      if (++outerCalls === 1) {
        planShipRoute(scene.map, scene.inner, scene.goal, undefined, 2, true);
        throw failure;
      }
      return true;
    }, Infinity, true, interrupted)).toThrow(failure);
    expect(outerCalls).toBe(1);

    // A callback exception is not a transaction rollback. Test recovery with
    // fresh state, and compare each real subsequent slice in both interfaces.
    const freshLive = primed(scene, true), freshGeneral = primed(scene, false);
    let recovered: Result, slices = 0;
    while (!recovered && slices++ < 300) {
      const actualEvents: number[] = [], controlEvents: number[] = [];
      recovered = advanceLiveShipRouteSearch(scene.map, scene.ship, scene.goal,
        traced(() => true, actualEvents), Infinity, true, freshLive);
      const control = advanceShipRouteSearch(scene.map, scene.ship, scene.goal,
        traced(() => true, controlEvents), Infinity, true, freshGeneral);
      expect(recovered).toEqual(control);
      expect(cursor(freshLive)).toEqual(cursor(freshGeneral));
      expect(actualEvents).toEqual(controlEvents);
      assertDoneAliases(freshLive, recovered);
      assertDoneAliases(freshGeneral, control);
    }
    expect(recovered).toEqual(planShipRoute(scene.map, scene.ship, scene.goal, () => true, Infinity, true));
    expect(planShipRoute(scene.map, scene.inner, scene.goal, undefined, 2, true))
      .toEqual(planShipRoute(scene.map, scene.inner, scene.goal, () => true, 2, true));
  }, 60_000);
});
