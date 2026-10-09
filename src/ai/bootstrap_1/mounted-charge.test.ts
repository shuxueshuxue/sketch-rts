import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { distance } from '../policy/spatial';
import { mountedMicro } from './mounted-micro';

describe('mounted firing inside the charge minimum', () => {
  it('fires within the next think while the knight remains outside its real melee reach', () => {
    const game = sketchScene('mounted-center-reach').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', 400, 400).townHall('foe', 3500, 3500)
      .unit('us', 'horseArcher', 2000, 2000, { id: 'rider' })
      .unit('foe', 'knight', 2134, 2000, { id: 'knight' }).build().createGame();
    const rider = game.units.find(unit => unit.id === 'rider')!, knight = game.units.find(unit => unit.id === 'knight')!;
    const command = mountedMicro(snapshotGame(game), rider, knight, [knight], { kind: 'camp' });
    expect(command.type).toBe('attack');
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks', command },
      { playerId: 'foe', scriptId: 'pursue', command: { type: 'attack', unitIds: ['knight'], targetId: 'rider' } }]);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    expect(knight.hp).toBeLessThan(knight.maxHp);
    expect(rider.hp).toBe(rider.maxHp);
    expect(abilityCooldown(knight, 'charge')).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it('keeps a normally researched rider firing without damage after entering the knight’s inner window', () => {
    let scene = sketchScene('mounted-inner-charge').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', 500, 500).townHall('foe', 3500, 3500).goldMine('main', 788, 500, 10000)
      .farms('us', 8, 400, 1100).building('us', 'stables', 500, 800, { id: 'stables' })
      .unit('us', 'horseArcher', 2000, 2000, { id: 'rider' })
      .unit('foe', 'knight', 2300, 2000, { id: 'knight' });
    for (let i = 0; i < 3; i++) scene = scene.worker('us', 530, 530 + i * 20,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    const game = scene.build().createGame();
    const rider = game.units.find(unit => unit.id === 'rider')!, knight = game.units.find(unit => unit.id === 'knight')!;
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['rider'] });
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['knight'] });
    for (const level of UPGRADE_DEFS.speedTraining.levels) {
      while (game.players.us!.gold < level.cost) stepGame(game);
      issuePlayerCommand(game, 'us', { type: 'research', buildingId: 'stables', upgradeKind: 'speedTraining' });
      for (let tick = 0; tick <= level.researchTime; tick++) stepGame(game);
    }
    expect(rider.hp).toBe(rider.maxHp);
    expect(knight.hp).toBe(knight.maxHp);
    issuePlayerCommand(game, 'us', { type: 'move', unitIds: ['rider'], x: knight.x - 134, y: knight.y });
    while (rider.order.type === 'move') stepGame(game);
    expect(distance(rider, knight)).toBeLessThan(180);
    expect(knight.hp).toBe(knight.maxHp);
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['knight'], targetId: 'rider' });
    let damage = 0;
    game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
    for (let tick = 0; tick < 6000 && game.units.includes(rider) && game.units.includes(knight); tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks',
        command: mountedMicro(snapshotGame(game), rider, knight, [knight], { kind: 'camp' }) }]);
      stepGame(game);
    }
    expect(game.units).toContain(rider);
    expect(game.units).not.toContain(knight);
    expect(damage).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(890);
  }, 30000);
});
