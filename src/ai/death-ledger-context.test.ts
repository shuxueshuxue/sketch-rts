import { describe, expect, it } from 'vitest';
import { createGame, snapshotGame } from '../shared/sim';
import type { GameSnapshot, Unit } from '../shared/types';
import { classifyAiDeath } from './death-ledger-classification';
import { deathTaskIndex, inferDeathAssignment } from './death-ledger-context';
import { assignmentClearsCamp, inferAiDeathEngagement } from './death-ledger-engagement';
import type { AiUnitDeathRecord } from './death-ledger-types';
import { createAiPolicyMemory } from './memory';
import samples from './fixtures/death-clearing-context.json';

/** Extracted verbatim memory/units/records from the hash-verified 11-map replay.
 * sourceFrame locates the complete snapshot in the immutable evidence packet.
 */
describe('real clearing membership attribution', () => {
  it('covers the 23 missed same-camp deaths and one different-camp counterexample', () => {
    expect(samples.filter(sample => sample.sameCamp)).toHaveLength(23);
    expect(samples.filter(sample => !sample.sameCamp)).toHaveLength(1);
  });
  it('retains general creeping and resolves its recorded target without a parallel task', () => {
    const sample = samples.find(sample => sample.sameCamp)!;
    const snapshot = { ...snapshotGame(createGame('bareDuel', { aiPlayers: [] })), tick: sample.tick,
      units: sample.neutrals, buildings: [] } as unknown as GameSnapshot;
    const unit = structuredClone(sample.record.unit) as unknown as Unit, memory = createAiPolicyMemory();
    const target = sample.neutrals.find(other => other.id === sample.record.killer!.id)!;
    memory.v6 = { general: { mode: 'creep', target: { x: target.homeX!, y: target.homeY! }, group: [unit.id] } };
    const assignment = inferDeathAssignment(snapshot, unit, memory, deathTaskIndex(snapshot, unit.owner, memory), null);
    expect(assignment.task).toMatchObject({ id: 'general:creep', clearing: true, source: 'v6.general' });
    expect(assignment.task!.clearingTargetIds).toContain(target.id);
  });
  for (const target of [undefined, { x: -9999, y: -9999 }]) it(`omits unresolved general camp IDs (${target ? 'unknown target' : 'no target'})`, () => {
    const sample = samples.find(sample => sample.sameCamp)!;
    const snapshot = { ...snapshotGame(createGame('bareDuel', { aiPlayers: [] })), tick: sample.tick,
      units: sample.neutrals, buildings: [] } as unknown as GameSnapshot;
    const unit = structuredClone(sample.record.unit) as unknown as Unit, memory = createAiPolicyMemory();
    memory.v6 = { general: { mode: 'creep', group: [unit.id], ...(target ? { target } : {}) } };
    const assignment = inferDeathAssignment(snapshot, unit, memory, deathTaskIndex(snapshot, unit.owner, memory), null);
    expect(assignment.task).toMatchObject({ id: 'general:creep', clearing: true, source: 'v6.general' });
    expect(assignment.task).not.toHaveProperty('clearingTargetIds');
    expect(assignmentClearsCamp(assignment, sample.record.killer!.id)).toBe(true);
    expect(JSON.parse(JSON.stringify(assignment.task))).not.toHaveProperty('clearingTargetIds');
  });
  for (const sample of samples) it(`${sample.map} ${sample.tick} ${sample.record.unit.id}`, () => {
    const record = structuredClone(sample.record) as unknown as AiUnitDeathRecord;
    const memory = Object.assign(createAiPolicyMemory(), structuredClone(sample.memory));
    const snapshot = { ...snapshotGame(createGame('bareDuel', { aiPlayers: [] })), tick: record.tick,
      units: [...sample.neutrals, record.unit], buildings: [] } as unknown as GameSnapshot;
    const originalMemory = structuredClone(memory), originalSnapshot = structuredClone(snapshot);
    record.assignment = inferDeathAssignment(snapshot, record.unit as unknown as Unit, memory,
      deathTaskIndex(snapshot, record.owner, memory), record.lastIssuedOrder);
    const candidates = [record.assignment.task, ...record.assignment.otherTaskCandidates];
    expect(candidates.some(task => task?.clearing)).toBe(true);
    expect(assignmentClearsCamp(record.assignment, record.killer!.id)).toBe(sample.sameCamp);
    const identities = new Map(snapshot.units.map(unit => [unit.id, { ...unit, entityType: 'unit' as const }]));
    const engagement = inferAiDeathEngagement(record, { identities, teams: {}, dealtDamage: null, provenance: 'reclassified-native-records' });
    const classification = classifyAiDeath(record, engagement, sample.record.classification.v1 as AiUnitDeathRecord['classification']['v1']);
    if (sample.sameCamp) {
      expect(engagement.status).toBe('engaged');
      expect(classification.disposition).toMatch(/normal|suspicious/);
    } else {
      expect(classification).toMatchObject({ disposition: 'abnormal', primary: 'neutral-outside-clearing' });
    }
    expect(classification.v1).toEqual(sample.record.classification.v1);
    expect(memory).toEqual(originalMemory); expect(snapshot).toEqual(originalSnapshot);
    const explicit = candidates.find(task => task?.source === 'landExpansion.combat.creep');
    if (explicit) {
      expect(explicit.id).toBe(`expansion:${memory.landExpansion!.mineId}`);
      expect(explicit.stage).toBe(memory.landExpansion!.combat!.creep!.stage);
    }
  });
});
