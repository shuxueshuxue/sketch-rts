import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { bootstrapGame, bootstrapMatches } from './benchmark';
import { restoreSnapshotIntoGame, snapshotGame, issuePlayerCommand } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { groundSteeringRoute } from '../../shared/route-selection';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { mountedField, mountedFieldRetreatRoad } from './mounted-field';
import { chargeMinimum, mountedMicro } from './mounted-micro';
import { armedFoes } from './safe-land-route';
import { threatLandRouter } from './threat-roads';

const riderId = 'unit-p0-horseArcher-4294';
function actual(tick: 15255 | 15285) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/archer-field-screen-retreat-${tick}.json.gz`, import.meta.url))).toString());
  const match = bootstrapMatches(saved.setup.seed, [saved.setup.map], Number.MAX_SAFE_INTEGER, saved.setup.unseen)
    .find(match => match.subject === 'v9_archer' && match.side === 1 && match.agents.p0!.race === 'grove'
      && Object.values(match.agents).slice(1).map(agent => agent.version).join('+') === 'v8+v8')!;
  expect(match.agents).toEqual(saved.setup.agents);
  const game = bootstrapGame(match);
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  expect(snapshotGame(game)).toEqual(saved.snapshot);
  const snapshot = snapshotGame(game);
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const rider = snapshot.units.find(unit => unit.id === riderId)!;
  const context = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory: structuredClone(saved.memories.p0), teams: game.teams });
  const foes = armedFoes(snapshot, 'p0', context);
  return { saved, game, snapshot, rider, context, foes };
}

describe('field cavalry retreat to actual support by an admitted road', () => {
  it('selects the shortest admitted actual support road at actual15285 with unchanged world and repeat-query memory idempotence', () => {
    const { snapshot, rider, context, foes } = actual(15285);
    const before = JSON.stringify(snapshot);
    const road = mountedFieldRetreatRoad(snapshot, 'p0', rider, foes, context)!;
    expect(road).toBeDefined();
    const guard = snapshot.units.find(unit => unit.id === 'unit-p0-footman-1190')!;
    expect(road.points.at(-1)).toEqual({ x: guard.x, y: guard.y });
    expect(road.points[1]!.y).toBeGreaterThan(rider.y);
    const memoryAfterFirst = structuredClone(context.memory);
    expect(mountedFieldRetreatRoad(snapshot, 'p0', rider, foes, context)).toEqual(road);
    expect(context.memory).toEqual(memoryAfterFirst);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('keeps field ownership and emits the admitted waypoint queue only after the original micro chose escape', () => {
    const { saved, game, snapshot, rider, foes } = actual(15285);
    const target = snapshot.units.find(unit => unit.id === 'unit-p1-cinderRunner-7819')!;
    expect(mountedMicro(snapshot, rider, target, foes, { kind: 'field' }).type).toBe('move');
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', source: 'external-agent' },
      { teams: game.teams, memoryProvider: createAiMemoryProvider(structuredClone(saved.memories)) });
    const orders = entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(riderId));
    expect(orders.length).toBeGreaterThan(1);
    expect(orders.every(entry => entry.scriptId === 'mountedField' && entry.command.type === 'move' && entry.command.avoidCombat)).toBe(true);
    expect(orders[0]!.command).toMatchObject({ type: 'move', x: 2238.8626914440106, y: 1260.0104104891725, queued: false });
    expect(orders.slice(1).every(entry => 'queued' in entry.command && entry.command.queued)).toBe(true);
  });

  it('keeps the real ready shot and lets it clear a previously queued retreat', () => {
    const { game, rider } = actual(15255);
    issuePlayerCommand(game, 'p0', { type: 'move', unitIds: [riderId], x: rider.x + 80, y: rider.y });
    issuePlayerCommand(game, 'p0', { type: 'move', unitIds: [riderId], x: rider.x + 160, y: rider.y, queued: true });
    const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory: createAiPolicyMemory(), teams: game.teams });
    const commands = mountedField.run(snapshot, 'p0', context).filter(command => 'unitIds' in command && command.unitIds.includes(riderId));
    expect(commands).toHaveLength(1);
    expect(commands[0]!.type).toBe('attack');
    issuePlayerCommand(game, 'p0', commands[0]!);
    const actualRider = game.units.find(unit => unit.id === riderId)!;
    expect(actualRider.order.type).toBe('attack');
    expect(actualRider.orderQueue).toEqual([]);
  });

  it('does not manufacture support or a retreat when there are no valid goals', () => {
    const { snapshot, rider, context, foes } = actual(15285);
    snapshot.units = snapshot.units.filter(unit => unit.owner !== 'p0' || unit.id === riderId);
    snapshot.buildings = snapshot.buildings.filter(building => building.owner !== 'p0');
    delete context.memory.v6!.general;
    setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
    expect(mountedFieldRetreatRoad(snapshot, 'p0', rider, foes, context)).toBeUndefined();
    const target = snapshot.units.find(unit => unit.id === 'unit-p1-cinderRunner-7819')!;
    expect(mountedField.run(snapshot, 'p0', context).filter(command => 'unitIds' in command && command.unitIds.includes(riderId))).toEqual([mountedMicro(snapshot, rider, target, foes, { kind: 'field' })]);
  });

  it('does not replace the original micro when enemies are not actually pursuing this rider', () => {
    const { snapshot, rider, context, foes } = actual(15285);
    for (const foe of foes) if ('order' in foe) foe.order = { type: 'hold', x: foe.x, y: foe.y };
    const target = snapshot.units.find(unit => unit.id === 'unit-p1-cinderRunner-7819')!;
    expect(mountedField.run(snapshot, 'p0', context).filter(command => 'unitIds' in command && command.unitIds.includes(riderId))).toEqual([mountedMicro(snapshot, rider, target, foes, { kind: 'field' })]);
  });

  it('keeps existing mounted task and retreat claims out of field allocation', () => {
    const { snapshot, rider, context } = actual(15285);
    context.memory.mounted = [{ unitIds: [riderId], objective: { kind: 'camp', ids: ['creep-gen-5-1'] } }];
    expect(mountedField.run(snapshot, 'p0', context).some(command => 'unitIds' in command && command.unitIds.includes(rider.id))).toBe(false);
    context.memory.mounted = [];
    context.memory.unitClaims[riderId] = { kind: 'retreat', targetId: 'unit-p1-cinderRunner-7819', x: rider.x, y: rider.y, sinceTick: snapshot.tick, expiresTick: snapshot.tick + 15 };
    expect(mountedField.run(snapshot, 'p0', context).some(command => 'unitIds' in command && command.unitIds.includes(rider.id))).toBe(false);
  });

  it('does not forecast ordinary walking while current control or a shove changes it', () => {
    const { snapshot, rider, context, foes } = actual(15285);
    rider.effects = [{ type: 'slow', remaining: 30 }];
    expect(mountedFieldRetreatRoad(snapshot, 'p0', rider, foes, context)).toBeUndefined();
    rider.effects = [];
    rider.pushX = 80; rider.pushY = 0;
    expect(mountedFieldRetreatRoad(snapshot, 'p0', rider, foes, context)).toBeUndefined();
  });

  it('does not treat an empty home or unoccupied guard post as a fighting screen', () => {
    const { snapshot, rider, context, foes } = actual(15285);
    snapshot.units = snapshot.units.filter(unit => unit.owner !== 'p0' || unit.id === riderId);
    context.memory.v6!.general = { mode: 'guard', target: { x: 2230, y: 2553 }, holdingSince: snapshot.tick };
    expect(snapshot.buildings.some(building => building.owner === 'p0' && building.complete && building.kind === 'townHall')).toBe(true);
    expect(mountedFieldRetreatRoad(snapshot, 'p0', rider, foes, context)).toBeUndefined();
  });

  it('retains the original escape inside a currently available charge minimum', () => {
    const game = sketchScene('field-retreat-charge-inner-window').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 3000, 1000).townHall('foe', 3500, 3500)
      .unit('us', 'horseArcher', 1000, 1000, { id: 'rider' })
      .unit('us', 'footman', 2000, 1000, { id: 'front' })
      .unit('foe', 'knight', 830, 1000, { id: 'knight' })
      .unit('foe', 'archer', 650, 1000, { id: 'archer' }).build().createGame();
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['knight', 'archer'], targetId: 'rider' });
    const snapshot = snapshotGame(game), rider = snapshot.units.find(unit => unit.id === 'rider')!;
    setBuildingBodies(snapshot.map, snapshot.buildings);
    const context = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory: createAiPolicyMemory(), teams: game.teams });
    const foes = armedFoes(snapshot, 'us', context), knight = snapshot.units.find(unit => unit.id === 'knight')!;
    expect(chargeMinimum(knight, rider, 15 + rider.cooldown)).toEqual([180]);
    expect(mountedFieldRetreatRoad(snapshot, 'us', rider, foes, context)).toBeUndefined();
  });

  it('rejects a whole admitted road when its first think remains inside the tower disk', () => {
    const game = sketchScene('field-retreat-first-think-under-tower').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 1000).townHall('foe', 3500, 3500)
      .building('foe', 'defenseTower', 2000, 1000, { id: 'tower' })
      .unit('us', 'horseArcher', 1700, 1000, { id: 'rider' })
      .unit('us', 'footman', 600, 1200, { id: 'front' }).build().createGame();
    const snapshot = snapshotGame(game), rider = snapshot.units.find(unit => unit.id === 'rider')!;
    setBuildingBodies(snapshot.map, snapshot.buildings);
    const context = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory: createAiPolicyMemory(), teams: game.teams });
    const foes = armedFoes(snapshot, 'us', context), front = snapshot.units.find(unit => unit.id === 'front')!;
    const end = groundSteeringRoute(snapshot.map, rider, front).at(-1)!;
    expect(threatLandRouter(snapshot, rider, foes)(end)).toBeDefined();
    expect(mountedFieldRetreatRoad(snapshot, 'us', rider, foes, context)).toBeUndefined();
  });
});
