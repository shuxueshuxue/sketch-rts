import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BUILDING_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy } from './economy';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function field(race: 'grove' | 'ember', mirror: boolean, obstacle: 'none' | 'tower' | 'ally' | 'road' | 'blockedRoad' = 'none') {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('free-cleared-mine-capital').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).playerState('us', { gold: BUILDING_DEFS.townHall.cost })
    .player('foe', { team: 'b' }).player('ally', { team: 'a' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 500)
    .townHall('ally', x(3500), 3500)
    .goldMine('spent', x(788), 500, 0).goldMine('free', x(2300), 1800, 10000)
    .farms('us', 8, x(500), 3000)
    .worker('us', x((obstacle === 'road' || obstacle === 'blockedRoad') ? 1000 : 1800), (obstacle === 'road' || obstacle === 'blockedRoad') ? 600 : 1800, { id: 'near-worker' });
  for (let index = 0; index < 6; index++) scene = scene.worker('us', x(600 + index * 30), 600, { id: `far-worker-${index}` });
  if (obstacle === 'tower') scene = scene.tower('foe', x(2300), 1810);
  if (obstacle === 'ally') scene = scene.townHall('ally', x(2012), 1800);
  if (obstacle === 'road' || obstacle === 'blockedRoad') scene = scene.unit('neutral', 'ogreLord', x(1450), 1150, { id: 'road-guard' });
  if (obstacle === 'road') scene = scene.worker('us', x(300), 1900, { id: 'safe-worker' });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  return game;
}

function plans(game: ReturnType<typeof field>, version: typeof cases[number]['version'], race: 'grove' | 'ember') {
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version,
    { memory: createAiPolicyMemory(), teams: game.teams });
  options.doctrines = [{ id: 'capital-only', race, weight: 1, raids: [], standIn: race === 'grove' ? 'footman' : 'emberRavager',
    phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }];
  options.armyWants = [];
  return runAiCommandEntriesFromScripts(snapshot, 'us', [bootstrapEconomy], options);
}

it.each(cases)('$version spends its remaining $race capital on the clear mine directly (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const game = field(race, mirror), entries = plans(game, version, race);
    const build = entries.find(entry => entry.command.type === 'build' && entry.command.buildingKind === 'townHall');
    expect(build).toBeDefined();
    expect(entries.some(entry => entry.command.type === 'build' && entry.command.buildingKind === 'defenseTower')).toBe(false);
    issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    expect(game.units.some(unit => unit.order.type === 'build' && unit.order.buildingKind === 'townHall')).toBe(true);
    stepGame(game);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.winner).toBeNull();
  });

it.each(cases.flatMap(item => (['tower', 'ally'] as const).filter(obstacle =>
  obstacle !== 'tower' || item.version !== 'v9_summoner').map(obstacle => ({ ...item, obstacle }))))(
  '$version leaves the $obstacle-held $race mine unclaimed (mirror=$mirror)', ({ version, race, mirror, obstacle }) => {
    const game = field(race, mirror, obstacle), entries = plans(game, version, race);
    expect(entries.some(entry => entry.command.type === 'build' && entry.command.buildingKind === 'townHall')).toBe(false);
    issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

it.each(cases.filter(item => item.version !== 'v9_summoner'))(
  '$version uses the safe $race builder road instead of the closer exposed worker (mirror=$mirror)', ({ version, race, mirror }) => {
    const game = field(race, mirror, 'road'), entries = plans(game, version, race);
    const command = entries.flatMap(entry => entry.command.type === 'build' && entry.command.buildingKind === 'townHall'
      ? [entry.command] : [])[0]!;
    expect(command).toBeDefined();
    expect(command.unitId).not.toBe('near-worker');
    issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    expect(game.units.find(unit => unit.id === command.unitId)!.order.type).toBe('build');
    for (let tick = 0; tick < 1800; tick++) stepGame(game);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall' && building.x === command.x && building.y === command.y && building.complete)).toBe(true);
    expect(game.units.find(unit => unit.id === command.unitId)!.hp).toBe(70);
    expect(game.match.stats.unitsLost.us).toBe(0);
  });

it.each(cases.filter(item => item.version !== 'v9_summoner'))(
  '$version holds its $race expansion when every builder road is exposed (mirror=$mirror)', ({ version, race, mirror }) => {
    const game = field(race, mirror, 'blockedRoad');
    game.resources.find(mine => mine.id === 'spent')!.amount = 10000;
    const entries = plans(game, version, race);
    expect(entries.some(entry => entry.command.type === 'build')).toBe(false);
    issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
