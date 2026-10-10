import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planSummonerScreen } from './summoner-screen';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  '$race host fights a melee pursuer before its first screen arrives (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const caller = race === 'grove' ? 'summoner' : 'pyreCaller';
    let scene = sketchScene('uncovered-caster-melee').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .unit('foe', 'knight', x(1970), 1500, { id: 'pursuer' });
    for (let index = 0; index < 6; index++) scene = scene.unit('us', caller,
      x(1800 - index % 2 * 35), 1460 + Math.floor(index / 2) * 35, { id: `caster-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    memory.v6 = { general: { mode: 'hold', target: { x: x(500), y: 500 } } };
    issuePlayerCommand(game, 'foe', { type: 'attackMove', unitIds: ['pursuer'], x: x(500), y: 500 });
    let casterDamage = 0;
    game.observer = { hit(source, target, damage) { if (source.owner === 'us' && source.kind === caller && target.id === 'pursuer') casterDamage += damage; } };
    for (let tick = 0; tick < 600; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game);
        const options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory, teams: game.teams });
        for (const command of planSummonerScreen(snapshot, 'us', options)) issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    const host = game.units.filter(unit => unit.id.startsWith('caster-'));
    expect(game.units.some(unit => unit.id === 'pursuer')).toBe(false);
    expect(host).toHaveLength(6);
    expect(host.every(unit => unit.hp === unit.maxHp)).toBe(true);
    expect(casterDamage).toBeGreaterThan(0);
    expect(game.players.us!.gold).toBe(500);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.match.winner).toBeNull();
  });
