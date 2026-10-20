import { describe, expect, it } from 'vitest';
import { createUnit } from '../../shared/map';
import { UNIT_DEFS } from '../../shared/catalog';
import { casualtySurvivors, experimentalMixedCasualties, experimentalRetreatCasualties, focusedCasualties } from './focused-casualties';

const party = () => ['a', 'b', 'c', 'd', 'e'].map(id => createUnit(id, 'us', 'emberRavager', 1000, 1000));

describe('one focused casualty and wound model', () => {
  it('does not turn a survivable wound into a fractional catalog death', () => {
    const units = party(), before = JSON.stringify(units), result = focusedCasualties(units, 25);
    expect(result.deadUnitIds).toEqual([]);
    expect(result.expectedLossGold).toBe(0);
    expect(result.survivors.filter(unit => unit.damage > 0)).toEqual([{ unitId: 'a', hp: units[0]!.hp - 25,
      maxHp: units[0]!.maxHp, damage: 25, permanent: true }]);
    expect(result.wounds[0]?.readyInTicks).toBeNull();
    expect(JSON.stringify(units)).toBe(before);
  });

  it('kills the lowest actual HP first, leaves one partly hurt survivor and carries exact HP forward', () => {
    const units = party(); units[2]!.hp = 30;
    const result = focusedCasualties(units, 35);
    expect(result.deadUnitIds).toEqual(['c']);
    expect(result.permanentDeadUnitIds).toEqual(['c']);
    expect(result.expectedLossGold).toBe(UNIT_DEFS.emberRavager.cost);
    const survivors = casualtySurvivors(units, result);
    expect(survivors.map(unit => unit.id)).toEqual(['a', 'b', 'd', 'e']);
    expect(survivors.find(unit => unit.id === 'a')!.hp).toBe(units[0]!.hp - 5);
    expect(survivors.filter(unit => unit.hp === unit.maxHp)).toHaveLength(3);
    expect(focusedCasualties([...units].reverse(), 35)).toEqual(result);
    expect(focusedCasualties(JSON.parse(JSON.stringify(units)), 35)).toEqual(result);
    expect(result.expectedHpLost).toBe(35);
    expect(result.unappliedDamage).toBe(0);
  });

  it('has exact death boundaries, caps applied damage and never charges a killed summon as a permanent asset', () => {
    const units = party().slice(0, 1), hp = units[0]!.hp;
    expect(focusedCasualties(units, hp - .5).expectedLossGold).toBe(0);
    expect(focusedCasualties(units, hp).deadUnitIds).toEqual(['a']);
    expect(focusedCasualties(units, hp + 50)).toMatchObject({ expectedHpLost: hp, unappliedDamage: 50,
      expectedLossGold: UNIT_DEFS.emberRavager.cost, survivors: [] });
    units[0]!.expiresTick = 1000;
    expect(focusedCasualties(units, hp)).toMatchObject({ deadUnitIds: ['a'], permanentDeadUnitIds: [], expectedLossGold: 0 });
  });

  it('promises recovery only from an explicit native service, including pre-existing wounds', () => {
    const units = party().slice(0, 2); units[0]!.hp = 50;
    const result = focusedCasualties(units, 25, [{ unitId: 'a', hpPerTick: 2, startsInTicks: 10 }]);
    const duration = Math.ceil((units[0]!.maxHp - 25) / 2);
    expect(result.wounds).toEqual([{ unitId: 'a', missingHp: units[0]!.maxHp - 25, battleDamage: 25,
      startsInTicks: 10, durationTicks: duration, readyInTicks: 10 + duration }]);
    expect(result.expectedLossGold).toBe(0);
    expect(() => focusedCasualties(units, 25, [{ unitId: 'a', hpPerTick: 0, startsInTicks: 10 }])).toThrow();
  });

  it('rejects duplicate or non-finite evidence instead of silently publishing a zero loss', () => {
    const units = party();
    expect(() => focusedCasualties([...units, units[0]!], 0)).toThrow(/Duplicate/);
    expect(() => focusedCasualties(units, NaN)).toThrow();
    expect(() => focusedCasualties(units, Infinity)).toThrow();
    expect(() => focusedCasualties(units, -1)).toThrow();
    expect(focusedCasualties(units, 0).survivors).toHaveLength(units.length);
  });
});

