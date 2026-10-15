import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { shipPassengers } from '../../shared/ship-geometry';
import { sameGround, setBuildingBodies, walkingDistance } from '../../shared/terrain';
import { planNavalTacticsWithAssignments } from '../policy/naval';
import { bootstrapPolicyContext } from './policy';
import { assaultBeachExposure, orderBootstrapAssaultLanding } from './assault-beach';

const first = 'unit-p0-carrier-3824', companion = 'unit-p0-carrier-3510';
const oldTarget = 'building-p1-shipyard-1016', liveTarget = 'building-p1-townhall';
const ferryIds = [first, companion];
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

// The full 89625 world, nextId and both policy memories are a real saved game.
// Every objective change below is explicitly counterfactual. These are focused
// planner/native-step regressions, not evidence of an observed match failure.
function load() {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/assault-deployment-original-89625.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  expect(json(snapshotGame(game))).toEqual(frame.snapshot);
  expect(game.nextId).toBe(frame.nextId);
  return { game, memories: structuredClone(frame.memories) };
}

function distinctObjectives(removeOldTarget: boolean) {
  const state = load(), { game, memories } = state;
  const old = game.buildings.find(building => building.id === oldTarget)!;
  const live = game.buildings.find(building => building.id === liveTarget)!;
  expect(sameGround(game.map, old, live)).toBe(true);
  for (const id of ferryIds) memories.p0.naval.ferries[id].targetGround = { x: old.x, y: old.y };
  memories.p0.naval.ferries[companion].targetId = live.id;
  if (removeOldTarget) game.buildings = game.buildings.filter(building => building.id !== old.id);
  setBuildingBodies(game.map, [...game.buildings, ...(game.obstacles ?? [])]);
  return state;
}

function query(state: ReturnType<typeof load>, version: 'v9_archer' | 'v9_summoner' | 'v9_knight' = 'v9_archer') {
  const snapshot = snapshotGame(state.game), beforeWorld = json(snapshot);
  const otherMemories = Object.fromEntries(Object.entries(state.memories).filter(([owner]) => owner !== 'p0'));
  const beforeOthers = structuredClone(otherMemories);
  const context = bootstrapPolicyContext(snapshot, 'p0', version, { teams: snapshot.teams!, memory: state.memories.p0 });
  const commands = planNavalTacticsWithAssignments(snapshot, 'p0', context, {
    orderCrew: crew => crew,
    mineEligible: () => true,
    targetAvailable: () => true,
    transportReady: () => false,
    troopAvailable: () => false,
    orderAssaultLanding: (boat, goal, ordinary) => orderBootstrapAssaultLanding(snapshot, 'p0', context, boat, goal, ordinary),
  });
  expect(json(snapshot)).toEqual(beforeWorld);
  expect(otherMemories).toEqual(beforeOthers);
  return { snapshot, context, commands, ferries: context.memory.naval!.ferries! };
}

function preservedMission(mission: any) {
  // The existing planner legitimately refreshes progress after a moving ship
  // advances; retargeting only changes objective identity and its ground point.
  const { targetId, targetGround, progress, ...preserved } = mission;
  return preserved;
}

