import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { boardUnit } from '../../shared/decks';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planNavalTactics } from '../policy/naval';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].map(permanent => ({ version, race, mirror, permanent })))));

it.each(cases)('$version returns real $race crew but releases a summons-only ferry (mirror=$mirror, permanent=$permanent)',
  ({ version, race, mirror, permanent }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const caster = 'summoner';
    const ability = 'summon';
    const game = sketchScene('ferry-return-summons').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(400), 500).townHall('foe', x(3600), 3500)
      .unit('us', 'transport', x(1600), 1500, { id: 'ferry' })
      .unit('us', caster, x(1600), 1500, { id: 'caster' })
      .build().createGame();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
      const column = mirror ? 127 - index % 128 : index % 128;
      return column < 23 || column >= 104 ? '.' : '~';
    }).join('') };
    const boat = game.units.find(unit => unit.id === 'ferry')!;
    const summoner = game.units.find(unit => unit.id === 'caster')!;
    expect(boardUnit(boat, summoner, game.units)).toBe(true);
    const sdk = new SdkCommandFrameRuntime(game);
    sdk.issue([{ playerId: 'us', scriptId: 'actual-summon', command: { type: 'cast', unitId: summoner.id, ability,
      x: summoner.x, y: summoner.y } }], {}, { checksum: false });
    stepGame(game);
    const spirit = game.units.find(unit => unit.kind === 'spirit')!;
    expect(spirit.expiresTick).toBeGreaterThan(game.tick);
    expect(spirit.deck?.shipId).toBe(boat.id);
    // The real crew has already disembarked; only the caster's ordinary summon remains.
    if (!permanent) {
      delete summoner.deck;
      summoner.x = x(500); summoner.y = 700;
    }
    boat.order = { type: 'unload', x: x(700), y: 1500, avoidCombat: true };
    const memory = createAiPolicyMemory();
    memory.naval = { ferries: { ferry: { purpose: 'settle', targetId: 'finished-colony',
      from: { x: x(700), y: 1500 }, to: { x: x(3400), y: 1500 }, phase: 'return', crewIds: [], sinceTick: 0 } } };
    const snapshot = snapshotGame(game);
    const commands = planNavalTactics(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
    if (permanent) {
      expect(memory.naval.ferries!.ferry?.phase).toBe('return');
      expect(commands.some(command => command.type === 'stop' && command.unitIds.includes(boat.id))).toBe(false);
    } else {
      expect(memory.naval.ferries!.ferry).toBeUndefined();
      expect(commands).toContainEqual({ type: 'stop', unitIds: [boat.id] });
      sdk.issue(commands.map(command => ({ playerId: 'us', scriptId: 'completed-voyage', command })), {}, { checksum: false });
      expect(boat.order.type).toBe('idle');
      expect(spirit.deck?.shipId).toBe(boat.id);
      expect(game.units).toContain(summoner);
      expect(game.players.us!.gold).toBe(500);
      expect(game.match.stats.unitsLost.us).toBe(0);
    }
  });
