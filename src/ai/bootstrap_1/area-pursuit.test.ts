import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiScript } from '../policy/types';
import { bootstrapPolicyContext } from './policy';
import { shellEvasion } from './shell-evasion';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => (['redDragon', 'ogreWarrior'] as const).flatMap(pursuer =>
    [false, true].map(walking => ({ version, mirror, pursuer, walking })))));

it.each(cases)('$version keeps moving after leaving fire when $pursuer follows (mirror=$mirror, walking=$walking)',
  ({ version, mirror, pursuer, walking }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('escaped-area-live-pursuit').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(400), 400).townHall('foe', x(3500), 3500)
      .unit('us', 'horseArcher', x(1600), 1420, { id: 'rider' })
      .worker('us', x(1600), 1600, { id: 'spell-target' })
      .unit('foe', 'footman', x(1910), 1600, { id: 'caster' })
      .unit('foe', pursuer, x(1600), 1640, { id: 'pursuer' })
      .item('staff', 'stormStaff', 0, 0, { carrierId: 'caster' }).build().createGame();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'foe', { type: 'useItem', unitId: 'caster', itemId: 'staff', x: x(1600), y: 1600 });
    issuePlayerCommand(game, 'foe', { type: 'move', unitIds: ['caster'], x: x(3500), y: 3500 });
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['pursuer'], targetId: 'rider' });
    if (walking) issuePlayerCommand(game, 'us', { type: 'move', unitIds: ['rider'], x: x(1600), y: 1420, avoidCombat: true });
    const fire = game.effects.find(effect => effect.type === 'storm')!;
    const memory = createAiPolicyMemory();
    memory.jobs.push({ id: 'rider', kind: `shellEvasion:${fire.id}`, createdTick: game.tick, updatedTick: game.tick });
    const marching: AiScript = { id: 'marching', phase: 'tactics', run: () =>
      ({ type: 'attack', unitIds: ['rider'], targetId: 'pursuer' }) };
    let damage = 0, moves = 0;
    game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
    for (let tick = 0; tick < 90; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [shellEvasion, marching], options);
        moves += entries.filter(entry => entry.scriptId === 'shellEvasion' && entry.command.type === 'move'
          && entry.command.unitIds.includes('rider') && Math.hypot(entry.command.x - x(1600), entry.command.y - 1420) > 10).length;
        issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
      }
      stepGame(game);
    }
    const rider = game.units.find(unit => unit.id === 'rider')!;
    expect(moves).toBeGreaterThan(0);
    expect(damage).toBe(0);
    expect(rider.hp).toBe(rider.maxHp);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
