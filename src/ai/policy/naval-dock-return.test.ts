import { expect, it } from 'vitest';
import { DOCK_REPAIR } from '../../shared/catalog';
import { createBuilding } from '../../shared/map';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { seconds } from '../../shared/time';
import { createAiPolicyMemory } from '../memory';
import { planNavalTactics } from './naval';

function harbor(x: number, gold = 20) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.map = { ...game.map, width: 4000, height: 4000,
    terrain: { cell: 32, cols: 125, rows: 125, cells: '~'.repeat(125 * 125) } };
  game.scriptedVictory = true;
  game.players.player!.gold = gold;
  const dock = createBuilding('dock', 'player', 'shipyard', 1000, 1000, true);
  game.buildings.push(dock);
  const ship = game.spawnUnit('player', 'warship', x, 1000);
  ship.hp = 20;
  ship.order = { type: 'move', x: 3000, y: 1000 };
  const options = { version: 'v2' as const, requestedVersion: 'v9' as const, memory: createAiPolicyMemory() };
  const orders = () => planNavalTactics(snapshotGame(game), 'player', options)
    .filter(command => 'unitIds' in command && command.unitIds.includes(ship.id));
  return { game, ship, dock, orders };
}

it('keeps a hurt hull returning inside the old250 goal boundary but outside native dock repair', () => {
  const f = harbor(1245), command = f.orders()[0];
  expect(f.ship.x - f.dock.x).toBeGreaterThan(DOCK_REPAIR.range);
  expect(command).toMatchObject({ type: 'move', unitIds: [f.ship.id], avoidCombat: true });
  if (command?.type !== 'move') throw new Error('Expected an ordinary repair approach');
  expect(Math.hypot(command.x - f.dock.x, command.y - f.dock.y)).toBeLessThan(DOCK_REPAIR.range);
});

it('cancels the old fleet move in native repair range and pays for real hull recovery', () => {
  const f = harbor(1210), hp = f.ship.hp, gold = f.game.players.player!.gold;
  expect(f.orders()).toEqual([{ type: 'holdPosition', unitIds: [f.ship.id] }]);
  for (const command of f.orders()) issuePlayerCommand(f.game, 'player', command);
  for (let tick = 0; tick < seconds(1); tick++) stepGame(f.game);
  expect(f.ship.hp).toBe(hp + DOCK_REPAIR.hpPerSecond);
  expect(f.game.players.player!.gold).toBe(gold - DOCK_REPAIR.goldPerSecond);
  expect(f.orders()).toEqual([]);
});

it('does not count the strict dock range boundary as arrived', () => {
  const f = harbor(1000 + DOCK_REPAIR.range);
  expect(f.orders()[0]).toMatchObject({ type: 'move', avoidCombat: true });
});

it('waits without inventing repair or payment when gold is insufficient, then repairs when funded', () => {
  const f = harbor(1210, 0), hp = f.ship.hp;
  for (const command of f.orders()) issuePlayerCommand(f.game, 'player', command);
  for (let tick = 0; tick < seconds(1); tick++) stepGame(f.game);
  expect(f.ship.hp).toBe(hp); expect(f.game.players.player!.gold).toBe(0);
  expect(f.orders()).toEqual([]);
  f.game.players.player!.gold = DOCK_REPAIR.goldPerSecond;
  for (let tick = 0; tick < seconds(1); tick++) stepGame(f.game);
  expect(f.ship.hp).toBe(hp + DOCK_REPAIR.hpPerSecond);
  expect(f.game.players.player!.gold).toBe(0);
});

it('releases the repair trip at the original40 percent admission boundary', () => {
  const f = harbor(1210);
  f.ship.hp = f.ship.maxHp * .4;
  expect(f.orders()).not.toContainEqual({ type: 'holdPosition', unitIds: [f.ship.id] });
  expect(f.orders().some(command => command.type === 'move' && command.avoidCombat)).toBe(false);
});
