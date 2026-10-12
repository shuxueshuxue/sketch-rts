import { describe, expect, it } from 'vitest';
import { assignPlayerColors, NEUTRAL_COLOR, PLAYER_COLORS, playerColor } from './player-colors';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from './sim';

describe('persistent player colors', () => {
  it('gives twelve formerly colliding player IDs different colors, independent of their teams', () => {
    // Every name collided in the former eight-color name hash.
    const oldBucket = (id: string) => [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 8;
    const ids = Array.from({ length: 128 }, (_, i) => `seat-${i}`).filter(id => oldBucket(id) === 0).slice(0, 12);
    expect(ids).toHaveLength(12);
    const colors = assignPlayerColors(ids);
    expect(new Set(Object.values(colors)).size).toBe(ids.length);
    const game = createGame('bareDuel', { players: ids, aiPlayers: [], teams: Object.fromEntries(ids.map((id, i) => [id, `team-${i % 2}`])) });
    expect(new Set(ids.map(id => game.players[id]!.color)).size).toBe(ids.length);
    for (const id of ids) expect(playerColor(id, game)).toBe(game.players[id]!.color);
    expect(playerColor('neutral', game)).toBe(NEUTRAL_COLOR);
  });

  it('preserves saved choices and resolves invalid or duplicate choices in stable roster order', () => {
    const colors = assignPlayerColors(['a', 'b', 'c', 'd'], { a: '#ABCDEF', b: '#abcdef', c: 'red', d: '#102030' });
    expect(colors.a).toBe('#abcdef'); expect(colors.d).toBe('#102030');
    expect(new Set(Object.values(colors)).size).toBe(4);
    expect(colors.b).not.toBe(colors.a); expect(colors.c).toMatch(/^#[0-9a-f]{6}$/);
    expect(assignPlayerColors(['d', 'c', 'b', 'a'], colors)).toEqual(colors);
    expect(playerColor('b', { players: { a: { color: '#abcdef' }, b: { color: '#ABCDEF' } } })).not.toBe('#abcdef');
  });

  it('keeps every palette seat unique before reusing colors and handles player IDs that match object properties', () => {
    const ids = ['__proto__', 'constructor', ...Array.from({ length: PLAYER_COLORS.length - 2 }, (_, i) => `slot-${i}`)];
    const colors = assignPlayerColors(ids);
    expect(Object.keys(colors)).toHaveLength(PLAYER_COLORS.length);
    expect(new Set(Object.values(colors)).size).toBe(PLAYER_COLORS.length);
    const overflow = assignPlayerColors([...ids, 'extra']);
    expect(new Set(Object.values(overflow)).size).toBe(PLAYER_COLORS.length);
    for (const id of ids) expect(overflow[id]).toBe(colors[id]);
  });

  it('restores the same choices across a save and repairs old snapshots once without disturbing valid choices', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `owner-${i}`);
    const game = createGame('bareDuel', { players: ids, aiPlayers: [] });
    game.players[ids[0]!]!.color = '#123456';
    const saved = snapshotGame(game), restored = createGame('bareDuel', { aiPlayers: [] });
    restoreSnapshotIntoGame(restored, saved, game.nextId);
    for (const id of Object.keys(saved.players)) expect(restored.players[id]!.color).toBe(saved.players[id]!.color);
    saved.players[ids[1]!]!.color = '#123456';
    delete saved.players[ids[2]!]!.color;
    restoreSnapshotIntoGame(restored, saved, game.nextId);
    expect(restored.players[ids[0]!]!.color).toBe('#123456');
    expect(new Set(Object.values(restored.players).map(player => player.color)).size).toBe(Object.keys(restored.players).length);
    const repaired = snapshotGame(restored);
    restoreSnapshotIntoGame(restored, repaired, restored.nextId);
    expect(snapshotGame(restored).players).toEqual(repaired.players);
  });
});
