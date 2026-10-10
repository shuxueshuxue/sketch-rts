import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { campRecovery } from './camp-recovery';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    (['gather', 'engage'] as const).map(stage => ({ version, race, mirror, stage })))));

it.each(cases)('$version heals its wounded $race soldier during $stage (mirror=$mirror)', ({ version, race, mirror, stage }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('camp-healing-rendezvous').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500)
    .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(1700), 1600, { id: 'patient', hp: 20 })
    .unit('us', race === 'grove' ? 'priest' : 'emberAcolyte', x(1700), 1100,
      { id: 'healer', order: { type: 'hold', x: x(1700), y: 1100 } })
    .unit('neutral', 'wildling', x(2300), 1600, { id: 'guard' }).build().createGame();
  game.scriptedVictory = true;
  const memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  const patient = game.units.find(unit => unit.id === 'patient')!;
  memory.v6 = { creep: { center: { x: x(2300), y: 1600 }, reach: 0, staging: { x: x(1600), y: 1600 },
    stage, since: 0, group: ['patient'] } };
  for (let tick = 0; tick < 180; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      sdk.issue(runAiCommandEntriesFromScripts(snapshot, 'us', [campRecovery], options)
        .map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
    }
    stepGame(game);
  }
  expect(game.units.includes(patient)).toBe(true);
  expect(patient.hp).toBe(75);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
