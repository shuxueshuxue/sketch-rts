import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { trainingBuildingFor, UNIT_DEFS } from '../../shared/catalog';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    (['summons', 'charge', ...(version === 'v9_summoner' ? ['artillery'] as const : [])] as const)
      .map(threat => ({ version, race, mirror, threat })))));

it.each(cases)('$version pays for its existing $threat counter below ten troops ($race, mirror=$mirror)', ({ version, race, mirror, threat }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const counter = threat === 'summons' ? race === 'grove' ? 'witch' : 'ashHexer' : race === 'grove' ? 'lancer' : 'ashWarden';
  let scene = sketchScene('counter-small-army').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).worker('us', x(600), 600)
    .townHall('foe', x(3500), 3500)
    .building('us', trainingBuildingFor(race, counter)!, x(850), 600);
  for (let i = 0; i < 6; i++) scene = scene.building('us', 'farm', x(400 + i * 100), 1100);
  for (let i = 0; i < 7; i++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(700 + i * 35), 850, { id: `front-${i}` });
  if (threat === 'summons') {
    for (let i = 0; i < 4; i++) scene = scene.unit('foe', 'summoner', x(3300 + i * 80), 3200, { id: `caller-${i}` });
  } else if (threat === 'charge') {
    for (let i = 0; i < 4; i++) scene = scene.unit('foe', 'knight', x(3200 + i * 70), 3300);
  } else scene = scene.unit('foe', 'catapult', x(3200), 3300);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  if (threat === 'summons') {
    for (let i = 0; i < 4; i++) issuePlayerCommand(game, 'foe', {
      type: 'cast', unitId: `caller-${i}`, ability: 'summon', x: x(3300 + i * 80), y: 3200,
    });
    expect(game.units.filter(unit => unit.owner === 'foe' && unit.expiresTick !== undefined)).toHaveLength(4);
  }
  let recruitedAtArmySize = -1;
  for (let tick = 0; tick < UNIT_DEFS[counter].trainTime + 300
    && !game.units.some(unit => unit.owner === 'us' && unit.kind === counter); tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams });
      if (recruitedAtArmySize < 0 && entries.some(entry => entry.command.type === 'train' && entry.command.unitKind === counter)) {
        recruitedAtArmySize = game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker' && unit.expiresTick === undefined).length;
      }
      issueCommandFrame(game, entries);
    }
    stepGame(game);
  }
  const diagnostic = JSON.stringify({ recruitedAtArmySize, gold: game.players.us!.gold, spent: game.match.stats.goldSpent.us,
    troops: game.units.filter(unit => unit.owner === 'us').map(unit => unit.kind) });
  expect(recruitedAtArmySize, diagnostic).toBeGreaterThanOrEqual(0);
  expect(recruitedAtArmySize, diagnostic).toBeLessThan(10);
  expect(game.units.some(unit => unit.owner === 'us' && unit.kind === counter), diagnostic).toBe(true);
  expect(game.match.stats.goldSpent.us, diagnostic).toBeGreaterThanOrEqual(UNIT_DEFS[counter].cost);
  expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(500);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
