import { describe, expect, it } from 'vitest';
import { createUnit } from '../map';
import { createGame, snapshotGame } from '../sim';

describe('snapshot unit copy semantics', () => {
  it('preserves unknown enumerable fields, symbols and nullable key presence with a plain snapshot object', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    const unit = createUnit('unit', 'player', 'footman', 500, 500);
    const visible = Symbol('visible'), hidden = Symbol('hidden');
    const annotation = { note: 'extension data remains a shallow field' };
    Object.setPrototypeOf(unit, { inheritedExtra: 'excluded' });
    Object.assign(unit, { annotation, nullExtra: null, undefinedExtra: undefined, aim: null, deck: undefined });
    Object.defineProperty(unit, visible, { value: 'symbol-value', enumerable: true });
    Object.defineProperty(unit, hidden, { value: 'excluded', enumerable: false });
    Object.defineProperty(unit, 'hiddenExtra', { value: 'excluded', enumerable: false });
    delete unit.cabin;
    game.units = [unit];
    const copy = snapshotGame(game).units[0]!;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Reflect.get(copy, 'annotation')).toBe(annotation);
    expect(Reflect.get(copy, 'nullExtra')).toBeNull();
    expect(Object.hasOwn(copy, 'undefinedExtra')).toBe(true);
    expect(Reflect.get(copy, 'undefinedExtra')).toBeUndefined();
    expect(copy.aim).toBeNull();
    expect(Object.hasOwn(copy, 'deck')).toBe(true);
    expect(copy.deck).toBeUndefined();
    expect(Object.hasOwn(copy, 'cabin')).toBe(false);
    expect(Reflect.get(copy, visible)).toBe('symbol-value');
    expect(Object.hasOwn(copy, hidden)).toBe(false);
    expect(Object.hasOwn(copy, 'hiddenExtra')).toBe(false);
    expect(Object.hasOwn(copy, 'inheritedExtra')).toBe(false);
    expect(Reflect.ownKeys(copy)).toEqual(Reflect.ownKeys({ ...unit, order: unit.order, orderQueue: [] }));
    expect(copy).not.toBe(unit);
    expect(copy.order).not.toBe(unit.order);
    copy.hp -= 10;
    expect(unit.hp).toBe(unit.maxHp);
  });

  it.each(['absent', 'undefined', 'null'] as const)('normalizes an %s orderQueue to its own independent empty array', state => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    const first = createUnit('first', 'player', 'footman', 500, 500), second = createUnit('second', 'player', 'footman', 600, 500);
    for (const unit of [first, second]) {
      if (state === 'absent') delete unit.orderQueue;
      else Object.assign(unit, { orderQueue: state === 'null' ? null : undefined });
    }
    game.units = [first, second];
    const snapshot = snapshotGame(game), next = snapshotGame(game);
    expect(snapshot.units[0]!.orderQueue).toEqual([]);
    expect(Object.hasOwn(snapshot.units[0]!, 'orderQueue')).toBe(true);
    snapshot.units[0]!.orderQueue!.push({ type: 'move', x: 700, y: 500 });
    expect(snapshot.units[1]!.orderQueue).toEqual([]);
    expect(next.units[0]!.orderQueue).toEqual([]);
    if (state === 'absent') expect(Object.hasOwn(first, 'orderQueue')).toBe(false);
    else expect(first.orderQueue).toBe(state === 'null' ? null : undefined);
  });

  it('copies populated queue orders and their deck points independently from the source and another snapshot', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    const unit = createUnit('unit', 'player', 'footman', 500, 500);
    const order = { type: 'move' as const, x: 700, y: 500, deckPoint: { shipId: 'ship', x: 20, y: 5 } };
    const queued = { type: 'move' as const, x: 900, y: 500, deckPoint: { shipId: 'ship', x: 40, y: 5 } };
    unit.order = order;
    unit.orderQueue = [queued];
    game.units = [unit];
    const copy = snapshotGame(game).units[0]!, next = snapshotGame(game).units[0]!;
    const copiedQueue = copy.orderQueue![0]!;
    if (copy.order.type !== 'move' || copiedQueue.type !== 'move') throw new Error('Expected copied moves');
    copy.order.deckPoint!.x = 200;
    copiedQueue.deckPoint!.x = 400;
    expect(order.deckPoint.x).toBe(20);
    expect(queued.deckPoint.x).toBe(40);
    expect(next.order).toEqual(unit.order);
    expect(next.orderQueue).toEqual(unit.orderQueue);
  });
});
