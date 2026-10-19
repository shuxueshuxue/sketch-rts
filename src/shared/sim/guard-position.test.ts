import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame, strikeUnit } from '../sim';
import { createBuilding } from '../map';
import { createRoom } from '../rooms';
import { createSaveGameRecord, restoreGameFromSave } from '../savegame';
import { RULES_VERSION, assertCurrentRulesVersion, savedRulesVersion } from '../rules-version';

function duel(ai = false) {
  const game = createGame('bareDuel', { aiPlayers: ai ? ['player', 'enemy'] : ['enemy'] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.scriptedVictory = true; delete game.map.terrain;
  const guard = game.spawnUnit('player', 'footman', 1000, 1500);
  return { game, guard };
}

describe('human guard position', () => {
  it('resists repeated lures without drifting and returns to its original station', () => {
    const { game, guard } = duel();
    const origin = { x: guard.x, y: guard.y };
    let farthest = 0;
    const tick = () => { stepGame(game); farthest = Math.max(farthest, Math.hypot(guard.x - origin.x, guard.y - origin.y)); };
    for (let lure = 0; lure < 8; lure++) {
      const bait = game.spawnUnit('enemy', 'worker', 1200 + lure * 180, 1500);
      issuePlayerCommand(game, 'enemy', { type: 'holdPosition', unitIds: [bait.id] });
      for (let t = 0; t < 100 && guard.x < bait.x - 50; t++) tick();
      bait.hp = 0;
      tick(); tick();
    }
    for (let t = 0; t < 300; t++) tick();
    expect(farthest).toBeGreaterThan(150);
    expect(farthest).toBeLessThanOrEqual(600);
    expect(Math.hypot(guard.x - origin.x, guard.y - origin.y)).toBeLessThan(8);
  });

  it.each(['move', 'attackMove'] as const)('establishes a station only when the explicit %s finishes', type => {
    const { game, guard } = duel();
    const original = { ...guard.guardPosition! };
    issuePlayerCommand(game, 'player', { type, unitIds: [guard.id], x: 1850, y: 1500 });
    stepGame(game);
    expect(guard.guardPosition).toEqual(original);
    for (let tick = 0; tick < 400 && guard.order.type !== 'idle'; tick++) stepGame(game);
    expect(guard.order.type).toBe('idle');
    expect(guard.x).toBeGreaterThan(1840);
    expect(guard.guardPosition).toEqual({ x: guard.x, y: guard.y });
  });

  it.each(['stop', 'holdPosition'] as const)('sets the station at the current position on %s', type => {
    const { game, guard } = duel();
    guard.x += 400;
    const bait = game.spawnUnit('enemy', 'archer', 1590, 1500);
    issuePlayerCommand(game, 'player', { type, unitIds: [guard.id] });
    const station = { x: guard.x, y: guard.y };
    expect(guard.guardPosition).toEqual(station);
    if (type === 'holdPosition') {
      for (let tick = 0; tick < 20; tick++) stepGame(game);
      expect({ x: guard.x, y: guard.y }).toEqual(station);
    } else {
      stepGame(game);
      expect(guard.order).toMatchObject({ type: 'attack', targetId: bait.id, leashX: station.x, leashY: station.y });
    }
  });

  it('retaliates from the saved station, ignores hits during return, and can acquire again after arriving', () => {
    const { game, guard } = duel();
    guard.x += 400;
    const enemy = game.spawnUnit('enemy', 'archer', 1700, 1500);
    enemy.order = { type: 'hold', x: enemy.x, y: enemy.y };
    strikeUnit(game, enemy, guard, 1, 'spell');
    expect(guard.order).toMatchObject({ type: 'attack', leashX: 1000, leashY: 1500 });
    stepGame(game);
    expect(guard.order).toMatchObject({ type: 'move', x: 1000, y: 1500, returnToGuard: true });
    const origin = { ...guard.guardPosition! };
    strikeUnit(game, enemy, guard, 1, 'spell');
    expect(guard.order.type).toBe('move');
    enemy.hp = 0;
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(guard.guardPosition).toEqual(origin);
    expect(Math.hypot(guard.x - 1000, guard.y - 1500)).toBeLessThan(8);
    const next = game.spawnUnit('enemy', 'worker', guard.x + 150, guard.y);
    stepGame(game);
    expect(guard.order).toMatchObject({ type: 'attack', targetId: next.id, leashX: 1000, leashY: 1500 });
  });

  it('inherits the original station when continuing into another nearby fight', () => {
    const { game, guard } = duel();
    const first = game.spawnUnit('enemy', 'worker', 1200, 1500);
    for (let tick = 0; tick < 80 && guard.x < 1150; tick++) stepGame(game);
    first.hp = 0;
    const next = game.spawnUnit('enemy', 'worker', 1330, 1500);
    stepGame(game); stepGame(game);
    expect(guard.order).toMatchObject({ type: 'attack', targetId: next.id, leashX: 1000, leashY: 1500 });
    expect(guard.guardPosition).toEqual({ x: 1000, y: 1500 });
  });

  it('leaves explicit attacks and attack-moves free to pursue beyond the old station', () => {
    for (const type of ['attack', 'attackMove'] as const) {
      const { game, guard } = duel();
      const target = game.spawnUnit('enemy', 'worker', 1900, 1500);
      target.hp = target.maxHp = 10000;
      issuePlayerCommand(game, 'player', type === 'attack'
        ? { type, unitIds: [guard.id], targetId: target.id }
        : { type, unitIds: [guard.id], x: 2000, y: 1500 });
      for (let tick = 0; tick < 300; tick++) stepGame(game);
      expect(guard.x - 1000).toBeGreaterThan(600);
      expect(guard.order).not.toHaveProperty('returnToGuard');
    }
  });

  it('establishes the trained unit station at its reached rally position', () => {
    const { game } = duel();
    const barracks = createBuilding('barracks', 'player', 'barracks', 1200, 1200, true);
    game.buildings.push(barracks, createBuilding('farm', 'player', 'farm', 800, 800, true));
    issuePlayerCommand(game, 'player', { type: 'setRally', buildingIds: [barracks.id], x: 1700, y: 1500 });
    issuePlayerCommand(game, 'player', { type: 'train', buildingId: barracks.id, unitKind: 'footman' });
    barracks.queue[0]!.remaining = 1;
    stepGame(game);
    const recruit = game.units[1]!;
    for (let tick = 0; tick < 300 && recruit.order.type !== 'idle'; tick++) stepGame(game);
    expect(Math.hypot(recruit.x - 1700, recruit.y - 1500)).toBeLessThan(8);
    expect(recruit.guardPosition).toEqual({ x: recruit.x, y: recruit.y });
  });

  it('keeps queued movement authoritative and establishes the last reached station', () => {
    const { game, guard } = duel();
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [guard.id], x: 1400, y: 1500 });
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [guard.id], x: 2000, y: 1500, queued: true });
    for (let tick = 0; tick < 400; tick++) stepGame(game);
    expect(guard.order.type).toBe('idle');
    expect(guard.x).toBeGreaterThan(1990);
    expect(guard.guardPosition).toEqual({ x: guard.x, y: guard.y });
  });

  it('establishes the reached tower station instead of walking back to the pre-garrison position', () => {
    const { game, guard } = duel();
    const tower = createBuilding('tower', 'player', 'fortifiedTower', 2000, 1500, true);
    game.buildings.push(tower);
    issuePlayerCommand(game, 'player', { type: 'garrison', unitIds: [guard.id], buildingId: tower.id });
    for (let tick = 0; tick < 500; tick++) stepGame(game);
    expect(guard.garrison?.buildingId).toBe(tower.id);
    expect(guard.guardPosition).toEqual({ x: guard.x, y: guard.y });
  });

  it('persists independent station/return state and restores controller identity at checkpoints', () => {
    const { game, guard } = duel();
    guard.x += 400;
    guard.order = { type: 'move', x: 1000, y: 1500, returnToGuard: true };
    const snapshot = snapshotGame(game);
    snapshot.units[0]!.guardPosition!.x = 990;
    expect(guard.guardPosition!.x).toBe(1000);
    const copy = createGame('bareDuel', { aiPlayers: [] });
    restoreSnapshotIntoGame(copy, snapshotGame(game), game.nextId);
    expect(copy.aiPlayers).toEqual(['enemy']);
    for (let tick = 0; tick < 200; tick++) stepGame(copy);
    expect(copy.units[0]!.guardPosition).toEqual({ x: 1000, y: 1500 });
    expect(copy.units[0]!.order.type).toBe('idle');
  });

  it('reads rules-5 saves and initializes missing stations at the saved position on the first tick', () => {
    const { game, guard } = duel();
    guard.x += 300;
    const room = { ...createRoom({ id: 'old-guard', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
    const save = createSaveGameRecord(game, room, { id: 'old-guard' });
    save.rulesVersion = 5;
    delete save.snapshot.aiPlayers;
    for (const unit of save.snapshot.units) delete unit.guardPosition;
    const bytes = JSON.stringify(save);
    const restored = restoreGameFromSave(save);
    stepGame(restored);
    expect(restored.units[0]!.guardPosition).toEqual({ x: 1300, y: 1500 });
    expect(JSON.stringify(save)).toBe(bytes);
    expect(savedRulesVersion(5)).toBe(5);
    expect(RULES_VERSION).toBe(6);
    expect(() => assertCurrentRulesVersion(5, 'Replay')).toThrow('Cross-version');
  });
});
