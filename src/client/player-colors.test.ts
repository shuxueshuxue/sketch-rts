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
    // Each piece is a dark rim, then its colour (see @@@minimap-art): keep the colours.
    const brush = { fillStyle: '', fillRect(this: { fillStyle: string }) { if (this.fillStyle !== '#14110c') colors.push(this.fillStyle); } } as unknown as CanvasRenderingContext2D;
    const rect = { x: 0, y: 0, width: 200, height: 200 };
    drawMinimapMap(brush, snapshot, rect, marks);
    expect(colors.slice(1)).toEqual(ids.map(id => ownerInk(id, snapshot)));
    expect(new Set(colors.slice(1)).size).toBe(12);
    const saved = snapshot.players;
    colors.length = 0;
    drawMinimapMap(brush, snapshot, rect, marks, ids[0]);
    // Layered as @@@minimap-art: the enemy (odd seats), then allies, then the viewer's own on top.
    expect(colors.slice(1)).toEqual([...ids.filter((_, i) => i % 2 === 1).map(() => RELATION_INK.enemy),
      ...ids.filter((_, i) => i > 0 && i % 2 === 0).map(() => RELATION_INK.ally), RELATION_INK.own]);
    expect(snapshot.players).toBe(saved);
    colors.length = 0;
    drawMinimapMap(brush, snapshot, rect, marks);
    expect(colors.slice(1)).toEqual(ids.map(id => ownerInk(id, snapshot)));
  });

  // @@@minimap-art - The player's own over the enemy's, and what is selected over everything, in white.
  it('draws the player\'s own pieces over others and the selection on top in white', () => {
    const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [] });
    const snapshot = snapshotGame(game);
    delete snapshot.map.terrain; snapshot.items = []; snapshot.units = [];
    const mark = (id: string, owner: string) => ({ id, category: 'unit' as const, kind: 'footman', radius: 10, priority: 60, owner, x: 300, y: 300, sourceIds: [id] });
    const marks = [mark('mine-a', 'player'), mark('theirs', 'enemy'), mark('mine-b', 'player')];
    const colors: string[] = [];
    const brush = { fillStyle: '', fillRect(this: { fillStyle: string }) { if (this.fillStyle !== '#14110c') colors.push(this.fillStyle); } } as unknown as CanvasRenderingContext2D;
    drawMinimapMap(brush, snapshot, { x: 0, y: 0, width: 200, height: 200 }, marks, undefined, { self: 'player', selected: new Set(['mine-a']) });
    expect(colors.slice(1)).toEqual([ownerInk('enemy', snapshot), ownerInk('player', snapshot), '#ffffff']);
  });
});
