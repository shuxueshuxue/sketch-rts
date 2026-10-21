import { boardingBerthCandidateAt } from '../../shared/naval';
import type { GameMap, Unit } from '../../shared/types';

export type GoalBoardingCandidate = { x: number; y: number; score: number; index: number };
export type GoalBoardingCandidateCursor = { ring: number; offset: number; best: GoalBoardingCandidate | null };
export const beginGoalBoardingCandidate = (): GoalBoardingCandidateCursor => ({ ring: 0, offset: 0, best: null });

/** Native candidate order, proved from nearby cells without enumerating or
 * sorting a full map. Outside a completed square the native score is at least
 * twice the distance to its next row/column. A strict bound preserves native
 * row-order ties, including when looking after a rejected candidate. */
export function advanceGoalBoardingCandidate(map: GameMap, passenger: Unit, ship: Unit,
  cursor: GoalBoardingCandidateCursor, allowance: number, after: GoalBoardingCandidate | null = null) {
  let work = 0;
  const terrain = map.terrain;
  if (!terrain) return { cursor, work, done: true, value: null };
  const col = Math.max(0, Math.min(terrain.cols - 1, Math.floor(ship.x / terrain.cell)));
  const row = Math.max(0, Math.min(terrain.rows - 1, Math.floor(ship.y / terrain.cell)));
  const last = Math.max(col, row, terrain.cols - 1 - col, terrain.rows - 1 - row);
  while (work < allowance) {
    const r = cursor.ring, count = r ? r * 8 : 1;
    if (cursor.offset >= count) {
      const distances: number[] = [];
      if (col - r > 0) distances.push(Math.abs(ship.x - (col - r - .5) * terrain.cell));
      if (col + r < terrain.cols - 1) distances.push(Math.abs(ship.x - (col + r + 1.5) * terrain.cell));
      if (row - r > 0) distances.push(Math.abs(ship.y - (row - r - .5) * terrain.cell));
      if (row + r < terrain.rows - 1) distances.push(Math.abs(ship.y - (row + r + 1.5) * terrain.cell));
      if (r >= last || cursor.best && cursor.best.score < 2 * Math.min(...distances))
        return { cursor, work, done: true, value: cursor.best };
      cursor.ring++; cursor.offset = 0; continue;
    }
    const offset = cursor.offset++, side = r ? Math.floor(offset / (2 * r)) : 0, at = r ? offset % (2 * r) : 0;
    const x = col + (r === 0 ? 0 : side === 0 ? -r + at : side === 1 ? r : side === 2 ? r - at : -r);
    const y = row + (r === 0 ? 0 : side === 0 ? -r : side === 1 ? -r + at : side === 2 ? r : r - at);
    // Even clipped cells consume their finite enumeration step. No native
    // placement check or search takes place outside this measured advance.
    work++;
    if (x < 0 || y < 0 || x >= terrain.cols || y >= terrain.rows) continue;
    const index = y * terrain.cols + x, value = boardingBerthCandidateAt(map, passenger, ship, index);
    if (!value || after && (value.score < after.score || value.score === after.score && index <= after.index)) continue;
    if (!cursor.best || value.score < cursor.best.score || value.score === cursor.best.score && index < cursor.best.index)
      cursor.best = { ...value, index };
  }
  return { cursor, work, done: false, value: null };
}
