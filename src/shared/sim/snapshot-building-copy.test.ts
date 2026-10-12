import { describe, expect, it } from 'vitest';
import { createBuilding } from '../map';
import { createGame, snapshotGame } from '../sim';

describe('snapshot building copy semantics', () => {
  it('preserves enumerable extensions and symbols, with the rally target after other string fields', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    const building = createBuilding('barracks', 'player', 'barracks', 500, 500, true);
    const visible = Symbol('visible'), hidden = Symbol('hidden');
    const annotation = { note: 'extension data remains a shallow field' };
    const rallyTarget = { type: 'unit' as const, unitId: 'worker-rally' };
    Object.setPrototypeOf(building, { inheritedExtra: 'excluded' });
    // Insert an extension after rallyTarget to exercise its snapshot key order.
    Object.assign(building, { rallyTarget, annotation, nullExtra: null, undefinedExtra: undefined });
    Object.defineProperty(building, visible, { value: 'symbol-value', enumerable: true });
    Object.defineProperty(building, hidden, { value: 'excluded', enumerable: false });
    Object.defineProperty(building, 'hiddenExtra', { value: 'excluded', enumerable: false });
    game.buildings = [building];

    const copy = snapshotGame(game).buildings[0]!;
    expect(copy).not.toBe(building);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Reflect.get(copy, 'annotation')).toBe(annotation);
    expect(Reflect.get(copy, 'nullExtra')).toBeNull();
    expect(Object.hasOwn(copy, 'undefinedExtra')).toBe(true);
    expect(Reflect.get(copy, 'undefinedExtra')).toBeUndefined();
    expect(Reflect.get(copy, visible)).toBe('symbol-value');
    expect(Object.hasOwn(copy, hidden)).toBe(false);
    expect(Object.hasOwn(copy, 'hiddenExtra')).toBe(false);
    expect(Object.hasOwn(copy, 'inheritedExtra')).toBe(false);
    expect(Object.keys(copy)).toEqual([...Object.keys(building).filter(key => key !== 'rallyTarget'), 'rallyTarget']);
    expect(Reflect.ownKeys(copy).at(-1)).toBe(visible);
    expect(copy.rallyTarget).toEqual(rallyTarget);
    expect(copy.rallyTarget).not.toBe(rallyTarget);
    if (copy.rallyTarget?.type !== 'unit') throw new Error('Expected a copied unit rally target');
    copy.rallyTarget.unitId = 'different-worker';
    copy.hp -= 10;
    expect(rallyTarget.unitId).toBe('worker-rally');
    expect(building.hp).toBe(building.maxHp);
  });

  it.each(['absent', 'undefined', 'null'] as const)('omits an %s rallyTarget without changing its source key presence', state => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    const building = createBuilding('barracks', 'player', 'barracks', 500, 500, true);
    if (state === 'absent') delete building.rallyTarget;
    else Object.assign(building, { rallyTarget: state === 'null' ? null : undefined });
    game.buildings = [building];

    const copy = snapshotGame(game).buildings[0]!;
    expect(Object.hasOwn(copy, 'rallyTarget')).toBe(false);
    expect(Object.keys(copy)).toEqual(Object.keys(building).filter(key => key !== 'rallyTarget'));
    expect(Object.hasOwn(building, 'rallyTarget')).toBe(state !== 'absent');
    if (state !== 'absent') expect(building.rallyTarget).toBe(state === 'null' ? null : undefined);
  });

  it('copies training and research jobs independently from their source and subsequent snapshots', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    const building = createBuilding('barracks', 'player', 'barracks', 500, 500, true);
    building.queue = [{ id: 'training', unitKind: 'footman', paidGold: 135, remaining: 20 }];
    building.researchQueue = [{ upgradeKind: 'weaponTraining', targetLevel: 1, remaining: 30 }];
    game.buildings = [building];

    const copy = snapshotGame(game).buildings[0]!, next = snapshotGame(game).buildings[0]!;
    expect(copy.queue).not.toBe(building.queue);
    expect(copy.researchQueue).not.toBe(building.researchQueue);
    expect(copy.queue[0]).not.toBe(building.queue[0]);
    expect(copy.researchQueue[0]).not.toBe(building.researchQueue[0]);
    copy.queue[0]!.remaining = 0;
    copy.queue.push({ unitKind: 'worker', remaining: 5 });
    copy.researchQueue[0]!.targetLevel = 3;
    copy.researchQueue.length = 0;
    expect(building.queue).toEqual([{ id: 'training', unitKind: 'footman', paidGold: 135, remaining: 20 }]);
    expect(building.researchQueue).toEqual([{ upgradeKind: 'weaponTraining', targetLevel: 1, remaining: 30 }]);
    expect(next.queue).toEqual(building.queue);
    expect(next.researchQueue).toEqual(building.researchQueue);
  });

  it('gives empty training and research queues fresh arrays for every building and snapshot', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    const first = createBuilding('first', 'player', 'barracks', 500, 500, true);
    const second = createBuilding('second', 'player', 'barracks', 600, 500, true);
    game.buildings = [first, second];

    const copy = snapshotGame(game), next = snapshotGame(game);
    copy.buildings[0]!.queue.push({ unitKind: 'footman', remaining: 10 });
    copy.buildings[0]!.researchQueue.push({ upgradeKind: 'weaponTraining', targetLevel: 1, remaining: 20 });
    expect(first.queue).toEqual([]);
    expect(first.researchQueue).toEqual([]);
    expect(copy.buildings[1]!.queue).toEqual([]);
    expect(copy.buildings[1]!.researchQueue).toEqual([]);
    expect(next.buildings[0]!.queue).toEqual([]);
    expect(next.buildings[0]!.researchQueue).toEqual([]);
  });
});
