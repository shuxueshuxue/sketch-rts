import { expect, it } from 'vitest';
import { createUnit } from '../../shared/map';
import { createGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { createNavalLoadingDiagnostics } from './naval-loading-diagnostics';

function scene(guards: number) {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], teams: { player: 'a', enemy: 'b' } });
  const boat = createUnit('boat', 'player', 'transport', 700, 700);
  const rider = createUnit('rider', 'player', 'horseArcher', 600, 600);
  game.units = [boat, rider, createUnit('foe', 'enemy', 'footman', 1500, 1500), ...Array.from({ length: guards }, (_, i) => createUnit(`guard-${i}`, 'player', 'knight', 500 + i * 40, 500))];
  const memory = createAiPolicyMemory();
  memory.naval = { ferries: { boat: { purpose: 'creep', riderId: rider.id, targetId: 'island', from: { x: 700, y: 700 }, to: { x: 1600, y: 700 }, phase: 'loading', sinceTick: 0, crewIds: [] } } };
  const tracker = createNavalLoadingDiagnostics(owner => owner === 'player' ? memory : undefined);
  const context = { game, match: {} as never, players: ['player', 'enemy'] };
  const state = tracker.create!(context);
  const sample = (second: number) => { game.tick = second * 20; tracker.afterStep!(state, { ...context, after: game }); };
  const result = () => tracker.finish(state, context as never).player!;
  return { game, boat, rider, sample, result };
}

it('counts the filtered-crew gate and separates spare real guards from an additional real army shortage', () => {
  const covered = scene(5); covered.sample(1);
  expect(covered.result().blockedSeconds).toBe(1);
  expect(covered.result().fullGuardSufficientSeconds).toBe(1);
  expect(covered.result().ships.boat!.first.filteredStrength).toBeLessThan(covered.result().ships.boat!.first.ownStrength);
  const uncovered = scene(0); uncovered.sample(1);
  expect(uncovered.result().blockedSeconds).toBe(1);
  expect(uncovered.result().fullGuardSufficientSeconds).toBe(0);
});

it('does not count a ferry still approaching, a boarded rider, or a coast without an armed enemy', () => {
  const far = scene(5); far.boat.x = 1200; far.sample(1);
  expect(far.result().blockedSeconds).toBe(0);
  const aboard = scene(5); aboard.rider.deck = { shipId: 'boat', x: 0, y: 0 }; aboard.sample(1);
  expect(aboard.result().blockedSeconds).toBe(0);
  const clear = scene(5); clear.game.units = clear.game.units.filter(unit => unit.owner !== 'enemy'); clear.sample(1);
  expect(clear.result().blockedSeconds).toBe(0);
});
