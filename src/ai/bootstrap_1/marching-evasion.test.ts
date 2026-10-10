import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planShellEvasion } from './shell-evasion';

const WALKERS = ['archer', 'sparkArcher', 'horseArcher', 'summoner', 'pyreCaller', 'knight', 'worker'] as const;

function walkingBolt(kind: typeof WALKERS[number], mirrored: boolean, delay: number,
  order: 'move' | 'attackMove', evasion: boolean) {
  const x = (value: number) => mirrored ? 4096 - value : value;
  const game = sketchScene('ordered-walk-visible-bolt').map('openClaims').replaceDefaults()
    .player('us', { race: kind === 'sparkArcher' || kind === 'pyreCaller' ? 'ember' : 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .unit('foe', 'ballista', x(2120), 1600, { id: 'gun' })
    .unit('us', kind, x(1660), 1600, { id: 'bait' })
    .unit('us', kind, x(1720), 1655, { id: 'walker' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['bait', 'walker'] });
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['gun'], targetId: 'bait' });
  for (let tick = 0; tick < 600 && !game.projectiles.length; tick++) stepGame(game);
  expect(game.projectiles).toHaveLength(1);
  const shot = game.projectiles[0]!;
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['gun'] });
  issuePlayerCommand(game, 'us', { type: order, unitIds: ['walker'], x: x(1720), y: 1600 });
  const memory = createAiPolicyMemory();
  let damage = 0, walkerDamage = 0;
  game.observer = { hit(_source, target, amount) {
    if (target.owner === 'us' && 'order' in target && target.expiresTick === undefined) damage += amount;
    if (target.id === 'walker') walkerDamage += amount;
  } };
  for (let elapsed = 0; elapsed <= shot.duration + 15; elapsed++) {
    if (evasion && elapsed % 15 === delay) issueCommandFrame(game, planShellEvasion(snapshotGame(game), 'us', { memory, teams: game.teams })
      .map(command => ({ playerId: 'us', scriptId: 'shellEvasion', source: 'external-agent' as const, command })));
    stepGame(game);
  }
  expect(planShellEvasion(snapshotGame(game), 'us', { memory, teams: game.teams })).toEqual([]);
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.units.filter(unit => ['bait', 'walker'].includes(unit.id))).toHaveLength(2);
  return { damage, walkerDamage };
}

it.each(WALKERS.flatMap(kind => [false, true]
  .flatMap(mirrored => (['move', 'attackMove'] as const).flatMap(order => [0, 7, 14].map(delay => ({ kind, mirrored, order, delay }))))))(
  'does not walk into an already visible bolt ($kind, mirror=$mirrored, order=$order, delay=$delay)', ({ kind, mirrored, order, delay }) => {
    const old = walkingBolt(kind, mirrored, delay, order, false), next = walkingBolt(kind, mirrored, delay, order, true);
    expect(next.damage).toBeLessThanOrEqual(old.damage);
    if (delay < 14) expect(next.walkerDamage).toBe(0);
  });
