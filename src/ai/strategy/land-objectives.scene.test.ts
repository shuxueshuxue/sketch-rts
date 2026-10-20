import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { generateLandObjectives, decomposeLandObjective, landIdleForces } from './land-objectives';
import type { PlanningContext, Situation } from './types';

// Full pre-think worlds from #556. Situation is captured from the shared evaluator,
// not recreated by a second ETA/threat implementation inside this test suite.
type Frame = { event: string; context: PlanningContext; situation: Situation };
const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/land-objective-event-frames.json.gz', import.meta.url))).toString());
const frames: Frame[] = fixture.cases;
const scene = (event: string) => structuredClone(frames.find(frame => frame.event === event)!);
const observe = ({ situation, context }: Frame) => {
  const objectives = generateLandObjectives(situation, context);
  return { objectives, methods: objectives.flatMap(goal => decomposeLandObjective(situation, goal, context)),
    idle: landIdleForces(situation, objectives) };
};

describe('land objective observation on L1–L6 contract frames', () => {
  it.each(frames.map(frame => frame.event))('does not mutate the complete %s frame or imply an allocation', event => {
    const frame = scene(event), before = JSON.stringify(frame);
    const result = observe(frame);
    expect(JSON.stringify(frame)).toBe(before);
    expect(observe(frame)).toEqual(result);
    expect(result.objectives.every(goal => goal.rank === 0)).toBe(true);
    expect(result.methods.every(method => ['candidate', 'blocked'].includes(method.status))).toBe(true);
    expect(result.idle.flatMap(force => force.unitIds).length).toBe(new Set(result.idle.flatMap(force => force.unitIds)).size);
  });

  it('L1 keeps the three existing mining guards out of the idle pool and exposes required handoff', () => {
    const frame = scene('L1'), result = observe(frame);
    for (const suffix of [1039, 1044, 1058]) {
      const id = `unit-player-emberRavager-${suffix}`;
      expect(frame.situation.units.find(unit => unit.id === id)!.commitments).toContainEqual(expect.objectContaining({
        objectiveId: 'DefendSite:player:building-player-townHall-1798',
      }));
      expect(result.idle.flatMap(force => force.unitIds)).not.toContain(id);
    }
    expect(result.objectives.some(goal => goal.reasons.some(reason => reason.code === 'borrow-requires-handoff'))).toBe(true);
  });

  it('L2 preserves attack membership despite hold orders and exposes the conflicting expansion claim', () => {
    const frame = scene('L2'), result = observe(frame);
    for (const suffix of [1334, 1515, 1537]) {
      const id = `unit-player-archer-${suffix}`, unit = frame.situation.units.find(unit => unit.id === id)!;
      expect(unit.commitments.some(claim => claim.objectiveId === 'AttackSite:player:building-enemy-townHall-1944')).toBe(true);
      expect(unit.commitments.some(claim => claim.objectiveId === 'ExpandLand:player:gold-gen-6')).toBe(true);
      expect(result.idle.flatMap(force => force.unitIds)).not.toContain(id);
    }
    const attack = result.objectives.find(goal => goal.id === 'AttackSite:player:building-enemy-townHall-1944')!;
    expect(attack.sinceTick).toBe(frame.context.memory.landAttack!.sinceTick);
    expect(attack.reasons.some(reason => reason.code === 'borrow-requires-handoff')).toBe(true);
  });

  it.each([['L3', 'unit-player-ashChieftain-3872'], ['L4', 'unit-player-contractArcher-1923']])(
    '%s does not release a remote defender into the idle pool during local medical control', (event, id) => {
      const frame = scene(event!), result = observe(frame);
      const unit = frame.situation.units.find(unit => unit.id === id)!;
      expect(unit.commitments.some(claim => claim.objectiveId === 'DefendSite:player:building-player-townHall-5459')).toBe(true);
      expect(result.idle.flatMap(force => force.unitIds)).not.toContain(id);
    });

  it('L5 keeps overseas mining under its existing parent, including after a caster has landed', () => {
    const frame = scene('L5-front'), result = observe(frame);
    const caster = frame.situation.units.find(unit => unit.id === 'unit-player-ashHexer-3527')!;
    expect(caster.roles).toContain('caster');
    expect(caster.commitments.some(claim => claim.objectiveId?.startsWith('ConquerIsland:'))).toBe(true);
    expect(result.objectives.some(goal => goal.kind === 'ExpandLand' && goal.target.entityId === 'gold-gen-6')).toBe(false);
    expect(result.idle.flatMap(force => force.unitIds)).not.toContain(caster.id);
  });

  it('L6 cannot satisfy a sustained mining mission with only expiring spirits and distant casters', () => {
    const frame = scene('L6'), result = observe(frame);
    const goal = result.objectives.find(goal => goal.id === 'ExpandLand:player:gold-gen-4')!;
    const methods = result.methods.filter(method => method.objectiveId === goal.id);
    expect(goal.status).toBe('blocked');
    for (const method of methods) expect(method.preconditions).toContainEqual(expect.objectContaining({
      kind: 'force', status: 'unmet', demand: expect.objectContaining({ permanent: true }),
    }));
    expect(methods.flatMap(method => method.subgoals)).toContainEqual(expect.objectContaining({ kind: 'borrow-force' }));
    expect(methods.flatMap(method => method.subgoals)).toContainEqual(expect.objectContaining({ kind: 'train-force' }));
    const cohort = goal.reasons.find(reason => reason.code === 'observation-only-cohort')!.detail;
    for (const suffix of [1903, 1953]) expect(cohort).not.toContain(`unit-player-spirit-${suffix}`);
    expect(cohort).not.toContain('unit-player-summoner');
  });
});
