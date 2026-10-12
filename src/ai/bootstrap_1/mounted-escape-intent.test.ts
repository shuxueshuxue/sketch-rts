import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { ABILITY_DEFS, type AbilityDef } from '../../shared/catalog';
import { mountedEscape, THINK_TICKS } from './mounted-micro';

it.each((['raider', 'knight'] as const).flatMap(foeKind => [false, true].flatMap(mirror =>
  [false, true].map(avoidCombat => ({ foeKind, mirror, avoidCombat }))))) (
  'a wounded rider follows its escape intent around a $foeKind (mirror=$mirror, avoid=$avoidCombat)',
  ({ foeKind, mirror, avoidCombat }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('mounted-escape-vs-firing-window').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500).worker('foe', x(3400), 3500)
      .unit('us', 'horseArcher', x(2400), 1800, { id: 'rider', hpRatio: .5 })
      .unit('foe', foeKind, x(2250), 1800, { id: 'foe', order: { type: 'hold', x: x(2250), y: 1800 } })
      .build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    const rider = game.units.find(unit => unit.id === 'rider')!, foe = game.units.find(unit => unit.id === 'foe')!;
    const health = rider.hp, command = mountedEscape(snapshotGame(game), rider, [foe], 0, undefined, avoidCombat);
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks', command }]);
    for (let tick = 0; tick < THINK_TICKS; tick++) stepGame(game);
    const gap = Math.hypot(rider.x - foe.x, rider.y - foe.y);
    const charge = ABILITY_DEFS.charge as Extract<AbilityDef, { behavior: 'charge' }>;
    if (avoidCombat) expect(gap).toBeGreaterThan(charge.minRange);
    else expect(gap).toBeLessThan(charge.minRange);
    expect(game.units).toContain(rider);
    expect(rider.hp).toBe(health);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
