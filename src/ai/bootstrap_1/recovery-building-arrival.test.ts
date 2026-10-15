import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { bootstrapPolicyContext } from './policy';
import { medicalRecovery } from './medical-recovery';
import { mobileCare } from './mobile-care';

// Real rules2 ordinary0: Ember v9_summoner side1 vs frozen v8 Grove+Ember,
// greystonePass-generated ladder, seed resume-20261015-knight-expansion-b.
// 183 native replay7905: the escape goal is inside our unfinished tower's physical body.
// This is a local native regression, not a replacement for the full three-policy match.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/recovery-building-arrival-7905.json', import.meta.url), 'utf8')) as {
  snapshot: GameSnapshot; nextId: number; memories: Record<string, AiPolicyMemory>;
};
const patientId = 'unit-p0-emberRavager-1079';
const oldGoal = { x: 2956.3323572393538, y: 3519.0225181428536 };
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function restore() {
  const game = createGame('bareDuel', { players: ['p0', 'p1', 'p2'], teams: fixture.snapshot.teams!, aiPlayers: [] });
  restoreSnapshotIntoGame(game, structuredClone(fixture.snapshot), fixture.nextId);
  expect(JSON.parse(JSON.stringify(snapshotGame(game)))).toEqual(fixture.snapshot);
  return game;
}

it('records native early arrival at the unsafe7905 goal before the requested point is reached', () => {
  const game = restore(), patient = game.units.find(unit => unit.id === patientId)!;
  const tower = game.buildings.find(building => building.id === 'building-p0-defenseTower-2014')!;
  expect(gap(oldGoal, tower)).toBeLessThan(tower.radius + patient.radius);
  issuePlayerCommand(game, 'p0', { type: 'move', unitIds: [patientId], ...oldGoal, avoidCombat: true });
  for (let tick = 0; tick < 15 && patient.order.type === 'move'; tick++) stepGame(game);
  expect(patient.arrivedAt).toEqual(oldGoal);
  expect(gap(patient, oldGoal)).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);
});

it('keeps production recovery moving through the tower approach until the next think', () => {
  const game = restore(), memory = structuredClone(fixture.memories.p0!);
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', { memory, teams: game.teams });
  const entries = runAiCommandEntriesFromScripts(snapshot, 'p0', [mobileCare, medicalRecovery], options);
  const care = entries.find(entry => entry.scriptId === 'mobileCare' && 'unitIds' in entry.command && entry.command.unitIds.includes(patientId));
  expect(care?.command.type).toBe('move');
  issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'p0' })));
  for (let tick = 0; tick < 15; tick++) {
    stepGame(game);
    const patient = game.units.find(unit => unit.id === patientId);
    expect(patient, `patient died before next think at tick${game.tick}`).toBeDefined();
    expect(patient!.order.type, `recovery rejoined combat at tick${game.tick}`).not.toBe('attack');
  }
});
