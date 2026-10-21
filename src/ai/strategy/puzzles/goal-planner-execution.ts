import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../../planner-context';
import { withNavigationAudit } from '../../../shared/navigation-audit';
import { snapshotGame } from '../../../shared/sim';
import type { PuzzleExecutionObservation, PuzzlePlannerExecution } from './planner-binding';

/** The ordinary owner entry selects goals, plans, allocates and executes in
 * its native scope. The adapter supplies no goals, facts, rewards or grants. */
export function createExecution(options: { evidenceFile?: string } = {}): PuzzlePlannerExecution {
  const memoryProvider = createAiMemoryProvider();
  let first: PuzzleExecutionObservation | undefined, latest: PuzzleExecutionObservation | undefined;
  let plannedThinks = 0, observedThinks = 0, formalCommandCount = 0;
  let firstReadyTick: number | null = null, firstFormalCommandTick: number | null = null;
  if (options.evidenceFile) { mkdirSync(dirname(options.evidenceFile), { recursive: true }); writeFileSync(options.evidenceFile, ''); }
  return {
    commandPlanner({ game, snapshot, owner, agent, source, teams }) {
      const before = JSON.stringify(snapshot), worldBefore = JSON.stringify(snapshotGame(game));
      const retainedBefore = options.evidenceFile ? memoryProvider.get(owner) : undefined;
      const memoryBefore = options.evidenceFile ? JSON.stringify(retainedBefore ?? null) : undefined;
      plannedThinks++;
      let calls = 0;
      const entries = withNavigationAudit(event => {
        if (event.phase === 'strategy-planning' && !event.authorization) throw new Error(event.operation);
      }, () => planAiOwnerCommandEntries(snapshot, { playerId: owner, source,
        version: agent.policyVersion ?? agent.version }, {
        teams, memoryProvider, strategyControl: true, strategyObservation: 'trace',
        observeBootstrapPlan(context, commands, actual) {
          calls++;
          if (!actual?.goalPlanner || !actual.project) throw new Error('Native controlled owner trace is missing');
          const allocation = actual.project().allocation;
          if (!allocation) throw new Error('Native allocation trace is missing');
          const work = context.memory.strategy?.observation.factWork;
          if (!work || work.tick !== snapshot.tick || work.limit !== 6144 || !Number.isSafeInteger(work.used)
            || work.used < 0 || work.used > work.limit)
            throw new Error('Controlled owner think did not retain its ordinary work receipt');
          const output = actual.goalPlanner;
          if (output.readyActions.length && firstReadyTick === null) firstReadyTick = snapshot.tick;
          const formal = (allocation.commandAdmissions ?? []).filter(row => row.status === 'accepted'
            && row.source === 'executor' && row.executor.startsWith('goal.') && row.action !== null);
          for (const row of formal) {
            const execution = allocation.executions.find(item => item.token.actionId === row.action!.actionId
              && item.token.generation === row.action!.generation && item.executor === row.executor);
            if (!execution || execution.intent.kind !== 'goal-action'
              || !commands.some(command => command.scriptId === row.executor && JSON.stringify(command.command) === JSON.stringify(row.command)))
              throw new Error('Formal command lacks its actual goal execution or accepted owner entry');
          }
          formalCommandCount += formal.length;
          if (formal.length && firstFormalCommandTick === null) firstFormalCommandTick = snapshot.tick;
          const observation: PuzzleExecutionObservation = structuredClone({ tick: snapshot.tick, owner,
            output, allocation, commands });
          observedThinks++;
          latest = observation;
          if (!first && output.plans.length) first = observation;
          // Concatenated gzip members keep synchronous SDK loops bounded.
          // Each member is one real snapshot and its actual same-think trace.
          if (options.evidenceFile) appendFileSync(options.evidenceFile, gzipSync(`{"snapshot":${before},"memoryBeforeAvailable":${retainedBefore !== undefined},"memoryBefore":${memoryBefore},"memoryAfter":${JSON.stringify(context.memory)},"observation":${JSON.stringify(observation)},"work":${JSON.stringify(work)}}\n`));
        },
      }));
      if (calls !== 1) throw new Error('Expected one controlled owner observation per SDK think');
      // The SDK view owns sortable list copies. Its units, money and physical
      // world remain read-only until the SDK applies the returned commands.
      if (JSON.stringify(snapshotGame(game)) !== worldBefore) throw new Error('Controlled owner planning changed the real SDK world');
      return entries;
    },
    observations() { return first && latest && first !== latest ? [first, latest] : latest ? [latest] : []; },
    statistics() { return { plannedThinks, observedThinks, firstReadyTick, firstFormalCommandTick, formalCommandCount }; },
  };
}
