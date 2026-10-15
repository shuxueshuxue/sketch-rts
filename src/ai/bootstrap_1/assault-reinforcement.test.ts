import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, walkableGoal, walkingDistance } from '../../shared/terrain';
import { shipPassengers } from '../../shared/ship-geometry';
import { boardUnit } from '../../shared/decks';
import { unitMover } from '../../shared/catalog';
import { planAiOwnerCommandEntries } from '../planner-context';
import { assaultExpedition } from '../policy/naval';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';

const emptyId = 'unit-p0-carrier-3824', loadedId = 'unit-p0-carrier-3510';
function checkpoint(loaded = false) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(loaded ? './fixtures/archer-loaded-assault-convoy.json.gz'
    : './fixtures/archer-stranded-assault-reinforcements.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, saved, memory: saved.memories.p0 };
}

it.each(BOOTSTRAP_VERSIONS)('%s sends the real empty assault ferry to a remaining army instead of its abandoned shore', version => {
  const { game, memory, saved } = checkpoint(), snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
  expect(snapshot.tick).toBe(72000);
  expect(snapshot.players.p0!.gold).toBe(0.78);
  expect(snapshotGame(game)).toEqual(saved.snapshot);
  expect(saved.memories.p1).toBeDefined();
  const oldShore = memory.naval.ferries[emptyId].from;
  const loaded = snapshot.units.find(unit => unit.id === loadedId)!;
  expect(shipPassengers(snapshot.units, loaded)).toHaveLength(14);
  const target = snapshot.buildings.find(building => building.id === memory.naval.ferries[emptyId].targetId)!;
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: structuredClone(memory), teams: game.teams });
  const expedition = assaultExpedition(snapshot, 'p0', options, target);
  expect(expedition.required).toBeCloseTo(19.010608934197393);
  expect(expedition.ready).toBe(true);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  const mission = memory.naval.ferries[emptyId];
  expect(mission.pickup).toBeDefined();
  expect(sameGround(snapshot.map, walkableGoal(snapshot.map, mission.pickup.x, mission.pickup.y), walkableGoal(snapshot.map, oldShore.x, oldShore.y))).toBe(false);
  const empty = snapshot.units.find(unit => unit.id === emptyId)!;
  expect(mission.progress).toBeDefined();
  expect(mission.progress.heading).toBe(empty.sailing!.heading);
  expect(walkingDistance(snapshot.map, empty, mission.pickup, 'sea')).toBeDefined();
  expect(entries.some(entry => entry.command.type === 'move' && entry.command.unitIds.includes(emptyId)
    && Math.hypot(entry.command.x - mission.pickup.x, entry.command.y - mission.pickup.y) < 1)).toBe(true);
  expect(entries.some(entry => entry.command.type === 'unload' && entry.command.unitIds.includes(loadedId))).toBe(false);
  expect(memory.naval.ferries[loadedId].phase).toBe('loading');
  expect(memory.naval.ferries[loadedId].from).toEqual({ x: 3760, y: 6480 });
  expect(mission.from).toEqual(oldShore);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it.each(BOOTSTRAP_VERSIONS)('%s assembles the actually loaded sufficient convoy before sailing to the enemy', version => {
  const { game, memory } = checkpoint(true), snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
  const first = snapshot.units.find(unit => unit.id === loadedId)!, second = snapshot.units.find(unit => unit.id === emptyId)!;
  expect(snapshot.tick).toBe(80400);
  expect(shipPassengers(snapshot.units, first)).toHaveLength(14);
  expect(shipPassengers(snapshot.units, second)).toHaveLength(15);
  expect(walkingDistance(snapshot.map, first, second, 'sea')!).toBeGreaterThan(6000);
  const target = snapshot.buildings.find(building => building.id === memory.naval.ferries[loadedId].targetId)!;
  expect(assaultExpedition(snapshot, 'p0', bootstrapPolicyContext(snapshot, 'p0', version,
    { memory: structuredClone(memory), teams: game.teams }), target).required).toBeCloseTo(19.010608934197393);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  const rally = memory.naval.ferries[emptyId].rally;
  expect(rally).toBeDefined();
  expect(memory.naval.ferries[loadedId].rally).toEqual(rally);
  expect(walkingDistance(snapshot.map, second, rally, 'sea')).toBeDefined();
  expect(entries.some(entry => entry.command.type === 'move' && entry.command.unitIds.includes(emptyId)
    && Math.hypot(entry.command.x - rally.x, entry.command.y - rally.y) < 1)).toBe(true);
  expect(entries.some(entry => entry.command.type === 'unload' && entry.command.unitIds.some(id => id === loadedId || id === emptyId))).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it.each(['boarding', 'returning', 'insufficient', 'stationary'] as const)
  ('does not assemble the saved convoy over its %s restriction', restriction => {
    const { game, memory } = checkpoint(true);
    if (restriction === 'boarding') {
      const soldier = game.units.find(unit => unit.id === 'unit-p0-footman-5328')!;
      soldier.order = { type: 'board', transportId: loadedId };
      memory.naval.ferries[loadedId].crewIds.push(soldier.id);
    } else if (restriction === 'returning') memory.naval.ferries[loadedId].phase = 'return';
    else if (restriction === 'insufficient') game.units.find(unit => unit.id === 'unit-p0-archer-1238')!.hp = 1;
    else for (const id of [loadedId, emptyId]) {
      const ship = game.units.find(unit => unit.id === id)!;
      memory.naval.ferries[id].progress = { tick: game.tick - 801, x: ship.x, y: ship.y,
        heading: ship.sailing!.heading, phase: 'loading', crew: shipPassengers(game.units, ship).map(unit => unit.id).join('|') };
    }
    const snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
    expect(memory.naval.ferries[emptyId]?.rally).toBeUndefined();
    expect(entries.some(entry => entry.command.type === 'unload' && entry.command.unitIds.includes(emptyId)
      && entry.command.x === 2192 && entry.command.y === 6096)).toBe(false);
    if (restriction === 'stationary') expect(memory.naval.ferries[loadedId].phase).toBe('return');
    expect(JSON.stringify(snapshot)).toBe(original);
  });

it.each(BOOTSTRAP_VERSIONS)('%s keeps the already loaded convoy waiting while the empty companion changes source', version => {
  const { game, memory } = checkpoint();
  for (let think = 0; think < 2; think++) {
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
    expect(memory.naval.ferries[loadedId].phase).toBe('loading');
    expect(shipPassengers(game.units, game.units.find(unit => unit.id === loadedId)!)).toHaveLength(14);
    for (const entry of entries) issuePlayerCommand(game, 'p0', entry.command);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
  }
});

it('keeps the requested rendezvous when a real reinforcement is already boarding', () => {
  const { game, memory } = checkpoint(), soldier = game.units.find(unit => unit.id === 'unit-p0-archer-2610')!;
  soldier.order = { type: 'board', transportId: emptyId };
  memory.naval.ferries[emptyId].crewIds = [soldier.id];
  const snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
  planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  expect(memory.naval.ferries[emptyId].pickup).toBeUndefined();
  expect(memory.naval.ferries[emptyId].crewIds).toContain(soldier.id);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it('keeps loading actual local soldiers before looking for another island', () => {
  const { game, memory } = checkpoint(), soldier = game.units.find(unit => unit.id === 'unit-p0-archer-2610')!;
  const ground = walkableGoal(game.map, memory.naval.ferries[emptyId].from.x, memory.naval.ferries[emptyId].from.y);
  soldier.deck = undefined; soldier.x = ground.x; soldier.y = ground.y; soldier.order = { type: 'idle' };
  const snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  expect(entries.some(entry => entry.command.type === 'board' && entry.command.transportId === emptyId
    && entry.command.unitIds.includes(soldier.id))).toBe(true);
  expect(memory.naval.ferries[emptyId].pickup).toBeUndefined();
  expect(JSON.stringify(snapshot)).toBe(original);
});

it('does not gather the defenders of an explicitly incoming landing even while the ship is distant', () => {
  const { game, memory } = checkpoint(), home = game.buildings.find(building => building.id === 'building-p0-townhall')!;
  const enemyTransport = game.units.find(unit => unit.owner === 'p1' && unit.kind === 'transport')!;
  const enemy = game.units.find(unit => unit.owner === 'p1' && !unit.deck && unitMover(unit.kind) === 'land' && unit.kind !== 'worker')!;
  expect(boardUnit(enemyTransport, enemy, game.units)).toBe(true);
  enemyTransport.order = { type: 'unload', x: home.x, y: home.y };
  expect(Math.hypot(enemyTransport.x - home.x, enemyTransport.y - home.y)).toBeGreaterThan(700);
  const snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
  planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  const pickup = memory.naval.ferries[emptyId].pickup;
  if (pickup) expect(sameGround(snapshot.map, walkableGoal(snapshot.map, pickup.x, pickup.y), home)).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it('does not refresh a genuinely unchanged hull and crew by changing source or planning again', () => {
  const { game, memory } = checkpoint(), boat = game.units.find(unit => unit.id === emptyId)!;
  // Counterfactual stationary pose: unlike the actual saved frame's bow turn,
  // neither translation nor rotation has changed since the last measurement.
  const before = memory.naval.ferries[emptyId].progress = { ...memory.naval.ferries[emptyId].progress,
    x: boat.x, y: boat.y, heading: boat.sailing!.heading };
  expect(before.tick).toBe(71925);
  const frame = snapshotGame(game);
  for (const tick of [72000, 72015, 72030]) {
    const snapshot = { ...frame, tick };
    planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
    expect(memory.naval.ferries[emptyId].progress).toEqual(before);
    expect(memory.naval.ferries[emptyId].sinceTick).toBe(72000);
    expect(memory.naval.ferries[emptyId].pickup).toEqual({ x: 8144, y: 4176 });
  }
});

it('cancels a genuinely stationary convoy even when its empty companion could change source', () => {
  const { game, memory } = checkpoint();
  for (const id of [loadedId, emptyId]) {
    const boat = game.units.find(unit => unit.id === id)!;
    memory.naval.ferries[id].progress = { tick: game.tick - 801, x: boat.x, y: boat.y,
      heading: boat.sailing!.heading, phase: 'loading', crew: shipPassengers(game.units, boat).map(unit => unit.id).join('|') };
  }
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  expect(memory.naval.ferries[loadedId].phase).toBe('return');
  expect(entries.some(entry => entry.command.type === 'unload' && entry.command.unitIds.includes(loadedId)
    && entry.command.x === 3760 && entry.command.y === 6480)).toBe(true);
});
