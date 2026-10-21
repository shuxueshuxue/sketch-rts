import { describe, expect, it } from 'vitest';
import { snapshotGame, stepGame } from '../../../shared/sim';
import { observePuzzleWorkerSafety } from './worker-safety';
import { camp, puzzleBuilder, soldiers, terrainWorld, PUZZLE_OWNER } from './world';

function scene(workerX: number, fighter = false) {
  const b = puzzleBuilder(0);
  soldiers(b, 'worker', 1, { x: workerX, y: 800 });
  if (fighter) soldiers(b, 'footman', 1, { x: 880, y: 800 });
  camp(b, ['murlocPeon'], { x: 800, y: 800 });
  return terrainWorld(b, [{ left: 128, top: 128, right: 1792, bottom: 1536 }], 2048, 1792);
}

describe('public puzzle worker safety uses native transitions', () => {
  it('allows an unharmed worker outside an idle camp alert even inside its unused leash', () => {
    const game = scene(1200), observer = observePuzzleWorkerSafety(game, PUZZLE_OWNER);
    for (let i = 0; i < 40; i++) { observer.sample(); stepGame(game); }
    observer.sample(); observer.dispose();
    expect(observer.finish()).toMatchObject({ passed: true, exposedSamples: 0, campDamage: [], workerDeaths: [] });
  });
  it('rejects an actual reachable idle alert entry before the first attack deals damage', () => {
    const game = scene(920), observer = observePuzzleWorkerSafety(game, PUZZLE_OWNER);
    const before = JSON.stringify(snapshotGame(game));
    observer.sample(); observer.dispose();
    expect(JSON.stringify(snapshotGame(game))).toBe(before);
    expect(observer.finish()).toMatchObject({ passed: false, exposedSamples: 1, campDamage: [], workerDeaths: [] });
    expect(observer.finish().firstExposures[0]?.mode).toBe('idle-alert');
  });
  it('keeps the active pursuit envelope after native combat wakes the camp', () => {
    const game = scene(1200, true), observer = observePuzzleWorkerSafety(game, PUZZLE_OWNER);
    observer.sample();
    expect(observer.finish().passed).toBe(true);
    stepGame(game); observer.sample(); observer.dispose();
    expect(game.units.find(u => u.owner === 'neutral')?.order.type).toBe('attack');
    expect(observer.finish().firstExposures.some(x => x.mode === 'active-pursuit')).toBe(true);
  });
  it('records positive camp damage and worker death from real native attacks', () => {
    const game = scene(850), observer = observePuzzleWorkerSafety(game, PUZZLE_OWNER);
    const worker = game.units.find(u => u.kind === 'worker')!;
    for (let i = 0; i < 400; i++) { observer.sample(); stepGame(game); }
    observer.sample(); observer.dispose();
    const result = observer.finish();
    expect(result.passed).toBe(false);
    expect(result.campDamage.some(d => d.damage > 0 && d.target.id === worker.id)).toBe(true);
    expect(result.workerDeaths.some(d => d.unit.id === worker.id && d.reason === 'death')).toBe(true);
  });
});
