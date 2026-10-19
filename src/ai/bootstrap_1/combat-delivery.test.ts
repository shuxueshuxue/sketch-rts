import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { boardUnit } from '../../shared/decks';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, sameGround } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapNaval } from './expedition-recovery';
import { bootstrapPolicyContext } from './policy';
import { issueCommandFrame } from '../../sdk/commands/frame';
import departureScenes from './fixtures/first-combat-departures.json';
import { createGame, restoreSnapshotIntoGame } from '../../shared/sim';
import { createUnit } from '../../shared/map';
import type { GameSnapshot, Unit } from '../../shared/types';
import { planBootstrapEconomy } from './economy';
import { UNIT_DEFS } from '../../shared/catalog';

function crossing() {
  const game = sketchScene('first-combat-delivery').map('bareDuel').replaceDefaults()
    .player('us', { race: 'ember', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 640, 500).townHall('foe', 3400, 500)
    .building('foe', 'farm', 3300, 1800)
    .unit('us', 'transport', 2200, 1800, { id: 'ferry' })
    .worker('us', 1120, 1800, { id: 'engineer' }).build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = i % 128;
    return col < 40 || col >= 88 ? '.' : col === 40 || col === 87 ? ',' : '~';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  const boat = game.units.find(u => u.id === 'ferry')!;
  boat.x = 2200; boat.y = 1800; boat.sailing = { heading: Math.PI, speed: 0, load: 0, balance: 0 };
  const memory = createAiPolicyMemory(), from = { x: 1296, y: 1800 }, to = { x: 2784, y: 1800 };
  const target = game.buildings.find(b => b.kind === 'farm')!;
  memory.naval = { ferries: { ferry: { purpose: 'assault', targetId: target.id, from, to,
    phase: 'loading', crewIds: [], sinceTick: 0 } } };
  return { game, boat, memory, from, to };
}
const versions = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
it.each(versions)('%s does not send a lone worker to attack an unguarded enemy island', version => {
  const { game, boat, memory, to } = crossing();
  boat.x = 1424; boat.sailing!.heading = 0;
  const engineer = game.units.find(u => u.id === 'engineer')!;
  expect(boardUnit(boat, engineer, game.units)).toBe(true);
  const snapshot = snapshotGame(game);
  const commands = planBootstrapNaval(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
  expect(commands.some(c => c.type === 'unload' && Math.hypot(c.x - to.x, c.y - to.y) < 80)).toBe(false);
  expect(memory.naval!.ferries!.ferry!.phase).toBe('loading');
  expect(memory.naval!.ferryDecisions!.ferry!.reason).toBe('no-combat-crew');
});

function restoreDeparture(saved: typeof departureScenes.cases[number]) {
  const game = createGame('bareDuel', { players: Object.keys(saved.players), teams: saved.teams, aiPlayers: [] });
  const unit = (entry: unknown): Unit => {
    const row = entry as Unit;
    return { ...createUnit(row.id, row.owner, row.kind, row.x, row.y), ...structuredClone(row) };
  };
  restoreSnapshotIntoGame(game, { ...snapshotGame(game), tick: saved.tick, map: structuredClone(saved.map),
    teams: saved.teams, players: saved.players, units: saved.units.map(unit), buildings: structuredClone(saved.buildings),
    resources: saved.resources, obstacles: saved.obstacles, mercenaryCamps: saved.mercenaryCamps,
    items: [], projectiles: [], effects: [], corpses: [] } as unknown as GameSnapshot, 500000);
  game.scriptedVictory = true;
  return { game, unit };
}
const actualSeats = departureScenes.cases.flatMap(saved => versions.map(version => ({ saved, version, name: saved.name, owner: saved.owner })));
it.each(actualSeats)('$version funds the actual first combat passenger before optional purchases: $name / $owner', ({ saved, version }) => {
  const { game } = restoreDeparture(saved), memory = createAiPolicyMemory();
  const kind = saved.reinforcement.kind as Unit['kind'];
  game.players[saved.owner]!.gold = UNIT_DEFS[kind].cost;
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, saved.owner, version, { memory, teams: game.teams });
  planBootstrapNaval(snapshot, saved.owner, options);
  const commands = planBootstrapEconomy(snapshot, saved.owner, options);
  expect(commands.some(command => command.type === 'train' && command.unitKind === kind), JSON.stringify(commands)).toBe(true);
  issueCommandFrame(game, commands.map(command => ({ playerId: saved.owner, scriptId: 'v6Economy', command })));
  expect(game.players[saved.owner]!.gold).toBe(0);
});
it.each(actualSeats)('$version lands combat troops from the actual first boat: $name / $owner', ({ saved, version }) => {
  const { game, unit } = restoreDeparture(saved);
  const memory = createAiPolicyMemory();
  let spawned = false;
  for (let tick = 0; tick < 6000 && memory.naval?.firstCombatDelivery?.deliveredTick === undefined; tick++) {
    if (!spawned && game.tick >= saved.reinforcementSecond * 20) {
      game.units.push(unit(saved.reinforcement)); spawned = true;
    }
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, saved.owner, version, { memory, teams: game.teams });
      const commands = planBootstrapNaval(snapshot, saved.owner, options);
      try { issueCommandFrame(game, commands.map(command => ({ playerId: saved.owner, scriptId: 'naval', command }))); }
      catch (error) { throw new Error(JSON.stringify({ tick: game.tick, commands, error: String(error) })); }
    }
    stepGame(game);
  }
  const record = memory.naval?.firstCombatDelivery;
  const diagnostic = JSON.stringify({ record, decisions: memory.naval?.ferryDecisions,
    ferries: memory.naval?.ferries, units: game.units.filter(u => u.owner === saved.owner && (u.kind === 'transport' || u.id === saved.reinforcement.id))
      .map(u => ({ id: u.id, hp: u.hp, x: u.x, y: u.y, deck: u.deck, order: u.order, speed: u.sailing?.speed })) });
  expect(record?.deliveredTick, diagnostic).toBeDefined();
  expect(record!.deliveredTick!, diagnostic).toBeLessThanOrEqual(record!.deadlineTick);
  expect(record!.deliveredUnitId, diagnostic).toBe(saved.reinforcement.id);
}, 20000);
it.each(versions)('%s recruits combat passengers while the empty ferry approaches its loading shore', version => {
  const { game, boat, memory, from } = crossing();
  const soldier = game.spawnUnit('us', 'emberRavager', 1050, 1800);
  const snapshot = snapshotGame(game);
  const commands = planBootstrapNaval(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
  expect(commands.some(c => c.type === 'board' && c.transportId === boat.id && c.unitIds.includes(soldier.id))).toBe(true);
  expect(commands.some(c => c.type === 'move' && c.unitIds.includes(boat.id) && Math.hypot(c.x - from.x, c.y - from.y) < 80)).toBe(true);
});
it.each(versions)('%s unloads the first arriving combat passenger on the other island within 60 seconds', version => {
  const { game, boat, memory } = crossing();
  boat.x = 1424; boat.sailing!.heading = 0;
  const engineer = game.units.find(u => u.id === 'engineer')!;
  expect(boardUnit(boat, engineer, game.units)).toBe(true);
  let soldier: ReturnType<typeof game.spawnUnit> | undefined, boarded = false, delivered = false;
  for (let tick = 0; tick < 1200 && !delivered; tick++) {
    if (tick === 240) soldier = game.spawnUnit('us', 'emberRavager', 1100, 1800);
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      issueCommandFrame(game, planBootstrapNaval(snapshot, 'us', options).map(command => ({ playerId: 'us', scriptId: 'naval', command })));
    }
    stepGame(game);
    boarded ||= soldier?.deck?.shipId === boat.id;
    delivered = !!soldier && boarded && !soldier.deck && sameGround(game.map, soldier, { x: 3300, y: 1800 });
  }
  expect(delivered, JSON.stringify({ boat, soldier, naval: memory.naval })).toBe(true);
  expect(soldier!.hp).toBe(soldier!.maxHp);
});
