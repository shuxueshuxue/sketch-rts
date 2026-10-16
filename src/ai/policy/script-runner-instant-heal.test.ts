import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import type { AiScript } from './types';
import type { BootstrapAiVersion, GameCommand, GameSnapshot } from '../../shared/types';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { ABILITY_DEFS } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { matchesUnitTarget } from '../../shared/unit-targeting';
import { setBuildingBodies } from '../../shared/terrain';
import { coastalWithdrawalCrewCommands } from './coastal-boarding';
import { bootstrapPolicyContext, planBootstrapScriptEntries } from '../bootstrap_1/policy';
import { medicalRecovery, planMedicalRecovery, recoveryPatients } from '../bootstrap_1/medical-recovery';
import { runAiCommandEntriesFromScripts } from './script-runner';

const C = new URL('../../../', import.meta.url);
type Saved = { snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>; nextId: number };
function actual(tick: number) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`src/ai/bootstrap_1/fixtures/medical-ready-heal-${tick}.json.gz`, C))).toString()) as Saved;
  const { snapshot } = saved;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const casterId = tick === 30660 ? 'unit-p0-fieldMedic-1602' : 'unit-p0-fieldMedic-1418';
  const targetId = tick === 30660 ? 'unit-p0-priest-15352' : 'unit-p0-fieldMedic-1602';
  const caster = snapshot.units.find(unit => unit.id === casterId)!;
  const target = snapshot.units.find(unit => unit.id === targetId)!;
  const spell: GameCommand = { type: 'cast', unitId: casterId, ability: 'heal', targetId };
  return { saved, snapshot, caster, target, spell };
}

it.each([30660, 30705].flatMap(tick => (['v9_archer', 'v9_summoner', 'v9_knight'] as BootstrapAiVersion[]).map(version => ({ tick, version }))))(
  '$version preserves the actual $tick ready instant heal after an earlier physical hold', ({ tick, version }) => {
  const { saved, snapshot, caster, target, spell } = actual(tick), before = JSON.stringify(snapshot);
  // The heal's original unit identities, HP, pose, range and cooldown remain
  // exact. Only the preceding script publication is isolated. This does not
  // claim a coastal owner held this historical mainland medic in its match.
  expect(caster.owner).toBe('p0'); expect(caster.hp).toBeGreaterThan(0);
  expect(abilityCooldown(caster, 'heal')).toBe(0);
  expect(canReceiveHealing(target, snapshot)).toBe(true);
  expect(matchesUnitTarget(target, ABILITY_DEFS.heal.targets, snapshot)).toBe(true);
  expect(Math.hypot(caster.x-target.x, caster.y-target.y)).toBeLessThanOrEqual(ABILITY_DEFS.heal.range);
  expect(target.hp).toBeLessThan(target.maxHp);
  expect(planMedicalRecovery(snapshot, 'p0', recoveryPatients(snapshot, 'p0')).filter(command => command.type === 'cast' && command.unitId === caster.id)).toEqual([spell]);
  const context = bootstrapPolicyContext(snapshot, 'p0', version, { memory: structuredClone(saved.memories.p0!), teams: snapshot.teams! });
  const hold: GameCommand = { type: 'holdPosition', unitIds: [caster.id] };
  const first: AiScript = { id: 'naval', phase: 'tactics', run: () => hold };
  const entries = planBootstrapScriptEntries(snapshot, 'p0', [first, medicalRecovery], context);
  expect(entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(caster.id))).toEqual([{ scriptId: 'naval', command: hold }]);
  expect(entries.filter(entry => entry.command.type === 'cast' && entry.command.unitId === caster.id)).toEqual([{ scriptId: 'medicalRecovery', command: spell }]);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('includes the actual232740 idle armed deck priest in coastal hold without inventing a historical wound', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('src/ai/policy/fixtures/coastal-mortar-boarding-232740.json.gz', C))).toString()) as Saved;
  const { snapshot } = saved, before = JSON.stringify(snapshot);
  const caster = snapshot.units.find(unit => unit.id === 'unit-p0-priest-32497')!;
  const ship = snapshot.units.find(unit => unit.id === caster.deck!.shipId)!;
  expect(caster.order.type).toBe('idle'); expect(caster.attackDamage).toBeGreaterThan(0);
  expect(coastalWithdrawalCrewCommands(snapshot, ship).some(command => command.type === 'holdPosition' && command.unitIds.includes(caster.id))).toBe(true);
  expect(caster.hp).toBe(caster.maxHp);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it.each(['queued', 'walk'] as const)('keeps a later %s heal from replacing a prior hold', change => {
  const { saved, snapshot, caster, spell } = actual(30660);
  if (spell.type !== 'cast') throw Error('wrong original spell');
  const command: GameCommand = change === 'queued' ? { ...spell, queued: true } : { ...spell,
    targetId: snapshot.units.find(unit => unit.owner === 'p0' && canReceiveHealing(unit, snapshot)
      && Math.hypot(caster.x-unit.x, caster.y-unit.y) > ABILITY_DEFS.heal.range + 100)!.id };
  const hold: GameCommand = { type: 'holdPosition', unitIds: [caster.id] };
  const scripts: AiScript[] = [{ id: 'naval', phase: 'tactics', run: () => hold },
    { id: 'abilities', phase: 'tactics', run: () => command }];
  expect(runAiCommandEntriesFromScripts(snapshot, 'p0', scripts, { memory: structuredClone(saved.memories.p0!) }))
    .toEqual([{ scriptId: 'naval', command: hold }]);
});