describe('counterfactual fallen objective preserves the real 89625 deployment convoy', () => {
  it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s keeps both actual loaded boats sailing and waits before committing either half', version => {
    const state = distinctObjectives(true);
    const before = structuredClone(state.memories.p0.naval.ferries);
    const world = snapshotGame(state.game), firstBoat = world.units.find(unit => unit.id === first)!;
    const secondBoat = world.units.find(unit => unit.id === companion)!;
    expect(walkingDistance(world.map, firstBoat, secondBoat, 'sea')).toBe(294.4);
    const passengers = ferryIds.map(id => shipPassengers(world.units, world.units.find(unit => unit.id === id)!).map(unit => unit.id));
    expect(passengers.map(group => group.length)).toEqual([15, 14]);

    const { snapshot, context, commands, ferries } = query(state, version);
    const selected = snapshot.buildings.find(building => building.id === ferries[first]!.targetId)!;
    expect(selected.owner).toBe('p1');
    expect(selected.id).not.toBe(oldTarget);
    expect(sameGround(snapshot.map, before[first].targetGround, selected)).toBe(true);
    for (const id of ferryIds) {
      expect(ferries[id]!.targetId).toBe(selected.id);
      expect(ferries[id]!.targetGround).toEqual({ x: selected.x, y: selected.y });
      expect(ferries[id]!.phase).toBe('sailing');
      expect(preservedMission(ferries[id])).toEqual(preservedMission(before[id]));
    }
    expect(assaultBeachExposure(snapshot, 'p0', context, firstBoat, ferries[first]!.to, selected, true)?.guards).toEqual([]);
    expect(assaultBeachExposure(snapshot, 'p0', context, secondBoat, ferries[companion]!.to, selected, true)).toBeUndefined();
    expect(commands.filter(command => 'unitIds' in command && command.unitIds.includes(first))).toEqual([{ type: 'stop', unitIds: [first] }]);
    expect(commands.some(command => command.type === 'unloadPassenger' && ferryIds.includes(command.transportId))).toBe(false);
    expect(commands.some(command => command.type === 'unload' && command.unitIds.some(id => ferryIds.includes(id)))).toBe(false);

    for (const command of commands) issuePlayerCommand(state.game, 'p0', command);
    stepGame(state.game);
    expect(state.game.tick).toBe(89626);
    for (let index = 0; index < ferryIds.length; index++) {
      const boat = state.game.units.find(unit => unit.id === ferryIds[index])!;
      expect(shipPassengers(state.game.units, boat).map(unit => unit.id).sort()).toEqual([...passengers[index]!].sort());
    }
  });

  it('preserves the live companion sea goal even without a selected approach', () => {
    const state = distinctObjectives(true);
    delete state.memories.p0.naval.ferries[companion].approach;
    const before = structuredClone(state.memories.p0.naval.ferries[companion]);
    const { ferries } = query(state);
    expect(ferries[companion]!.targetId).toBe(ferries[first]!.targetId);
    expect(ferries[companion]!.phase).toBe('sailing');
    expect(preservedMission(ferries[companion])).toEqual(preservedMission(before));
    expect(ferries[companion]!.to).toEqual(before.to);
    expect(ferries[companion]!.approach).toBeUndefined();
  });

  it('keeps two live objectives distinct when no real boat has a stale target', () => {
    const state = distinctObjectives(false), before = structuredClone(state.memories.p0.naval.ferries);
    const { ferries } = query(state);
    expect(ferries[first]!.targetId).toBe(oldTarget);
    expect(ferries[companion]!.targetId).toBe(liveTarget);
    for (const id of ferryIds) {
      expect(ferries[id]!.to).toEqual(before[id].to);
      expect(ferries[id]!.approach).toEqual(before[id].approach);
    }
  });

  it('does not synchronize a mission observed on another actual landmass', () => {
    const state = distinctObjectives(true), { game, memories } = state;
    const otherIsland = game.buildings.find(building => building.id === 'building-p0-townHall-1811')!;
    const chosen = game.buildings.find(building => building.id === 'building-p1-farm-1076')!;
    expect(sameGround(game.map, otherIsland, chosen)).toBe(false);
    // A second explicit boundary construction: this mission once observed a
    // now-missing objective on the real northern island. No building is moved
    // or added. Keep the global plan fresh so this test selects the south isle.
    const mission = memories.p0.naval.ferries[companion];
    mission.targetId = 'counterfactual-fallen-objective-on-northern-island';
    mission.targetGround = { x: otherIsland.x, y: otherIsland.y };
    memories.p0.naval.assault = { tick: game.tick, plan: { targetId: chosen.id, landing: { x: 2192, y: 6096 } } };
    const before = structuredClone(mission);
    const { ferries } = query(state);
    expect(ferries[first]!.targetId).toBe(chosen.id);
    // The first boat can independently fail ordinary strength admission once
    // the companion belongs to another island. Do not demand that it launch.
    expect(ferries[companion]!.targetId).toBe(before.targetId);
    expect(ferries[companion]!.targetGround).toEqual(before.targetGround);
    expect(ferries[companion]!.to).toEqual(before.to);
    expect(ferries[companion]!.approach).toEqual(before.approach);
    // Its own missing objective still receives ordinary cancellation.
    expect(ferries[companion]!.phase).toBe('return');
  });
});
