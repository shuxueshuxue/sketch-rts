import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { mountedMicro } from './mounted-micro';

describe('mounted item threat windows', () => {
  it.each((['stormStaff', 'lightningRod'] as const).flatMap(kind => (['foe', 'neutral'] as const).map(owner => ({ kind, owner }))))(
    'stays clear of a ready $kind carried by $owner during ordinary approach commands', ({ kind, owner }) => {
    const game = sketchScene('mounted-ready-item').map('openClaims').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 400).townHall('foe', 3500, 3500)
      .unit('us', 'horseArcher', 1450, 1600, { id: 'rider' })
      .unit(owner, owner === 'neutral' ? 'wildling' : 'footman', 1850, 1600, { id: 'carrier' })
      .item('item', kind, 0, 0, { carrierId: 'carrier' }).build().createGame();
    const rider = game.units.find(unit => unit.id === 'rider')!, carrier = game.units.find(unit => unit.id === 'carrier')!;
    const memory = createAiPolicyMemory();
    if (owner === 'foe') issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['carrier'] });
    for (let tick = 0; tick < 90; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game);
        issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks', command:
          mountedMicro(snapshot, rider, carrier, [carrier], { kind: 'camp' }) },
        ...runAiCommandEntriesFromScripts(snapshot, 'foe', [AI_SCRIPT_LIBRARY.items], { memory, teams: game.teams })
          .map(entry => ({ ...entry, playerId: 'foe' }))]);
      }
      stepGame(game);
    }
    expect(game.units).toContain(rider);
    expect(rider.hp).toBe(rider.maxHp);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it.each(['stormStaff', 'lightningRod'] as const)('attacks during the real %s cooldown instead of permanently avoiding its carrier', kind => {
    const game = sketchScene('mounted-item-cooldown').map('openClaims').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 400).townHall('foe', 3500, 3500)
      .unit('us', 'horseArcher', 1450, 1600, { id: 'rider' }).worker('us', 1850, 1850, { id: 'decoy' })
      .unit('foe', 'footman', 1850, 1600, { id: 'carrier' })
      .item('item', kind, 0, 0, { carrierId: 'carrier' }).build().createGame();
    const rider = game.units.find(unit => unit.id === 'rider')!, carrier = game.units.find(unit => unit.id === 'carrier')!;
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['carrier'] });
    issuePlayerCommand(game, 'foe', { type: 'useItem', unitId: 'carrier', itemId: 'item', targetId: 'decoy', x: 1850, y: 1850 });
    for (let tick = 0; tick < 90; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks', command:
        mountedMicro(snapshotGame(game), rider, carrier, [carrier], { kind: 'camp' }) }]);
      stepGame(game);
    }
    expect(rider.hp).toBe(rider.maxHp);
    expect(carrier.hp).toBeLessThan(carrier.maxHp);
    expect(game.items.find(item => item.id === 'item')!.cooldownRemaining).toBeGreaterThan(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
