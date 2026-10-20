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
