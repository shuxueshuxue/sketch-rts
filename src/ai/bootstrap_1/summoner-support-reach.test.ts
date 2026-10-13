import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planSummonerScreen } from './summoner-screen';
import { planBootstrapAbilities } from './weapon-targets';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  '$race support reaches real summoned targets while its melee screen survives (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const kind = race === 'grove' ? 'witch' : 'ashHexer', heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('support-cast-reach').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .unit('us', kind, x(1800), 1640, { id: 'support' });
    for (let i = 0; i < 6; i++) scene = scene.unit('us', heavy, x(2000), 1540 + i * 40, { id: `front-${i}`,
      order: { type: 'hold', x: x(2000), y: 1540 + i * 40 } });
    for (let i = 0; i < 6; i++) scene = scene.unit('foe', 'summoner', x(2350), 1540 + i * 40, { id: `caller-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issueCommandFrame(game, game.units.filter(unit => unit.id.startsWith('caller-')).map(unit => ({ playerId: 'foe', scriptId: 'setup',
      command: { type: 'cast' as const, unitId: unit.id, ability: 'summon' as const, x: x(2130), y: unit.y } })));
    issueCommandFrame(game, [{ playerId: 'foe', scriptId: 'withdraw-hosts', command: { type: 'move',
      unitIds: game.units.filter(unit => unit.id.startsWith('caller-')).map(unit => unit.id), x: x(3500), y: 3500, avoidCombat: true } }]);
    stepGame(game);
    expect(game.units.filter(unit => unit.owner === 'foe' && unit.kind === 'spirit')).toHaveLength(6);
    memory.v6 = { general: { mode: 'hold', target: { x: x(2000), y: 1640 } } };
    let dispelled = 0;
    game.observer = { hit(source, target, damage, hpBefore) {
      if (source.id === 'support' && target.kind === 'spirit' && damage >= 50 && damage >= hpBefore) dispelled++;
    } };
    for (let tick = 0; tick < 400; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory, teams: game.teams });
        issueCommandFrame(game, [...planBootstrapAbilities(snapshot, 'us', options), ...planSummonerScreen(snapshot, 'us', options)]
          .map(command => ({ playerId: 'us', scriptId: 'support', command })));
      }
      stepGame(game);
    }
    expect(dispelled).toBeGreaterThan(0);
    const support = game.units.filter(unit => unit.id === 'support');
    expect(support).toHaveLength(1);
    expect(support[0]!.hp).toBe(support[0]!.maxHp);
    expect(game.units.filter(unit => unit.id.startsWith('front-'))).toHaveLength(6);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
