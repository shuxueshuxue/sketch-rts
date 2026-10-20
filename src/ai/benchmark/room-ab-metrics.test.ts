import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGame, snapshotGame } from '../../shared/sim';
import { createUnit } from '../../shared/map';
import { createAiPolicyMemory } from '../memory';
import { projectDeathThinkContext } from '../death-ledger-context';
import { projectRoomBaseline646cContext } from './room-baseline-646c-context';
import { RoomAbMetrics } from './room-ab-metrics';
import type { AiDeathTask } from '../death-ledger-types';

const task = (id: string): AiDeathTask => ({ id, kind: 'attack', targetId: 'target', stage: 'strike', source: 'test',
  attribution: 'inferred', methodId: null, utility: null, combat: true, clearing: false, perimeter: null });
describe('read-only room A/B measurements', () => {
  it('decodes retained baseline facts without runtime imports of live policy modules', () => {
    const game = createGame('greystonePass'), snapshot = snapshotGame(game), memory = createAiPolicyMemory();
    memory.v6 = { general: { mode: 'attack', group: game.units.filter(u => u.owner === 'player').map(u => u.id), stage: 'strike', targetHallId: 'hall' } };
    expect(projectRoomBaseline646cContext(snapshot, 'player', memory)).toEqual(projectDeathThinkContext(snapshot, 'player', memory));
    const source = readFileSync(new URL('./room-baseline-646c-context.ts', import.meta.url), 'utf8');
    expect(source.match(/^import(?! type).*$/gm)).toEqual(null);
    expect(source).not.toMatch(/from ['"].*\/policy\//);
  });
  it('counts A-B-A switches and closes the final idle interval without changing the world', () => {
    const game = createGame('greystonePass');
    const soldier = game.units.find(u => u.owner === 'player')!;
    // Use a real combat entity, independent of the starting worker roster.
    const fighter = createUnit('fighter', 'player', 'footman', soldier.x, soldier.y);
    game.units = [fighter];
    const before = JSON.stringify(snapshotGame(game));
    const observer = new RoomAbMetrics(game, ['player']);
    for (const id of ['A', 'B', 'A']) {
      const facts = projectDeathThinkContext(snapshotGame(game), 'player', createAiPolicyMemory());
      facts.tasks = [[fighter.id, [task(id)]]]; observer.recordThink(facts);
    }
    const facts = projectDeathThinkContext(snapshotGame(game), 'player', createAiPolicyMemory());
    observer.recordThink(facts); observer.step();
    const report = observer.finish();
    expect(report.seats.player!.abaSwitches).toBe(1);
    expect(report.seats.player!.idleArmyUnitSeconds).toBe(.05);
    expect(report.seats.player!.preemptions).toBeNull();
    expect(JSON.stringify(snapshotGame(game))).toBe(before);
  });
  it('keeps original camp membership after casualties and counts one completion', () => {
    const game = createGame('greystonePass');
    const a = createUnit('camp-a', 'neutral', 'footman', 500, 500), b = createUnit('camp-b', 'neutral', 'footman', 520, 500);
    const soldier = createUnit('fighter', 'player', 'footman', 480, 500);
    game.units = [a, b, soldier];
    const observer = new RoomAbMetrics(game, ['player']);
    const observe = (ids: string[]) => {
      const facts = projectDeathThinkContext(snapshotGame(game), 'player', createAiPolicyMemory());
      facts.tasks = [[soldier.id, [{ ...task('island'), kind: 'island', clearing: true, clearingTargetIds: ids }]]];
      observer.recordThink(facts);
    };
    observe([a.id, b.id]);
    soldier.order = { type: 'attack', targetId: a.id }; game.tick = 1; observer.step();
    a.hp = 0; observe([b.id]); soldier.order = { type: 'attack', targetId: b.id }; game.tick = 2; observer.step();
    b.hp = 0; game.tick = 3; observer.step();
    const report = observer.finish();
    expect(report.clearings).toHaveLength(1);
    expect(report.seats.player!.completed.islandClears).toBe(1);
    expect(report.seats.player!.firstIslandClearStart).toBe(1);
    expect(report.seats.player!.firstIslandClearComplete).toBe(3);
  });
});

it('excludes road-camp clearing from island achievements without altering raw observations', async () => {
  const { canonicalRoomAbClearings } = await import('./room-ab-clearings');
  const game = createGame('bareDuel');
  const guard = createUnit('guard', 'neutral', 'footman', 100, 0);
  const road = createUnit('road', 'neutral', 'footman', 1000, 0);
  game.units = [guard, road];
  game.resources = [{ id: 'mine', kind: 'goldMine', x: 0, y: 0, amount: 1000, startAmount: 1000 }];
  const raw = new RoomAbMetrics(game, ['player']).finish();
  const clearing = (id: string, member: string, start: number, complete: number) => ({ owner: 'player', id, mineId: 'mine',
    memberIds: [member], unitIds: [], start, complete, otherActors: [] });
  raw.clearings = [clearing('road-task', road.id, 10, 20), clearing('guard-task', guard.id, 30, 40)];
  raw.seats.player!.completed.islandClears = 2;
  const before = JSON.stringify(raw), result = canonicalRoomAbClearings(raw, game);
  expect(JSON.stringify(raw)).toBe(before);
  expect(result.seats.player).toMatchObject({ firstIslandClearStart: 30, firstIslandClearComplete: 40,
    completed: { islandClears: 1 }, completedBy15m: { islandClears: 1 } });
  expect(result.clearingAssociations.map(c => c.association)).toEqual(['road-camp', 'mine-guard']);
  expect(canonicalRoomAbClearings(result, game)).toEqual(result);
});

it('refuses unresolved camp membership instead of inventing island metrics', async () => {
  const { canonicalRoomAbClearings } = await import('./room-ab-clearings');
  const game = createGame('bareDuel'), raw = new RoomAbMetrics(game, ['player']).finish();
  raw.clearings = [{ owner: 'player', id: 'unknown', mineId: 'missing', memberIds: ['unknown'], unitIds: [],
    start: null, complete: null, otherActors: [] }];
  expect(() => canonicalRoomAbClearings(raw, game)).toThrow('Cannot resolve clearing membership/mine: unknown');
});
