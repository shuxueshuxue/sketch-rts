import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { mountedEscape } from './mounted-micro';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'keeps a $race recovering soldier moving between decisions (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('recovery-move-arrival').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('peer', { team: 'a' })
      .townHall('us', x(500), 500).townHall('peer', x(3500), 3500)
      .unit('us', race === 'grove' ? 'knight' : 'emberRavager', x(700), 2000, { id: 'patient' })
      .unit('neutral', 'ogreWarrior', x(630), 2000,
        { id: 'pursuer', order: { type: 'attack', targetId: 'patient', leashX: x(630), leashY: 2000 } })
      .build().createGame();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    const patient = game.units.find(unit => unit.id === 'patient')!, pursuer = game.units.find(unit => unit.id === 'pursuer')!;
    expect(patient.speed).toBeGreaterThan(pursuer.speed);
    if (race === 'grove') issueCommandFrame(game, [{ playerId: 'us', scriptId: 'charge-control',
      command: { type: 'setAutocast', unitIds: ['patient'], ability: 'charge', enabled: false } }]);
    let combatOrders = 0;
    for (let tick = 0; tick < 300 && game.units.includes(patient); tick++) {
      if (tick % 15 === 0) {
        const command = mountedEscape(snapshotGame(game), patient, [pursuer], 0, undefined, true);
        issueCommandFrame(game, [{ playerId: 'us', scriptId: 'campRecovery',
          command: command.type === 'move' ? { ...command, avoidCombat: true } : command }]);
      }
      stepGame(game);
      if (patient.order.type === 'attack' || patient.order.type === 'charge') combatOrders++;
    }
    expect(game.units).toContain(patient);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(combatOrders).toBe(0);
  });
