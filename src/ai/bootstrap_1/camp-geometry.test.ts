import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { chooseV7Camp, neutralCamps } from '../policy/v7/creep';
import { chooseBootstrapCamp } from './camp-geometry';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version avoids the $race road ambush hidden behind a safe straight approach (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('creep-road-ambush').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).goldMine('home', x(788), 500, 4000)
    .townHall('us', x(500), 1000).goldMine('second', x(788), 1000, 4000)
    .townHall('peer', x(3500), 3500)
    .unit('neutral', 'wildling', x(1900), 500, { id: 'target' });
  for (let index = 0; index < 8; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'ashWarden', x(900 + index * 15), 500);
  for (let index = 0; index < 6; index++) scene = scene.unit('neutral', 'ogreMage', x(1100 + index * 20), 1430, { id: `ambush-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  const wall = Math.floor(x(1280) / 32);
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === wall && Math.floor(index / 128) < 40 ? 'T' : '.').join('') };
  memory.v6 = { phase: 3 };
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
  const army = snapshot.units.filter(unit => unit.owner === 'us'), camps = neutralCamps(snapshot);
  const target = camps.find(camp => camp.creeps.some(unit => unit.id === 'target'))!;
  expect(chooseV7Camp(snapshot, army, camps, [target], options)).toBeDefined();
  expect(chooseBootstrapCamp(snapshot, army, camps, [target], options)).toBeUndefined();
  let enteredAmbush = false;
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory },
        { teams: game.teams, policyMode: 'combat' });
      sdk.issue(entries, {}, { checksum: false });
    }
    stepGame(game);
    enteredAmbush ||= game.units.some(unit => unit.owner === 'us'
      && Math.hypot(unit.x - x(1150), unit.y - 1430) <= 260);
  }
  expect(enteredAmbush).toBe(false);
  expect(game.units.filter(unit => unit.owner === 'us')).toHaveLength(8);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.players.us!.gold).toBe(500);
});

it.each([false, true])('chooses the farther camp with the shorter actual staging road (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('creep-road-priority').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500)
    .unit('neutral', 'wildling', x(1900), 500, { id: 'near' })
    .unit('neutral', 'wildling', x(950), 1600, { id: 'far' });
  for (let index = 0; index < 8; index++) scene = scene.unit('us', 'footman', x(900 + index * 15), 500);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  const wall = Math.floor(x(1280) / 32);
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === wall && Math.floor(index / 128) < 40 ? 'T' : '.').join('') };
  const snapshot = snapshotGame(game), camps = neutralCamps(snapshot), front = snapshot.units.filter(unit => unit.owner === 'us');
  const options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
  const old = chooseV7Camp(snapshot, front, camps, camps, options)!, next = chooseBootstrapCamp(snapshot, front, camps, camps, options)!;
  expect(old.camp.creeps[0]!.id).toBe('near');
  expect(next.camp.creeps[0]!.id).toBe('far');
  expect(walkingDistance(game.map, front[0]!, next.staging, 'land')).toBeLessThan(walkingDistance(game.map, front[0]!, old.staging, 'land')!);
});
