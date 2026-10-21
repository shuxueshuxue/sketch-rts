import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../shared/catalog';
import { assessLandCombatAttrition, landCombatResponseCoverage, landCombatWorkTicks, type LandCombatFiringSource } from './land-combat-assessment';
import { forceSuccessProbability } from './utility';

describe('shared exact-cohort land arithmetic', () => {
  it('prices real target HP, including buildings, with the selected raw weapons', () => {
    const fighters = [{ attackDamage: 10, attackCooldown: 20 }, { attackDamage: 8, attackCooldown: 40 }];
    expect(landCombatWorkTicks([{ hp: 700 }], fighters)).toBeCloseTo(1000, 10);
    expect(landCombatWorkTicks([{ hp: 1400 }], fighters)).toBeCloseTo(2000, 10);
    expect(landCombatWorkTicks([{ hp: 700 }], fighters.slice(0, 1))).toBe(1400);
    expect(landCombatWorkTicks([], fighters, 2400)).toBe(2400);
  });

  it('keeps the old ETA, expiry, deduplication and loss arithmetic bit-for-bit', () => {
    // Independent copy of the previous LandModel formula. Vary non-integer
    // windows, actual HP, cooldowns, summon expiry and repeated target/tower IDs.
    for (let i = 0; i < 100; i++) {
      const fighters = [{ kind: 'footman' as const, hp: 10 + i }, { kind: 'archer' as const, hp: 20 + i / 3 }];
      const firing: LandCombatFiringSource[] = [
        { body: { id: 'responder', hp: 100, attackDamage: 12, attackCooldown: 20 + i }, arrivalTicks: i * 3, expiresTick: 500 + i },
        { body: { id: 'tower', hp: 800, attackDamage: 8, attackCooldown: 30 }, arrivalTicks: null, expiresTick: null },
        { body: { id: 'tower', hp: 800, attackDamage: 8, attackCooldown: 30 }, arrivalTicks: null, expiresTick: null },
      ];
      const input = { tick: 100, arrivalTicks: 50 + i / 7, workTicks: 400 + i / 3, fighters, firing,
        fieldStrength: 1 + i / 10, requiredFieldStrength: 6 };
      const damage = [...new Map(firing.map(source => [source.body.id, source])).values()].reduce((sum, source) => {
        const starts = source.arrivalTicks === null ? input.arrivalTicks : Math.max(input.arrivalTicks, source.arrivalTicks);
        const ends = source.expiresTick === null ? input.arrivalTicks + input.workTicks
          : Math.min(input.arrivalTicks + input.workTicks, source.expiresTick - input.tick);
        return sum + source.body.attackDamage / Math.max(1, source.body.attackCooldown) * Math.max(0, ends - starts);
      }, 0);
      const hp = fighters.reduce((sum, fighter) => sum + fighter.hp, 0);
      const price = fighters.reduce((sum, fighter) => sum + UNIT_DEFS[fighter.kind].cost, 0);
      expect(assessLandCombatAttrition(input)).toEqual({ damage,
        expectedLossGold: Math.min(price, price * damage / Math.max(1, hp)) * (1 - forceSuccessProbability(input.fieldStrength, 6)),
        successProbability: forceSuccessProbability(input.fieldStrength, 6) });
    }
  });

  it('clips short-lived responders only after their published arrival', () => {
    expect(landCombatResponseCoverage(100, 500, 200, null)).toBe(1);
    expect(landCombatResponseCoverage(100, 500, 200, 400)).toBe(1 / 3);
    const firing = [{ body: { id: 'summon', hp: 100, attackDamage: 20, attackCooldown: 20 }, arrivalTicks: 300, expiresTick: 350 }];
    const result = assessLandCombatAttrition({ tick: 100, arrivalTicks: 100, workTicks: 500,
      fighters: [{ kind: 'footman', hp: 100 }], fieldStrength: 1, requiredFieldStrength: 2, firing });
    expect(result.damage).toBe(0);
  });
});
