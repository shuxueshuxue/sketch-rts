import { describe, expect, it } from 'vitest';
import { createGame, snapshotGame } from '../shared/sim';
import { drawMinimapMap } from './minimap-art';
import { ownerInk } from './world-renderer';
import { RELATION_INK } from './relations';

describe('match color presentation', () => {
  it('uses twelve distinct assigned owner colors on the minimap and preserves intentional relation colors when toggled', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `seat-${i}`);
    const game = createGame('bareDuel', { players: ids, aiPlayers: [], teams: Object.fromEntries(ids.map((id, i) => [id, `team-${i % 2}`])) });
    const snapshot = snapshotGame(game);
    delete snapshot.map.terrain; snapshot.items = []; snapshot.units = [];
    const marks = ids.map((id, i) => ({ id, category: 'unit' as const, kind: 'warship', radius: 10, priority: 1,
      owner: id, x: 200 + i * 120, y: 200, sourceIds: [id] }));
    const colors: string[] = [];
    const brush = { fillStyle: '', fillRect(this: { fillStyle: string }) { colors.push(this.fillStyle); } } as unknown as CanvasRenderingContext2D;
    const rect = { x: 0, y: 0, width: 200, height: 200 };
    drawMinimapMap(brush, snapshot, rect, marks);
    expect(colors.slice(1)).toEqual(ids.map(id => ownerInk(id, snapshot)));
    expect(new Set(colors.slice(1)).size).toBe(12);
    const saved = snapshot.players;
    colors.length = 0;
    drawMinimapMap(brush, snapshot, rect, marks, ids[0]);
    expect(colors.slice(1)).toEqual(ids.map((_, i) => i === 0 ? RELATION_INK.own : i % 2 === 0 ? RELATION_INK.ally : RELATION_INK.enemy));
    expect(snapshot.players).toBe(saved);
    colors.length = 0;
    drawMinimapMap(brush, snapshot, rect, marks);
    expect(colors.slice(1)).toEqual(ids.map(id => ownerInk(id, snapshot)));
  });
});