describe('experimental global damage mixture', () => {
  it('uses physical proportional HP damage at zero and the exact existing focus model at one', () => {
    const units = party(); units[0]!.hp = 30;
    const damage = 200, totalHp = units.reduce((sum, unit) => sum + unit.hp, 0);
    const spread = experimentalMixedCasualties(units, damage, 0);
    expect(spread.deadUnitIds).toEqual([]); expect(spread.expectedLossGold).toBe(0);
    for (const survivor of spread.survivors) expect(survivor.hp)
      .toBeCloseTo(units.find(unit => unit.id === survivor.unitId)!.hp * (1 - damage / totalHp), 10);
    expect(experimentalMixedCasualties(units, damage, 1)).toEqual(focusedCasualties(units, damage));
  });

  it('keeps one conserved damage, death price and surviving HP ledger for every mixture', () => {
    const units = party(); units[0]!.hp = 30.1081; units[1]!.hp = 92.199821; units[1]!.expiresTick = 1000;
    const initialHp = units.reduce((sum, unit) => sum + unit.hp, 0), before = JSON.stringify(units);
    for (const alpha of [0, .1, .25, .5, .75, 1]) for (const exposure of [0, 25.1248, 120, 200, initialHp, initialHp + 80]) {
      const value = experimentalMixedCasualties(units, exposure, alpha), dead = new Set(value.deadUnitIds);
      const lost = units.filter(unit => dead.has(unit.id)).reduce((sum, unit) => sum + unit.hp, 0)
        + value.survivors.reduce((sum, unit) => sum + unit.damage, 0);
      expect(lost).toBeCloseTo(Math.min(exposure, initialHp), 9);
      expect(value.expectedHpLost + value.unappliedDamage).toBeCloseTo(exposure, 9);
      expect(value.expectedLossGold).toBe(units.filter(unit => dead.has(unit.id) && unit.expiresTick === undefined)
        .reduce((sum, unit) => sum + UNIT_DEFS[unit.kind].cost, 0));
      expect(value.survivors.reduce((sum, unit) => sum + unit.hp, 0)).toBeCloseTo(initialHp - value.expectedHpLost, 9);
      expect(experimentalMixedCasualties([...units].reverse(), exposure, alpha)).toEqual(value);
      expect(experimentalMixedCasualties(JSON.parse(before), exposure, alpha)).toEqual(value);
    }
    expect(JSON.stringify(units)).toBe(before);
  });

  it('prices only deaths, retains explicit recovery and rejects invalid global parameters', () => {
    const units = party(), recovery = [{ unitId: 'a', hpPerTick: 2, startsInTicks: 10 }];
    const value = experimentalMixedCasualties(units, 25, .5, recovery);
    expect(value.expectedLossGold).toBe(0);
    expect(value.wounds.find(wound => wound.unitId === 'a')!.readyInTicks)
      .toBe(10 + Math.ceil(value.wounds.find(wound => wound.unitId === 'a')!.missingHp / 2));
    expect(value.wounds.find(wound => wound.unitId === 'b')!.readyInTicks).toBeNull();
    for (const alpha of [-.1, 1.1, NaN, Infinity]) expect(() => experimentalMixedCasualties(units, 25, alpha)).toThrow();
  });
});

