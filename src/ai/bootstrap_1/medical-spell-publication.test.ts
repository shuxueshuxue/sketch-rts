import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameCommand, GameSnapshot } from '../../shared/types';
import type { AiScript } from '../policy/types';
import { medicalRecovery, planMedicalRecovery, recoveryPatients } from './medical-recovery';
import { planBootstrapNaval } from './expedition-recovery';
import { bootstrapPolicyContext, planBootstrapScriptEntries } from './policy';

function actual(tick: number) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/medical-ready-heal-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot = saved.snapshot as GameSnapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  return { saved, snapshot };
}

it.each([30660, 30705])('publishes one original-target instantaneous heal from the actual%i opportunity', tick => {
  const { snapshot, saved } = actual(tick);
  const id = tick === 30660 ? 'unit-p0-fieldMedic-1602' : 'unit-p0-fieldMedic-1418';
  const targetId = tick === 30660 ? 'unit-p0-priest-15352' : 'unit-p0-fieldMedic-1602';
  const spell = planMedicalRecovery(snapshot, 'p0', recoveryPatients(snapshot, 'p0')).find(command => command.type === 'cast' && command.unitId === id)!;
  expect(spell).toEqual({ type: 'cast', unitId: id, ability: 'heal', targetId });
  const context = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory: saved.memories.p0, teams: snapshot.teams! });
  // Isolate the publication contract with the real selected spell. A naval
  // spell-only branch has no physical order to suppress the second attempt.
  // This is not a claim that naval owned either historical mainland medic.
  const first: AiScript = { id: 'naval', phase: 'tactics', run: () => [spell] };
  const entries = planBootstrapScriptEntries(snapshot, 'p0', [first, medicalRecovery], context);
  expect(entries.filter(entry => entry.command.type === 'cast' && entry.command.unitId === id)).toEqual([
    { scriptId: 'naval', command: spell },
  ]);
});

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s publishes only its naval instantaneous island heal before global medical', version => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-landed-before-think-100650.json.gz', import.meta.url))).toString());
  const snapshot = saved.snapshot as GameSnapshot;
  const healer = snapshot.units.find(unit => unit.id === 'unit-p0-priest-7778')!;
  const patient = snapshot.units.find(unit => unit.id === 'unit-p0-archer-2411')!;
  // Explicit positive counterfactual on the complete actual island/map: a
  // ready medic, critical nearby patient and no hostile fire. No simulation.
  patient.hp = 20; healer.abilityCooldowns = {}; healer.order = { type: 'idle' };
  snapshot.units = snapshot.units.filter(unit => unit.owner === 'p0');
  snapshot.buildings = snapshot.buildings.filter(building => building.owner === 'p0');
  snapshot.effects = []; snapshot.projectiles = [];
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const context = bootstrapPolicyContext(snapshot, 'p0', version, { memory: saved.memories.p0, teams: snapshot.teams! });
  const first: AiScript = { id: 'naval', phase: 'tactics', run: (frame, owner, options) =>
    planBootstrapNaval(frame, owner, options).filter(command => command.type === 'cast' && command.unitId === healer.id) };
  const expected: GameCommand = { type: 'cast', unitId: healer.id, ability: 'heal', targetId: patient.id };
  expect(first.run(snapshot, 'p0', context)).toEqual([expected]);
  expect(medicalRecovery.run(snapshot, 'p0', context)).toContainEqual(expected);
  const entries = planBootstrapScriptEntries(snapshot, 'p0', [first, medicalRecovery], context);
  expect(entries.filter(entry => entry.command.type === 'cast' && entry.command.unitId === healer.id)).toEqual([
    { scriptId: 'naval', command: expected },
  ]);
});

function publication(commands: GameCommand[], prepare?: (snapshot: GameSnapshot) => void) {
  const { snapshot, saved } = actual(30660);
  prepare?.(snapshot);
  const context = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory: saved.memories.p0, teams: snapshot.teams! });
  return planBootstrapScriptEntries(snapshot, 'p0', [{ id: 'medicalRecovery', phase: 'tactics', run: () => commands }], context);
}

it('retains queued healing rather than treating it as an instantaneous spell', () => {
  const command: GameCommand = { type: 'cast', unitId: 'unit-p0-fieldMedic-1602', ability: 'heal', targetId: 'unit-p0-priest-15352', queued: true };
  expect(publication([command, command]).map(entry => entry.command)).toEqual([command, command]);
});

it('retains walk-to-heal commands outside native range', () => {
  const { snapshot } = actual(30660), healer = snapshot.units.find(unit => unit.id === 'unit-p0-fieldMedic-1602')!;
  const target = snapshot.units.find(unit => unit.owner === 'p0' && Math.hypot(unit.x - healer.x, unit.y - healer.y) > 500)!;
  const command: GameCommand = { type: 'cast', unitId: healer.id, ability: 'heal', targetId: target.id };
  expect(publication([command, command]).map(entry => entry.command)).toEqual([command, command]);
});

it('retains another ability and item use from the same caster', () => {
  const heal: GameCommand = { type: 'cast', unitId: 'unit-p0-fieldMedic-1602', ability: 'heal', targetId: 'unit-p0-priest-15352' };
  const wave: GameCommand = { type: 'cast', unitId: heal.unitId, ability: 'veteranHealingWave' };
  const item: GameCommand = { type: 'useItem', unitId: heal.unitId, itemId: 'publication-boundary-item' };
  // Publication does not validate a learned skill or inventory; the normal
  // SDK owns that. Distinct commands must reach that native legality check.
  expect(publication([heal, wave, item], snapshot => {
    snapshot.units.find(unit => unit.id === heal.unitId)!.veteranSkill = 'veteranHealingWave';
  }).map(entry => entry.command)).toEqual([heal, wave, item]);
});

it('retains a second caster heal while keeping the first target for one caster', () => {
  const first: GameCommand = { type: 'cast', unitId: 'unit-p0-fieldMedic-1602', ability: 'heal', targetId: 'unit-p0-priest-15352' };
  const retarget: GameCommand = { ...first, targetId: first.unitId };
  const other: GameCommand = { ...first, unitId: 'second-ready-medic' };
  expect(publication([first, retarget, other], snapshot => {
    const healer = snapshot.units.find(unit => unit.id === first.unitId)!;
    snapshot.units.push({ ...structuredClone(healer), id: other.unitId });
  }).map(entry => entry.command)).toEqual([first, other]);
});

it('does not let an instantaneous heal erase a later queued or distant order', () => {
  const { snapshot } = actual(30660), healer = snapshot.units.find(unit => unit.id === 'unit-p0-fieldMedic-1602')!;
  const target = snapshot.units.find(unit => unit.owner === 'p0' && Math.hypot(unit.x - healer.x, unit.y - healer.y) > 500)!;
  const instant: GameCommand = { type: 'cast', unitId: healer.id, ability: 'heal', targetId: 'unit-p0-priest-15352' };
  const queued: GameCommand = { ...instant, queued: true };
  const distant: GameCommand = { ...instant, targetId: target.id };
  expect(publication([instant, queued, distant]).map(entry => entry.command)).toEqual([instant, queued, distant]);
});
