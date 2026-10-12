import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version keeps its unsupported $race caster alive against slow melee pursuers (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('unsupported-caster-melee-pursuit').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .unit('us', 'priest', x(1700), 1700, { id: 'caster' })
      .unit('neutral', 'graniteGolem', x(1750), 1910, { id: 'large' })
      .unit('neutral', 'rockGolem', x(1650), 1940, { id: 'left' })
      .unit('neutral', 'rockGolem', x(1600), 1900, { id: 'right' }).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const caster = game.units.find(unit => unit.id === 'caster')!, memory = createAiPolicyMemory();
    const creeps = game.units.filter(unit => unit.owner === 'neutral'), before = creeps.reduce((sum, unit) => sum + unit.hp, 0);
    let damage = 0;
    game.observer = { hit(_source, target, taken) { if (target.id === 'caster') damage += taken; } };
    memory.v6 = { phase: 1, general: { mode: 'hold', target: { x: x(1700), y: 1700 } } };
    const scripts = bootstrapScripts(version).filter(script => script.id === 'v6Backline');
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options)
          .map(entry => ({ ...entry, playerId: 'us' })));
      }
      stepGame(game);
    }
    expect(game.units.includes(caster)).toBe(true);
    expect(caster.hp).toBe(caster.maxHp);
    expect(damage).toBe(0);
    expect(creeps.reduce((sum, unit) => sum + unit.hp, 0)).toBeLessThan(before);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
