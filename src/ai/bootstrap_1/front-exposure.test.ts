import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';
import { marchStrength } from '../policy/v6/strength';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].map(towers => ({ version, race, mirror, towers })))));

it.each(cases)('$version evaluates actual $race exposure despite a remote member moving the centroid (mirror=$mirror, towers=$towers)',
  ({ version, race, mirror, towers }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('remote-member-does-not-hide-towers').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).player('other', { team: 'b' })
      .townHall('us', x(500), 1000).goldMine('main', x(788), 1000, 10000)
      .townHall('us', x(1500), 1000).goldMine('natural', x(1788), 1000, 10000)
      .townHall('foe', x(3500), 3500).townHall('foe', x(3100), 1000, { id: 'target' })
      .townHall('other', x(3300), 3500)
      .worker('foe', x(3500), 3400).worker('other', x(3300), 3400)
      .unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(500), 3500, { id: 'remote' });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager',
      x(2150 - index * 8), 1000, { id: `front-${index}` });
    for (let index = 0; towers && index < 8; index++) {
      const angle = (-70 + index * 20) * Math.PI / 180;
      scene = scene.tower(index < 4 ? 'foe' : 'other',
        x(2150 + Math.cos(angle) * 520), 1000 + Math.sin(angle) * 520, { id: `tower-${index}` });
    }
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const group = game.units.filter(unit => unit.owner === 'us');
    memory.v6 = { phase: 1, general: { mode: 'attack', targetHallId: 'target', target: { x: x(3100), y: 1000 },
      group: group.map(unit => unit.id), groupStart: marchStrength(group) } };
    const snapshot = snapshotGame(game), commands = planBootstrapGeneral(snapshot, 'us',
      bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
    if (towers) {
      expect(memory.v6.general!.mode).not.toBe('attack');
      expect(memory.v6.retreatedAt).toBe(0);
    } else {
      expect(memory.v6.general!.mode).toBe('attack');
      expect(memory.v6.retreatedAt).toBeUndefined();
    }
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
    for (let tick = 0; tick < 180; tick++) stepGame(game);
    const diagnostic = JSON.stringify({ general: memory.v6.general, commands,
      units: group.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, order: unit.order })) });
    expect(game.units.filter(unit => unit.id.startsWith('front-')), diagnostic).toHaveLength(4);
    expect(game.buildings.find(building => building.id === 'target')!.hp).toBe(900);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
