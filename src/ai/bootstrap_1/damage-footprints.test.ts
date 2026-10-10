import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { campRecovery } from './camp-recovery';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version keeps its wounded $race soldier outside a storm aimed at its neighbor (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('storm-collateral-retreat').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500)
    .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(1446), 1600, { id: 'patient', hp: 20 })
    .unit('us', race === 'grove' ? 'footman' : 'ashWarden', x(1590), 1600, { id: 'neighbor', order: { type: 'hold', x: x(1590), y: 1600 } })
    .unit('neutral', 'wildling', x(1850), 1600, { id: 'carrier' })
    .item('staff', 'stormStaff', 0, 0, { carrierId: 'carrier' }).build().createGame();
  game.scriptedVictory = true;
  const memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  const patient = game.units.find(unit => unit.id === 'patient')!;
  game.items.find(item => item.id === 'staff')!.cooldownRemaining = 18;
  memory.v6 = { creep: { center: { x: x(1850), y: 1600 }, reach: 0, staging: { x: x(1430), y: 1600 },
    stage: 'engage', since: 0, group: ['patient', 'neighbor'] } };
  for (let tick = 0; tick < 90; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      sdk.issue(runAiCommandEntriesFromScripts(snapshot, 'us', [campRecovery], options)
        .map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
    }
    stepGame(game);
  }
  expect(game.items.find(item => item.id === 'staff')!.cooldownRemaining).toBeGreaterThan(0);
  expect(game.units.includes(patient)).toBe(true);
  expect(patient.hp).toBe(20);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
