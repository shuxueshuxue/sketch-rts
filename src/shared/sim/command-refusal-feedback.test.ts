import { describe, expect, it } from 'vitest';
import { createGame, tryPlayerCommand, snapshotGame, stepGame, restoreSnapshotIntoGame } from '../sim';
import { createBuilding } from '../map';
import { checkCommandLegality, refusalFor } from './command-validation';
import { canonicalGameState } from './canonical';
import { applyCommandFrame } from './frame';
import { CommandFrameRuntime } from './command-frame-runtime';
import type { GameCommand } from '../types';

function field() {
  const game = createGame('bareDuel', { aiPlayers: [], races: { player: 'grove' } });
  game.units = []; game.buildings = []; game.items = [];
  delete game.map.terrain; game.scriptedVictory = true;
  return game;
}

describe('structured private refusal receipts', () => {
  it('reports foreign and missing actors without throwing while constructing the receipt', () => {
    const game = field(), neutral = game.spawnUnit('neutral', 'wildling', 1500, 1500);
    const command: GameCommand = { type: 'useItem', unitId: neutral.id, itemId: 'not-carried' };
    expect(tryPlayerCommand(game, 'player', command)).toMatchObject({ ok: false, refusal: { reason: 'ownership' } });
    expect(game.effects.at(-1)).toMatchObject({ owner: 'player', commandType: 'useItem', refusal: { reason: 'ownership' } });
    expect(() => tryPlayerCommand(game, 'player', { ...command, unitId: 'missing' })).not.toThrow();
    expect(neutral.order.type).toBe('idle');
  });

  it('reports insufficient gold without replacing an order or spending an entity id', () => {
    const game = field();
    const worker = game.spawnUnit('player', 'worker', 1500, 1500);
    const building = createBuilding('barracks', 'player', 'barracks', 1700, 1500, true);
    game.buildings.push(building); game.players.player!.gold = 1;
    worker.order = { type: 'move', x: 1800, y: 1800 };
    const before = structuredClone(worker.order), nextId = game.nextId;
    const result = tryPlayerCommand(game, 'player', { type: 'train', buildingId: building.id, unitKind: 'footman' });
    expect(result.ok).toBe(false);
    expect(game.effects).toContainEqual(expect.objectContaining({ owner: 'player', type: 'orderEnded', feedbackStatus: 'rejected', refusal: { reason: 'gold', detail: { required: 100, available: 1 } } }));
    expect(worker.order).toEqual(before); expect(game.nextId).toBe(nextId);
  });

  it('detaches refusal facts from the simulation and from another snapshot', () => {
    const game = field(), worker = game.spawnUnit('player', 'worker', 1500, 1500);
    game.players.player!.gold = 1;
    tryPlayerCommand(game, 'player', { type: 'build', unitId: worker.id, buildingKind: 'farm', x: 1800, y: 1800 });
    const before = canonicalGameState(game), first = snapshotGame(game), second = snapshotGame(game);
    const original = game.effects.find(effect => effect.refusal)?.refusal;
    const copied = first.effects.find(effect => effect.refusal)?.refusal;
    const other = second.effects.find(effect => effect.refusal)?.refusal;
    if (copied?.reason !== 'gold' || other?.reason !== 'gold') throw new Error('Expected gold refusal facts');
    expect(copied).not.toBe(original);
    expect(copied.detail).not.toBe(original?.detail);
    copied.detail.available = 999;
    expect(other.detail.available).toBe(1);
    expect(canonicalGameState(game)).toEqual(before);
  });

  it('reports the shared cooldown and inventory facts at the actual rejection', () => {
    const game = field(), priest = game.spawnUnit('player', 'priest', 1500, 1500);
    priest.abilityCooldowns = { heal: 47 };
    const cooldown: GameCommand = { type: 'cast', unitId: priest.id, ability: 'heal', targetId: priest.id };
    tryPlayerCommand(game, 'player', cooldown);
    expect(game.effects.at(-1)?.refusal).toEqual({ reason: 'cooldown', detail: { remainingTicks: 47, ability: 'heal' } });
    for (let i = 0; i < 4; i++) game.items.push({ id: `carried-${i}`, kind: 'experienceBook', carrierId: priest.id, slot: `carry${i}` as 'carry0', x: priest.x, y: priest.y, cooldownRemaining: 0 });
    game.items.push({ id: 'loot', kind: 'experienceBook', x: priest.x, y: priest.y, cooldownRemaining: 0 });
    tryPlayerCommand(game, 'player', { type: 'pickupItem', unitId: priest.id, itemId: 'loot' });
    expect(game.effects.at(-1)?.refusal).toEqual({ reason: 'inventory-full', detail: { unitId: priest.id } });
  });

  it('keeps the valid part of a mixed selection and reports every refused actor', () => {
    const game = field(), worker = game.spawnUnit('player', 'worker', 1500, 1500), soldier = game.spawnUnit('player', 'footman', 1550, 1500);
    const building = createBuilding('damaged', 'player', 'barracks', 1700, 1500, true); building.hp -= 50; game.buildings.push(building);
    soldier.order = { type: 'move', x: 1600, y: 1600 };
    const command: GameCommand = { type: 'repair', unitIds: [worker.id, soldier.id], buildingId: building.id };
    expect(tryPlayerCommand(game, 'player', command).ok).toBe(true);
    expect(worker.order.type).toBe('repair'); expect(soldier.order.type).toBe('move');
    expect(game.effects.find(effect => effect.unitId === soldier.id)?.refusal).toEqual({ reason: 'unit-ineligible', detail: { required: 'worker' } });
  });

  it('shares preview, immediate refusal and arrival refusal without mutating a preview', () => {
    const game = field(), unit = game.spawnUnit('player', 'footman', 1500, 1500);
    const tower = createBuilding('tower', 'player', 'fortifiedTower', 1700, 1500, true); game.buildings.push(tower);
    const ballista = game.spawnUnit('player', 'ballista', 1500, 1600);
    const command: GameCommand = { type: 'garrison', unitIds: [ballista.id], buildingId: tower.id };
    const before = canonicalGameState(game);
    const cause = refusalFor(game, 'player', command);
    expect(canonicalGameState(game)).toEqual(before);
    expect(cause?.reason).toBe('garrison-mechanical');
    tryPlayerCommand(game, 'player', command);
    expect(game.effects.at(-1)?.refusal).toEqual(cause);
    expect(tryPlayerCommand(game, 'player', { ...command, unitIds: [unit.id] }).ok).toBe(true);
    tower.owner = 'enemy'; stepGame(game);
    expect(game.effects.find(effect => effect.unitId === unit.id && effect.type === 'orderEnded')?.refusal?.reason).toBe('garrison-ownership');
  });

  it('revalidates a pickup that became full while walking', () => {
    const game = field(), unit = game.spawnUnit('player', 'footman', 1500, 1500);
    game.items.push({ id: 'loot', kind: 'experienceBook', x: 2000, y: 1500, cooldownRemaining: 0 });
    tryPlayerCommand(game, 'player', { type: 'pickupItem', unitId: unit.id, itemId: 'loot' });
    for (let i = 0; i < 4; i++) game.items.push({ id: `carried-${i}`, kind: 'experienceBook', carrierId: unit.id, slot: `carry${i}` as 'carry0', x: unit.x, y: unit.y, cooldownRemaining: 0 });
    Object.assign(unit, { x: 2000, y: 1500 }); stepGame(game);
    expect(unit.order.type).toBe('idle');
    expect(game.effects.find(effect => effect.unitId === unit.id && effect.type === 'orderEnded')?.refusal?.reason).toBe('inventory-full');
    expect(game.items.find(item => item.id === 'loot')?.carrierId).toBeUndefined();
  });

  it('derives identical refusal effects on lockstep peers for each applied tick', () => {
    const game = field(), priest = game.spawnUnit('player', 'priest', 1500, 1500);
    game.buildings.push(createBuilding('barracks', 'player', 'barracks', 1700, 1500, true));
    game.players.player!.gold = 0; priest.abilityCooldowns = { heal: 100 };
    const peer = field(); restoreSnapshotIntoGame(peer, snapshotGame(game), game.nextId);
    for (let sequence = 0; sequence < 6; sequence++) {
      const frame = { roomId: 'two-peers', sequence, tick: game.tick, commands: [
        { playerId: 'player', command: { type: 'train' as const, buildingId: 'barracks', unitKind: 'footman' as const } },
        { playerId: 'player', command: { type: 'cast' as const, unitId: priest.id, ability: 'heal' as const, targetId: priest.id } },
      ] };
      applyCommandFrame(game, frame); applyCommandFrame(peer, structuredClone(frame));
      expect(canonicalGameState(peer)).toEqual(canonicalGameState(game));
      stepGame(game); stepGame(peer);
      expect(canonicalGameState(peer)).toEqual(canonicalGameState(game));
    }
    expect(game.effects.some(effect => effect.refusal?.reason === 'gold')).toBe(true);
    expect(game.effects.some(effect => effect.refusal?.reason === 'cooldown')).toBe(true);
  });

  it('keeps admission read-only but reports a transient race when the accepted frame applies', () => {
    const game = field(); game.buildings.push(createBuilding('barracks', 'player', 'barracks', 1700, 1500, true));
    const runtime = new CommandFrameRuntime({ game, roomId: 'test', rejectionLabel: 'Rejected' });
    const command: GameCommand = { type: 'train', buildingId: 'barracks', unitKind: 'footman' };
    game.players.player!.gold = 1000; runtime.admit([{ playerId: 'player', command }]);
    game.players.player!.gold = 0;
    const before = canonicalGameState(game);
    expect(checkCommandLegality(game, 'player', command)?.refusal?.reason).toBe('gold');
    expect(canonicalGameState(game)).toEqual(before);
    applyCommandFrame(game, { roomId: 'test', sequence: 0, tick: game.tick, commands: [{ playerId: 'player', command }] });
    expect(game.effects.at(-1)?.refusal?.reason).toBe('gold');
  });

  it('rebuilds waiting from current conditions identically after a checkpoint', () => {
    const game = field(), worker = game.spawnUnit('player', 'worker', 1500, 1500);
    game.players.player!.gold = 1000;
    tryPlayerCommand(game, 'player', { type: 'build', unitId: worker.id, buildingKind: 'farm', x: 1560, y: 1500 });
    game.players.player!.gold = 0; stepGame(game);
    expect(worker.order.type).toBe('build');
    const waiting = game.effects.find(effect => effect.feedbackStatus === 'waiting');
    expect(waiting?.refusal?.reason).toBe('gold');
    const restored = field(); restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    for (let i = 0; i < 5; i++) { stepGame(game); stepGame(restored); expect(canonicalGameState(restored)).toEqual(canonicalGameState(game)); }
    expect(game.effects.filter(effect => effect.feedbackStatus === 'waiting')).toHaveLength(1);
    expect(game.effects.find(effect => effect.feedbackStatus === 'waiting')?.id).toBe(waiting!.id);
    game.players.player!.gold = 1000; stepGame(game);
    expect(game.effects.some(effect => effect.feedbackStatus === 'waiting')).toBe(false);
  });
});