it.each(['cooldown', 'stunned', 'enemy', 'mechanical', 'cabin', 'noHealAbility', 'boarding'] as const)(
  'does not let an instant-heal exception bypass the original %s boundary', change => {
  const { saved, snapshot, caster, target, spell } = actual(30660);
  // Deliberate isolated invalid-order counterfactuals. These are not ordinary
  // match states, losses or successes attributed to the original fixture.
  if (change === 'cooldown') caster.abilityCooldowns = { heal: 1 };
  if (change === 'stunned') caster.effects = [{ type: 'stun', remaining: 1 }];
  if (change === 'enemy') target.owner = 'p1';
  if (change === 'mechanical') target.kind = 'ballista';
  if (change === 'cabin') caster.cabin = { shipId: 'counterfactual-cabin' };
  if (change === 'noHealAbility') caster.kind = 'footman';
  if (change === 'boarding') caster.order = { type: 'board', transportId: 'counterfactual-ferry' };
  const hold: GameCommand = { type: 'holdPosition', unitIds: [caster.id] };
  const scripts: AiScript[] = [{ id: 'naval', phase: 'tactics', claimsUnits: () => new Set([caster.id]), run: () => hold },
    { id: 'abilities', phase: 'tactics', run: () => spell }];
  // For current boarding, naval owns its own approach but the later unrelated
  // abilities script remains excluded by the original boarding reservation.
  expect(runAiCommandEntriesFromScripts(snapshot, 'p0', scripts, { memory: structuredClone(saved.memories.p0!) }))
    .toEqual([{ scriptId: 'naval', command: hold }]);
});

it.each([false, true])('keeps the real37410 aimed weapon cast behind an earlier hold (queued=%s)', queued => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/aimed-weapon-knight-37410.json.gz', import.meta.url))).toString()) as Saved;
  const { snapshot } = saved;
  const caster = snapshot.units.find(unit => unit.id === 'unit-p0-ballista-27366')!;
  const target = snapshot.units.find(unit => unit.id === 'unit-p2-witch-6336')!;
  expect(abilityCooldown(caster, 'pinningBolt')).toBe(0);
  expect(Math.hypot(caster.x-target.x, caster.y-target.y)).toBeLessThan(ABILITY_DEFS.pinningBolt.range);
  const hold: GameCommand = { type: 'holdPosition', unitIds: [caster.id] };
  const cast: GameCommand = { type: 'cast', unitId: caster.id, ability: 'pinningBolt', targetId: target.id, ...(queued ? { queued: true } : {}) };
  expect(runAiCommandEntriesFromScripts(snapshot, 'p0', [{ id: 'naval', phase: 'tactics', run: () => hold },
    { id: 'abilities', phase: 'tactics', run: () => cast }], { memory: structuredClone(saved.memories.p0!) }))
    .toEqual([{ scriptId: 'naval', command: hold }]);
});

it('keeps a real30660 in-window charge behind an earlier hold', () => {
  const { saved, snapshot } = actual(30660);
  const caster = snapshot.units.find(unit => unit.id === 'unit-p0-lancer-11127')!;
  const target = snapshot.units.find(unit => unit.id === 'unit-p1-spirit-38062')!;
  const definition = ABILITY_DEFS.charge;
  if (definition.behavior !== 'charge') throw Error('charge definition changed');
  const gap = Math.hypot(caster.x-target.x, caster.y-target.y);
  expect(abilityCooldown(caster, 'charge')).toBe(0);
  expect(gap).toBeGreaterThan(definition.minRange); expect(gap).toBeLessThan(definition.range);
  const hold: GameCommand = { type: 'holdPosition', unitIds: [caster.id] };
  const charge: GameCommand = { type: 'cast', unitId: caster.id, ability: 'charge', targetId: target.id };
  expect(runAiCommandEntriesFromScripts(snapshot, 'p0', [{ id: 'naval', phase: 'tactics', run: () => hold },
    { id: 'abilities', phase: 'tactics', run: () => charge }], { memory: structuredClone(saved.memories.p0!) }))
    .toEqual([{ scriptId: 'naval', command: hold }]);
});
