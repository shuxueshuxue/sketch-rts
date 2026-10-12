import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases.flatMap(item => [false, true].map(blocked => ({ ...item, blocked }))))(
  '$version admits its $race reinforcement only along a clear camp road (blocked=$blocked, mirror=$mirror)',
  ({ version, race, mirror, blocked }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('ordinary-reinforcement-camp-road').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .unit('us', race === 'grove' ? 'ballista' : 'catapult', x(600), 1000, { id: 'recruit' })
      .unit('neutral', 'ogreLord', x(2900), 1000, { id: 'target' });
    for (let index = 0; index < 8; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager',
      x(2300 + index * 15), 1000, { id: `front-${index}` });
    if (blocked) scene = scene.unit('neutral', 'graniteGolem', x(1400), 1000, { id: 'unplanned' });
    const game = scene.build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const memory = createAiPolicyMemory();
    memory.v6 = { phase: 3, creep: { center: { x: x(2900), y: 1000 }, reach: 0,
      staging: { x: x(2300), y: 1000 }, stage: 'gather', since: 0,
      group: game.units.filter(unit => unit.id.startsWith('front-')).map(unit => unit.id) } };
    const commands = planBootstrapGeneral(snapshotGame(game), 'us',
      bootstrapPolicyContext(snapshotGame(game), 'us', version, { memory, teams: game.teams }));
    expect(commands.some(command => command.type === 'move' && command.unitIds.includes('recruit'))).toBe(!blocked);
    expect(memory.v6.creep!.group.includes('recruit')).toBe(false);
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
    stepGame(game);
    expect(game.units.find(unit => unit.id === 'recruit')!.order.type).toBe(blocked ? 'idle' : 'move');
    expect(game.match.stats.unitsLost.us).toBe(0);
  });
