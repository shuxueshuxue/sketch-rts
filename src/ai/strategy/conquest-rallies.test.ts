import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import * as nativeRoads from '../../shared/route-selection';
import * as terrain from '../../shared/terrain';
import * as naval from '../../shared/naval';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import { conquestMethodProvider } from './conquest-methods';
import { bindConquestAssemblyPosts, conquestAssemblyPosts, withConquestAssemblyPlanning } from './conquest-rallies';
import type { AllocationLandRouteReader } from './allocation-arrival-query';
import { landIdAt } from './regions';

function example() {
  const frames: { frames: Record<string, { snapshot: GameSnapshot; memory: AiPolicyMemory; owner: string }> } = JSON.parse(gunzipSync(readFileSync(
    new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString());
  const frame = frames.frames['Ne-sapphireArchipelago-player-4-17991']!;
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(goal => goal.kind === 'ConquerIsland'
    && frame.snapshot.units.some(unit => unit.owner === frame.owner && unit.kind !== 'worker'
      && !unit.deck && !unit.cabin && landIdAt(frame.snapshot.map, unit) === goal.target.landId))!;
  expect(objective).toBeDefined();
  return { ...frame, situation: decision.situation, objective, methodId: 'planning-port' , executions: [] };
}

describe('controlled assembly rally route port', () => {
  it('keeps the original Ne input out of native full-field route calls when shared facts are pending', () => {
    const input = example(), saved = JSON.stringify(input.snapshot);
    const approach = vi.spyOn(nativeRoads, 'groundApproachRoute'), distance = vi.spyOn(terrain, 'walkingDistance'), reach = vi.spyOn(naval, 'canReach');
    const read = vi.fn<AllocationLandRouteReader>(() => ({ status: 'unknown', reasonCode: 'assembly-rally-route-pending' }));
    try {
      const posts = withConquestAssemblyPlanning(read, () => conquestAssemblyPosts(input));
      expect(read).toHaveBeenCalled(); expect(approach).not.toHaveBeenCalled(); expect(distance).not.toHaveBeenCalled(); expect(reach).not.toHaveBeenCalled();
      expect(posts.every(post => post.target.landId === landIdAt(input.snapshot.map, post.target.point))).toBe(true);
      expect(JSON.stringify(input.snapshot)).toBe(saved);
    } finally { vi.restoreAllMocks(); }
  });

  it('consumes known route points and distance from one callback and restores native execution outside the scope', () => {
    const input = example();
    // Constant port facts prove routing ownership, not a physical ETA or work budget.
    const read = vi.fn<AllocationLandRouteReader>((_from, goal) => ({ status: 'known', points: [goal], distance: 100 }));
    const approach = vi.spyOn(nativeRoads, 'groundApproachRoute'), distance = vi.spyOn(terrain, 'walkingDistance');
    try {
      withConquestAssemblyPlanning(read, () => conquestAssemblyPosts(input));
      expect(read).toHaveBeenCalled(); expect(approach).not.toHaveBeenCalled(); expect(distance).not.toHaveBeenCalled();
      conquestAssemblyPosts(input);
      expect(approach).toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });

  it('restores an outer reader after nested planning and an exception', () => {
    const input = example();
    const outer = vi.fn<AllocationLandRouteReader>(() => ({ status: 'unknown', reasonCode: 'outer-pending' }));
    const inner = vi.fn<AllocationLandRouteReader>(() => ({ status: 'unreachable', reasonCode: 'inner-unreachable' }));
    withConquestAssemblyPlanning(outer, () => {
      conquestAssemblyPosts(input); const before = outer.mock.calls.length;
      expect(() => withConquestAssemblyPlanning(inner, () => { conquestAssemblyPosts(input); throw new Error('nested'); })).toThrow('nested');
      expect(inner).toHaveBeenCalled(); conquestAssemblyPosts(input); expect(outer.mock.calls.length).toBeGreaterThan(before);
    });
    const count = outer.mock.calls.length;
    conquestAssemblyPosts(input); expect(outer).toHaveBeenCalledTimes(count);
  });

  it('preserves unknown pending prerequisites when no safe fallback post exists and avoids nearby-foe native reachability', () => {
    const input = example();
    // All nearby candidate points are covered by an actual enemy. This derived
    // threat case checks conservative planning, not the original Ne behavior.
    const opponent = input.snapshot.units.find(unit => unit.owner !== input.owner && unit.owner !== 'neutral')!;
    expect(opponent).toBeDefined(); opponent.x = input.objective.target.point.x; opponent.y = input.objective.target.point.y;
    opponent.attackRange = input.snapshot.map.width * 4; opponent.attackDamage = 100;
    const distance = vi.spyOn(terrain, 'walkingDistance'), approach = vi.spyOn(nativeRoads, 'groundApproachRoute'), reach = vi.spyOn(naval, 'canReach');
    const read: AllocationLandRouteReader = () => ({ status: 'unknown', reasonCode: 'assembly-rally-route-pending' });
    const ids = input.snapshot.units.filter(unit => unit.owner === input.owner && unit.kind !== 'worker' && unit.attackDamage > 0
      && !unit.deck && !unit.cabin && landIdAt(input.snapshot.map, unit) === input.objective.target.landId).map(unit => unit.id);
    try {
      const result = withConquestAssemblyPlanning(read, () => bindConquestAssemblyPosts({ ...input, unitIds: ids }));
      expect(result.missing.some(item => item.reason.code === 'assembly-rally-route-pending')).toBe(true);
      expect(result.missing.every(item => item.status === 'unknown')).toBe(true);
      expect(reach).not.toHaveBeenCalled(); expect(distance).not.toHaveBeenCalled(); expect(approach).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });

  it('covers method construction as well as later materialization in the same planning scope', () => {
    const input = example(), read = vi.fn<AllocationLandRouteReader>(() => ({ status: 'unknown', reasonCode: 'assembly-rally-route-pending' }));
    const approach = vi.spyOn(nativeRoads, 'groundApproachRoute'), distance = vi.spyOn(terrain, 'walkingDistance');
    try {
      const methods = withConquestAssemblyPlanning(read, () => conquestMethodProvider.buildMethods({ ...input, previous: null, blocked: [] }));
      expect(methods).toHaveLength(1); expect(read).toHaveBeenCalled(); expect(approach).not.toHaveBeenCalled(); expect(distance).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });
});
