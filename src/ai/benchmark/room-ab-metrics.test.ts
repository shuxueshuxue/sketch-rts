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
  it('keeps original camp membership after a casualty and never counts a camp cleared by another owner', () => {
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
