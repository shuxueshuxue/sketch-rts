import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import type { CommandAdmission } from './allocation-types';
import { allocationGrants } from './allocation-lifecycle';
import { admitStrategyCommands } from './command-gateway';
import { isLifeSavingScript } from './script-safety';
import { recordScriptSafetyInterruptions } from './script-safety';
import { buildStrategyDecision } from './decision';
import { assertStrategyAllocationBounds } from './control';

type Frame = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory; version: BootstrapAiVersion;
  commandAdmissions: readonly CommandAdmission[] };
it.each(['gull-control-p1-2977', 'sapphire-control-p1-2327'])
  ('preserves the old native orders at %s with imported bookkeeping and no formal grant', name => {
    const frame: Frame = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
    const baseline = structuredClone(frame), before = JSON.stringify(frame.snapshot);
    delete baseline.memory.strategy; delete baseline.memory.strategyAllocation;
    const ordinary = planAiOwnerCommandEntries(baseline.snapshot, { playerId: baseline.owner, version: baseline.version,
      memory: baseline.memory }, { strategyControl: false });
    const controlled = planAiOwnerCommandEntries(frame.snapshot, { playerId: frame.owner, version: frame.version,
      memory: frame.memory }, { strategyControl: true });
    expect(Object.values(frame.memory.strategyAllocation!.leases).filter(lease => lease.origin === 'allocator')).toEqual([]);
    expect(controlled).toEqual(ordinary);
    // Also test the exact recorded native proposal, independently of whether
    // replanning this isolated frame proposes that same recovery order.
    for (const admission of frame.commandAdmissions.filter(admission => admission.status === 'rejected')) {
      const memory = frame.memory.strategyAllocation!;
      const result = admitStrategyCommands({ snapshot: frame.snapshot, owner: frame.owner, memory, grants: allocationGrants(memory),
        queuedTick: null, proposals: [{ ...admission, id: admission.commandId,
          purpose: isLifeSavingScript(admission.executor) ? 'life-saving' : 'task' }] });
      expect(result.accepted.map(value => value.command)).toEqual([admission.command]);
    }
    expect(JSON.stringify(frame.snapshot)).toBe(before);
  }, 60000);

it('keeps a formal takeover exclusive while accepting the original local rescue and recording its real vacancy', () => {
  const frame: Frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/gull-control-p1-2977.json.gz', import.meta.url))).toString());
  const authority = frame.memory.strategyAllocation!, raw = frame.commandAdmissions[0]!;
  const leases = Object.fromEntries(Object.entries(authority.leases).map(([key, lease]) => [key,
    { ...lease, origin: 'allocator' as const, incumbentTask: null }]));
  const memory = { ...authority, leases }, snapshot = frame.snapshot;
  const original = { ...raw, id: `${raw.commandId}:ordinary`, purpose: 'task' as const, executor: 'v6General' };
  const rescue = { ...raw, id: raw.commandId, purpose: 'life-saving' as const };
  const run = (proposals: readonly typeof original[]) => admitStrategyCommands({ snapshot, owner: frame.owner, memory,
    grants: allocationGrants(memory), queuedTick: null, proposals });
  expect(run([original]).accepted).toEqual([]);
  const result = admitStrategyCommands({ snapshot, owner: frame.owner, memory, grants: allocationGrants(memory),
    queuedTick: null, proposals: [original, rescue] });
  expect(result.accepted.map(proposal => proposal.command)).toEqual([raw.command]);
  const first = Object.values(memory.assignments)[0]!;
  const forged = admitStrategyCommands({ snapshot, owner: frame.owner, memory, grants: allocationGrants(memory), queuedTick: null,
    proposals: [{ ...rescue, source: 'executor', action: first.action, allocationRevision: memory.revision }] });
  expect(forged.accepted).toEqual([]);
  const situation = buildStrategyDecision(snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity).situation;
  const interrupted = recordScriptSafetyInterruptions(memory, snapshot, situation, result.admissions);
  if (!('unitIds' in raw.command)) throw new Error('Expected the exact recorded retreat cohort');
  for (const unitId of raw.command.unitIds) {
    const assignment = interrupted.assignments[`assignment:${unitId}`]!;
    expect(assignment.interruption?.executor).toBe('skirmishPreservation');
    expect(interrupted.vacancies[assignment.interruption!.vacancyId]?.assignmentId).toBe(assignment.id);
    expect(interrupted.leases[`unit:${unitId}`]).toEqual(memory.leases[`unit:${unitId}`]);
  }
  expect(interrupted.events.filter(event => event.kind === 'interrupted')).toHaveLength(raw.command.unitIds.length);
  expect(assertStrategyAllocationBounds(interrupted)).toBeGreaterThan(0);
  expect(recordScriptSafetyInterruptions(interrupted, snapshot, situation, result.admissions)).toEqual(interrupted);
});