describe('experimental engagement and retreat mechanism', () => {
  const frame = (burst: number) => ({ units: party().slice(0, 3).map(unit => ({ ...unit, hp: 100, maxHp: 100 })),
    damageExposure: 150, exposureKind: 'damage-potential' as const,
    engagementOrder: ['b', 'a', 'c'], burstByUnit: ['a', 'b', 'c'].map(unitId => ({ unitId, damage: burst })),
    engagementShare: 1 / 3, retreatHpRatio: .35 });

  it('withdraws a wounded front member and never redirects leftover damage into the unengaged rear', () => {
    const input = frame(10), before = JSON.stringify(input), result = experimentalRetreatCasualties(input);
    expect(result).toMatchObject({ engagedUnitIds: ['b'], withdrawnUnitIds: ['b'], unengagedUnitIds: ['a', 'c'],
      deadUnitIds: [], expectedLossGold: 0, expectedHpLost: 75, avoidedDamage: 75, overkillDamage: 0, unappliedDamage: 75 });
    expect(result.survivors.map(unit => [unit.unitId, unit.hp])).toEqual([['a', 100], ['b', 25], ['c', 100]]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('charges an actual burst kill, retaining overkill instead of charging it to another unit', () => {
    const result = experimentalRetreatCasualties(frame(50));
    expect(result).toMatchObject({ deadUnitIds: ['b'], permanentDeadUnitIds: ['b'], withdrawnUnitIds: [], expectedHpLost: 100,
      expectedLossGold: UNIT_DEFS.emberRavager.cost, avoidedDamage: 35, overkillDamage: 15, unappliedDamage: 50 });
    expect(result.expectedHpLost + result.overkillDamage + result.avoidedDamage).toBe(result.damageExposure);
    expect(experimentalRetreatCasualties({ ...frame(50), exposureKind: 'effective-hp' })).toMatchObject({
      deadUnitIds: ['b'], expectedHpLost: 100, overkillDamage: 0, avoidedDamage: 50 });
  });

  it('keeps limited wounds, explicit recovery and serialized initial geometry consistent', () => {
    const input = { ...frame(10), damageExposure: 10 }, recovery = [{ unitId: 'b', hpPerTick: 2, startsInTicks: 3 }];
    const result = experimentalRetreatCasualties(input, recovery);
    expect(result.withdrawnUnitIds).toEqual([]);
    expect(result.wounds).toEqual([{ unitId: 'b', missingHp: 10, battleDamage: 10,
      startsInTicks: 3, durationTicks: 5, readyInTicks: 8 }]);
    expect(experimentalRetreatCasualties(JSON.parse(JSON.stringify(input)), recovery)).toEqual(result);
    expect(experimentalRetreatCasualties({ ...input, units: [...input.units].reverse() }, recovery)).toEqual(result);
    const none = experimentalRetreatCasualties({ ...input, engagementShare: 0 });
    expect(none).toMatchObject({ expectedHpLost: 0, avoidedDamage: 10, expectedLossGold: 0 });
  });

  it('rejects missing burst evidence and an invented or duplicated combatant', () => {
    const input = frame(10);
    expect(() => experimentalRetreatCasualties({ ...input, burstByUnit: [] })).toThrow(/Missing/);
    expect(() => experimentalRetreatCasualties({ ...input, engagementOrder: ['b', 'b'] })).toThrow(/order/);
    expect(() => experimentalRetreatCasualties({ ...input, engagementOrder: ['future-member'] })).toThrow(/order/);
    expect(() => experimentalRetreatCasualties({ ...input, engagementShare: 1.1 })).toThrow();
  });

  it('continues taking explicit pursuit damage after a retreat command without repeating flying impacts', () => {
    const input = frame(10), pursuitByUnit = input.units.map(unit => ({ unitId: unit.id, damagePerTick: .5 }));
    expect(experimentalRetreatCasualties({ ...input, pursuitByUnit, retreatExposureTicks: 0 }))
      .toEqual(experimentalRetreatCasualties(input));
    const chased = experimentalRetreatCasualties({ ...input, pursuitByUnit, retreatExposureTicks: 60 });
    expect(chased).toMatchObject({ deadUnitIds: ['b'], expectedLossGold: UNIT_DEFS.emberRavager.cost,
      expectedHpLost: 100, overkillDamage: 5, avoidedDamage: 45 });
    expect(chased.expectedHpLost + chased.overkillDamage + chased.avoidedDamage).toBe(input.damageExposure);
    expect(() => experimentalRetreatCasualties({ ...input, retreatExposureTicks: 60 })).toThrow(/pursuit/);
    expect(() => experimentalRetreatCasualties({ ...input, pursuitByUnit, retreatExposureTicks: -1 })).toThrow();
    expect(experimentalRetreatCasualties(JSON.parse(JSON.stringify({ ...input, pursuitByUnit, retreatExposureTicks: 60 })))).toEqual(chased);
  });
});
