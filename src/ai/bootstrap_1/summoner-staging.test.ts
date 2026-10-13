import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { v6AssaultStagePoint } from '../policy/v6/general';
import { bootstrapPolicyContext } from './policy';
import { planSummonerScreen } from './summoner-screen';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  '$race summoners meet the actual assault group at its staging point (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const target = { x: x(3500), y: 800 }, center = { x: x(2800), y: 1300 };
    const stage = v6AssaultStagePoint(target, center);
    let scene = sketchScene('host-assault-gather').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(600), 3400).townHall('foe', target.x, target.y, { id: 'target' })
      .worker('foe', target.x, target.y + 120);
    for (let i = 0; i < 4; i++) scene = scene.unit('us', 'summoner', x(600 + i * 40), 2900, { id: `host-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.unit('us', race === 'grove' ? 'witch' : 'ashHexer', x(500 + i * 40), 2900, { id: `support-${i}` });
    scene = scene.unit('us', 'priest', x(540), 2960, { id: 'doctor' });
    for (let i = 0; i < 3; i++) scene = scene.unit('us', 'footman', stage.x + i * 35, stage.y, { id: `front-${i}`,
      order: { type: 'hold', x: stage.x + i * 35, y: stage.y } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    memory.v6 = { general: { mode: 'attack', stage: 'gather', target, targetHallId: 'target',
      group: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id) } };
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory, teams: game.teams });
        issueCommandFrame(game, planSummonerScreen(snapshot, 'us', options).map(command => ({ playerId: 'us', scriptId: 'v6Backline', command })));
      }
      stepGame(game);
    }
    const host = game.units.filter(unit => unit.id.startsWith('host-'));
    expect(host).toHaveLength(4);
    for (const caster of host) {
      expect(Math.hypot(caster.x - stage.x, caster.y - stage.y)).toBeLessThan(300);
      expect(caster.hp).toBe(caster.maxHp);
    }
    const supports = game.units.filter(unit => unit.id.startsWith('support-') || unit.id === 'doctor');
    expect(supports).toHaveLength(4);
    for (const support of supports) {
      expect(Math.hypot(support.x - x(600), support.y - 3400)).toBeLessThan(250);
      expect(support.hp).toBe(support.maxHp);
    }
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  '$race gathering does not delay demolition after every enemy unit is gone (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('gather-demolition-priority').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(600), 3400).townHall('foe', x(3500), 800, { id: 'target' });
    for (let i = 0; i < 4; i++) scene = scene.unit('us', 'summoner', x(2600 + i * 40), 1000, { id: `host-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.unit('us', 'footman', x(2800 + i * 35), 1300, { id: `front-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    memory.v6 = { general: { mode: 'attack', stage: 'gather', target: { x: x(3500), y: 800 }, targetHallId: 'target',
      group: game.units.map(unit => unit.id) } };
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory, teams: game.teams });
    const commands = planSummonerScreen(snapshot, 'us', options);
    expect(commands).toContainEqual({ type: 'attack', unitIds: ['host-0','host-1','host-2','host-3'], targetId: 'target' });
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6Backline', command })));
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(game.units.filter(unit => unit.kind === 'summoner').every(unit => Math.abs(unit.x - x(3500)) < 900)).toBe(true);
  }, 30000);
