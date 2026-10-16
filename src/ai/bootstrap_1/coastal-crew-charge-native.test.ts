import { expect, it } from 'vitest';
import { ABILITY_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { createGame, issuePlayerCommand, stepGame } from '../../shared/sim';

it('native hold blocks a newly enabled charge that the same unheld rider actually begins', () => {
  const def = ABILITY_DEFS.charge;
  if (def.behavior !== 'charge') throw Error('charge definition changed');
  // Controlled normal-stat native boundary, not a historical35595 outcome.
  // The actual35595 target is closer than minRange; no immediate charge or
  // saved unit in that historical game is claimed from this controlled pair.
  const run = (held: boolean) => {
    const game = createGame('bareDuel', { players: ['us', 'foe'], aiPlayers: [] });
    game.units = [];
    const rider = game.spawnUnit('us', 'raider', 500, 500);
    const target = game.spawnUnit('foe', 'footman', 500 + (def.minRange + def.range) / 2, 500);
    issuePlayerCommand(game, 'us', { type: 'setAutocast', unitIds: [rider.id], ability: 'charge', enabled: false });
    if (held) issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: [rider.id] });
    issuePlayerCommand(game, 'us', { type: 'setAutocast', unitIds: [rider.id], ability: 'charge', enabled: true });
    for (let i = 0; i < 2; i++) stepGame(game);
    return { tick: game.tick, order: structuredClone(rider.order), cooldown: abilityCooldown(rider, 'charge'), targetId: target.id };
  };
  const held = run(true), free = run(false);
  expect(held.tick).toBe(2); expect(free.tick).toBe(2);
  expect(held.order.type).toBe('hold'); expect(held.cooldown).toBe(0);
  expect(free.order).toMatchObject({ type: 'charge', targetId: free.targetId });
  expect(free.cooldown).toBeGreaterThan(0);
});
