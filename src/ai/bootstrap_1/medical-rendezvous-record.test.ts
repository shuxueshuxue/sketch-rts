import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameCommand } from '../../shared/types';
import { rememberPatientRendezvous } from './medical-rendezvous';
import { bootstrapPolicyContext } from './policy';

function context() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/medical-expedition-405.json.gz', import.meta.url))).toString());
  const options = bootstrapPolicyContext(saved.snapshot, 'us', 'v9_archer', { memory: saved.memory, teams: saved.snapshot.teams });
  const patient = saved.snapshot.units.find((unit: { id: string }) => unit.id === 'front');
  const healer = saved.snapshot.units.find((unit: { id: string }) => unit.id === 'healer');
  const retreat: GameCommand = { type: 'follow', unitIds: [patient.id], targetId: healer.id };
  return { options, pair: { patient, healer }, retreat };
}

it('does not record a conceptual patient assignment without a published rendezvous', () => {
  const { options, pair } = context();
  rememberPatientRendezvous(options, [pair], [], []);
  expect(options.memory.naval?.medicalRendezvous).toBeUndefined();
});

it('does not record a rendezvous displaced by a later boarding command', () => {
  const { options, pair, retreat } = context();
  const board: GameCommand = { type: 'board', unitIds: [pair.patient.id], transportId: 'existing-ferry' };
  rememberPatientRendezvous(options, [pair], [retreat], [retreat, board]);
  expect(options.memory.naval?.medicalRendezvous).toBeUndefined();
});

it('does not record a proposed rendezvous absent from the final published commands', () => {
  const { options, pair, retreat } = context();
  rememberPatientRendezvous(options, [pair], [retreat], []);
  expect(options.memory.naval?.medicalRendezvous).toBeUndefined();
});

it('records the final actual patient and healer pairing', () => {
  const { options, pair, retreat } = context();
  rememberPatientRendezvous(options, [pair], [retreat], [retreat]);
  expect(options.memory.naval?.medicalRendezvous).toEqual({ front: { healerId: 'healer', order: { type: 'follow', targetId: 'healer' } } });
});
