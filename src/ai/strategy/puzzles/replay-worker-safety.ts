import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, gzipSync, gunzipSync } from 'node:zlib';
import { createSdkCommandFrameRuntime } from '../../../sdk/commands/frame';
import { runGameLoop } from '../../../sdk/game-runner';
import type { AppliedPuzzleCommand } from './execution-ownership';
import type { PuzzleExecutionObservation } from './planner-binding';
import { PUBLIC_PUZZLES } from './scenes';
import { observePuzzleWorkerSafety, readAcceptedHallSafety } from './worker-safety';

/** Reapply only the original native SDK stream. No AI, planner, fact reader,
 * grant or new command is generated. Snapshot equality is a prerequisite to
 * interpreting the added per-tick native safety observations. */
export async function replayWorkerSafety(runtimePath: string, sdkPath: string, resultPath: string, output: string) {
  const original = JSON.parse(gunzipSync(readFileSync(resultPath)).toString());
  assert.equal(original.statistics.observedThinks, 560);
  const puzzle = PUBLIC_PUZZLES.find(p => `${p.key}/${p.variant}` === original.puzzle)!;
  assert.equal(puzzle.key, 'ship-away');
  const expected: { tick: number; bytes: string }[] = [], builds: ReturnType<typeof readAcceptedHallSafety> = [];
  const stream = createInterface({ input: createReadStream(runtimePath).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of stream) {
    const row = JSON.parse(line);
    expected.push({ tick: row.snapshot.tick, bytes: JSON.stringify(row.snapshot) });
    builds.push(...readAcceptedHallSafety(row.snapshot, row.observation as PuzzleExecutionObservation, row.memoryAfter.strategyAllocation));
  }
  assert.equal(expected.length, 560);
  const events: AppliedPuzzleCommand[] = gunzipSync(readFileSync(sdkPath)).toString().trim().split('\n').filter(Boolean).map(s => JSON.parse(s));
  assert.deepEqual(events, original.stepOwnership.nativeApplications);
  const due = new Map<number, AppliedPuzzleCommand[]>();
  for (const event of events) due.set(event.tick, [...due.get(event.tick) ?? [], event]);
  const world = puzzle.create(), observer = observePuzzleWorkerSafety(world.game, world.owner);
  const runtime = createSdkCommandFrameRuntime(world.game);
  const ticks: ReturnType<typeof observer.sample>[] = [], checks: { tick: number; sha256: string }[] = [];
  let cursor = 0, applied = 0;
  assert.equal(JSON.stringify(original.result.initial), JSON.stringify((await import('../../../shared/sim')).snapshotGame(world.game)));
  try {
    const replay = runGameLoop({ name: 'recorded-public-puzzle-worker-safety', game: world.game,
      maxTicks: original.result.final.tick, thinkInterval: 15,
      agents: { [world.owner]: { controller: 'internal-ai', team: world.owner, race: 'grove' },
        [world.opponent]: { controller: 'external-agent', team: world.opponent, race: 'ember' } },
      commandPlanner(context) {
        if (context.owner !== world.owner) return [];
        const frame = expected[cursor++]!;
        assert.equal(context.snapshot.tick, frame.tick);
        const bytes = JSON.stringify(context.snapshot);
        assert.equal(bytes, frame.bytes, `Original snapshot mismatch at tick ${frame.tick}`);
        checks.push({ tick: frame.tick, sha256: createHash('sha256').update(bytes).digest('hex') });
        return [];
      },
    }, {
      beforeStep({ game }) {
        const recorded = due.get(game.tick) ?? [];
        if (recorded.length) {
          const result = runtime.issue(recorded.map(e => ({ playerId: e.owner, source: 'internal-ai', scriptId: e.scriptId, command: e.command })), {}, { checksum: false });
          assert.deepEqual(result.commands.map(c => ({ tick: game.tick, owner: c.playerId, scriptId: c.scriptId, command: c.command })), recorded);
          applied += result.commands.length;
        }
        ticks.push(observer.sample());
      },
      onStep() { ticks.push(observer.sample()); },
    });
    assert.equal(cursor, expected.length);
    assert.equal(applied, events.length);
    assert.equal(JSON.stringify(replay.snapshot), JSON.stringify(original.result.final), 'Original final snapshot mismatch');
  } finally { observer.dispose(); }
  const safety = observer.finish();
  const appliedBuilds = events.filter(e => e.scriptId === 'goal.build' && e.command.type === 'build' && e.command.buildingKind === 'townHall');
  const buildingSafety = appliedBuilds.map(event => ({ event, proof: builds.find(b => b.tick <= event.tick
    && JSON.stringify(b.command) === JSON.stringify(event.command)) }));
  const result = { puzzle: original.puzzle, criterion: 'native-worker-safety-2026-10-21T23:39Z',
    originalCriterion: original.result.execution, originalError: original.error,
    snapshotChecks: checks, originalFinalSnapshotEqual: true, originalSdkEventsReapplied: applied,
    noAiPlanning: true, noFactReader: true, safety, buildingSafety,
    workerSafetyPassed: safety.passed && buildingSafety.every(b => b.proof?.passed),
    revisedExecutionPassed: original.result.execution.checks.islandHallComplete && original.result.execution.checks.campCleared
      && original.result.execution.checks.armyTransported && safety.passed
      && buildingSafety.length > 0 && buildingSafety.every(b => b.proof?.passed) && original.stepOwnership.passed,
    limitation: 'Same recorded trajectory, no additional AI game. Snapshot mismatches throw before a new verdict is written. Current hold and full future protection are separate.' };
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'per-tick.jsonl.gz'), gzipSync(ticks.map(t => JSON.stringify(t)).join('\n') + '\n'));
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runtime, sdk, result, output] = process.argv.slice(2);
  if (!runtime || !sdk || !result || !output) throw Error('Expected original runtime, original SDK, original result and output paths');
  await replayWorkerSafety(runtime, sdk, result, output);
}
