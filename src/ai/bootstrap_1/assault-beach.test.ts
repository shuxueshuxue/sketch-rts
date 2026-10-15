import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { shipPassengers } from '../../shared/ship-geometry';
import { setBuildingBodies, walkingDistance } from '../../shared/terrain';
import { bootstrapPolicyContext } from './policy';
import { assaultExpedition } from '../policy/naval';
import { effectiveCombatRating } from '../policy/v6/strength';
import { assaultBeachBodies, assaultBeachExposure, orderBootstrapAssaultLanding, reviseAssaultBeaches } from './assault-beach';

// Full real worlds + both policy memories. 88110 is the unmanipulated saved
// match; 89040 is its original both-AI source continuation's first cancellation.
// This is a query regression, not a fresh opening or a new family match.
const fixture = (tick: number) => {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/assault-deployment-original-${tick}.json.gz`, import.meta.url))).toString());
  setBuildingBodies(frame.snapshot.map, [...frame.snapshot.buildings, ...(frame.snapshot.obstacles ?? [])]);
  return frame;
};

describe('native assault deployment shore', () => {
  it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('does not admit %s\'s real convoy after counting its worker defender', version => {
    const f = fixture(88110), snapshot = f.snapshot;
    const beforeWorld = structuredClone(snapshot);
    const context = bootstrapPolicyContext(snapshot, 'p0', version, { teams: snapshot.teams, memory: f.memories.p0 });
    const ferries = context.memory.naval!.ferries!;
    const ids = ['unit-p0-carrier-3510', 'unit-p0-carrier-3824'];
    const before = structuredClone(Object.fromEntries(ids.map(id => [id, ferries[id]])));
    const target = snapshot.buildings.find((building: any) => building.id === 'building-p1-shipyard-1016')!;
    const requirement = assaultExpedition(snapshot, 'p0', context, target).required;
    expect(requirement).toBeCloseTo(19.629201854308317);
    const power = ids.flatMap(id => shipPassengers(snapshot.units, snapshot.units.find((unit: any) => unit.id === id)!))
      .filter(unit => unit.kind !== 'worker' && !unit.expiresTick)
      .reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
    expect(power).toBeCloseTo(19.271213354543637);
    expect(power).toBeLessThan(requirement);
    const old = ids.map(id => assaultBeachExposure(snapshot, 'p0', context,
      snapshot.units.find((unit: any) => unit.id === id)!, ferries[id]!.to, target)!);
    expect(old.every(query => query.guards.length >= 20)).toBe(true);
    reviseAssaultBeaches(snapshot, 'p0', context);
    expect(Object.fromEntries(ids.map(id => [id, ferries[id]]))).toEqual(before);
    for (const id of ids) {
      const boat = snapshot.units.find((unit: any) => unit.id === id)!;
      // The previous clear beach still has native passenger bodies. Geometry
      // alone must not admit a convoy that fails the updated force estimate.
      const selected = assaultBeachExposure(snapshot, 'p0', context, boat, { x: 2416, y: 6736 }, target)!;
      expect(selected.landed).toHaveLength(id.endsWith('3510') ? 14 : 15);
      expect(selected.guards).toEqual([]);
      expect(walkingDistance(snapshot.map, boat, selected.pose, 'sea')).toBeDefined();
    }
    expect(assaultExpedition(snapshot, 'p0', context, target).required).toBe(requirement);
    expect(snapshot).toEqual(beforeWorld);
  });

  it('does not re-admit the real understrength convoy after the new enemy summon', () => {
    const f = fixture(89040), context = bootstrapPolicyContext(f.snapshot, 'p0', 'v9_archer', { teams: f.snapshot.teams, memory: f.memories.p0 });
    const before = structuredClone(context.memory);
    reviseAssaultBeaches(f.snapshot, 'p0', context);
    expect(context.memory).toEqual(before);
  });

  it('does not restore a cancelled enemy-shore mission', () => {
    const f = fixture(88110), context = bootstrapPolicyContext(f.snapshot, 'p0', 'v9_archer', { teams: f.snapshot.teams, memory: f.memories.p0 });
    for (const mission of Object.values(context.memory.naval!.ferries!)) if (mission.purpose === 'assault') mission.phase = 'return';
    const before = structuredClone(context.memory);
    reviseAssaultBeaches(f.snapshot, 'p0', context);
    expect(context.memory).toEqual(before);
  });
});


it('keeps the 89145 native shore geometry when a clear beach approach has already been assigned', () => {
  const f = fixture(89145);
  expect(f.provenance.replayProof).toEqual({ snapshot: true, nextId: true, memories: true });
  const branches = [structuredClone(f), JSON.parse(JSON.stringify(f))].map(frame => {
    const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
    return { game, memory: frame.memories.p0 };
  });
  const shipId = 'unit-p0-carrier-3824';
  // In the original full-AI run the existing unload can release 12 passengers
  // at y~6300 while its intended clear beach is y6832. No body is teleported.
  const control = branches[0]!, controlled = branches[1]!;
  const initial = shipPassengers(control.game.units, control.game.units.find(unit => unit.id === shipId)!);
  expect(initial).toHaveLength(15);
  const world = f.snapshot;
  const boat = world.units.find((unit: any) => unit.id === shipId)!;
  const context = bootstrapPolicyContext(world, 'p0', 'v9_archer', { teams: world.teams, memory: controlled.memory });
  const mission = context.memory.naval!.ferries![shipId]!;
  const target = world.buildings.find((building: any) => building.id === mission.targetId)!;
  // Geometry component seam: the updated force estimate no longer admits
  // this historical convoy. Supply its previous planner's observed clear
  // beach explicitly; no native world, passengers or resources are altered.
  expect(assaultExpedition(world, 'p0', context, target).required).toBeCloseTo(19.629201854308317);
  mission.to = { x: 2384, y: 6832 };
  mission.approach = { x: 2480, y: 6832 };
  const placement = assaultBeachBodies(world, boat, mission.to, target)!;
  expect(mission.approach).toEqual({ x: placement.pose.x, y: placement.pose.y });
  const ordinary = [{ type: 'unload' as const, unitIds: [shipId], ...mission.to }];
  const commands = orderBootstrapAssaultLanding(world, 'p0', context, boat, mission.to, ordinary);
  expect(commands).toEqual([{ type: 'move', unitIds: [shipId], ...mission.approach, avoidCombat: true }]);
  expect(assaultBeachExposure(world, 'p0', context, boat, mission.to, target, true)).toBeUndefined();
  for (const entry of f.expectedOldCommands) {
    issuePlayerCommand(control.game, entry.owner, entry.command);
    if (entry.command.type === 'unload' && entry.command.unitIds.includes(shipId)) {
      for (const command of commands) issuePlayerCommand(controlled.game, 'p0', command);
    } else issuePlayerCommand(controlled.game, entry.owner, entry.command);
  }
  stepGame(control.game); stepGame(controlled.game);
  expect(JSON.parse(JSON.stringify(snapshotGame(control.game)))).toEqual(f.expectedOldAfter.snapshot);
  expect(control.game.nextId).toBe(f.expectedOldAfter.nextId);
  expect(shipPassengers(control.game.units, control.game.units.find(unit => unit.id === shipId)!)).toHaveLength(3);
  expect(shipPassengers(controlled.game.units, controlled.game.units.find(unit => unit.id === shipId)!)).toHaveLength(15);
});

it('returns the exact ordinary commands for a cancelled approach without restoring its mission', () => {
  const f = fixture(88110), context = bootstrapPolicyContext(f.snapshot, 'p0', 'v9_archer', { teams: f.snapshot.teams, memory: f.memories.p0 });
  const boat = f.snapshot.units.find((unit: any) => unit.id === 'unit-p0-carrier-3510')!;
  const mission = context.memory.naval!.ferries![boat.id]!;
  mission.phase = 'return'; mission.approach = { x: 2416, y: 6736 };
  const before = structuredClone(context.memory), ordinary = [{ type: 'unload' as const, unitIds: [boat.id], ...mission.from, avoidCombat: true }];
  expect(orderBootstrapAssaultLanding(f.snapshot, 'p0', context, boat, mission.to, ordinary)).toBe(ordinary);
  expect(context.memory).toEqual(before);
});

it('holds the first stopped hull until the second actual nearby hull can land its passengers', () => {
  const f = fixture(89625), context = bootstrapPolicyContext(f.snapshot, 'p0', 'v9_archer', { teams: f.snapshot.teams, memory: f.memories.p0 });
  const boat = f.snapshot.units.find((unit: any) => unit.id === 'unit-p0-carrier-3824')!;
  const mission = context.memory.naval!.ferries![boat.id]!;
  const companion = f.snapshot.units.find((unit: any) => unit.id === 'unit-p0-carrier-3510')!;
  const target = f.snapshot.buildings.find((building: any) => building.id === mission.targetId)!;
  expect(walkingDistance(f.snapshot.map, boat, companion, 'sea')).toBe(294.4);
  expect(assaultBeachExposure(f.snapshot, 'p0', context, boat, mission.to, target, true)?.guards).toEqual([]);
  expect(assaultBeachExposure(f.snapshot, 'p0', context, companion, mission.to, target, true)).toBeUndefined();
  expect(orderBootstrapAssaultLanding(f.snapshot, 'p0', context, boat, mission.to,
    [{ type: 'unload', unitIds: [boat.id], ...mission.to }])).toEqual([{ type: 'stop', unitIds: [boat.id] }]);
});

it('uses public immediate portrait unloads so the two stopped actual hulls deploy together before their helm turns', () => {
  const f = fixture(89895);
  expect(Object.values(f.provenance.replayProof).every(Boolean)).toBe(true);
  const context = bootstrapPolicyContext(f.snapshot, 'p0', 'v9_archer', { teams: f.snapshot.teams, memory: f.memories.p0 });
  const beforeMemory = structuredClone(context.memory);
  const games = [createGame('bareDuel'), createGame('bareDuel')];
  for (const game of games) restoreSnapshotIntoGame(game, f.snapshot, f.nextId);
  const [control, revised] = games;
  for (const entry of f.expectedOldCommands) {
    issuePlayerCommand(control!, entry.owner, entry.command);
    const boat = entry.command.type === 'unload' && f.snapshot.units.find((unit: any) => entry.command.unitIds.includes(unit.id));
    const commands = boat ? orderBootstrapAssaultLanding(f.snapshot, 'p0', context, boat,
      context.memory.naval!.ferries![boat.id]!.to, [entry.command]) : [entry.command];
    for (const command of commands) issuePlayerCommand(revised!, entry.owner, command);
  }
  expect(context.memory).toEqual(beforeMemory);
  for (const id of ['unit-p0-carrier-3510', 'unit-p0-carrier-3824'])
    expect(shipPassengers(revised!.units, revised!.units.find(unit => unit.id === id)!)).toHaveLength(0);
  stepGame(control!); stepGame(revised!);
  expect(JSON.parse(JSON.stringify(snapshotGame(control!)))).toEqual(f.expectedOldAfter.snapshot);
  expect(control!.nextId).toBe(f.expectedOldAfter.nextId);
  expect(shipPassengers(control!.units, control!.units.find(unit => unit.id === 'unit-p0-carrier-3510')!)).toHaveLength(14);
  // The ordinary helm starts moving the first ship again in this tick;
  // all revised passengers were already legally ashore before that turn.
  expect(revised!.units.filter(unit => unit.owner === 'p0' && !unit.deck &&
    f.snapshot.units.some((old: any) => old.id === unit.id && old.deck?.shipId?.match(/carrier-(3510|3824)$/)))).toHaveLength(29);
});
