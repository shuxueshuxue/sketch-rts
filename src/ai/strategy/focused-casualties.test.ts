import { describe, expect, it } from 'vitest';
import { createUnit } from '../../shared/map';
import { UNIT_DEFS } from '../../shared/catalog';
import { calibratedCasualties, CALIBRATED_CASUALTY_FOCUS_SHARE, casualtySurvivors, focusedCasualties } from './focused-casualties';

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

describe('selected global calibrated casualty mixture', () => {
  it('uses the one calibrated focus share and carries light wounds without inventing deaths', () => {
    const units = party(), before = JSON.stringify(units), result = calibratedCasualties(units, 200);
    expect(CALIBRATED_CASUALTY_FOCUS_SHARE).toBe(.19);
    expect(result).toMatchObject({ deadUnitIds: [], expectedLossGold: 0, expectedHpLost: 200 });
    expect(result.survivors[0]!.hp).toBeCloseTo(47.6, 10);
    expect(result.survivors.slice(1).every(unit => Math.abs(unit.hp - 85.6) < 1e-10)).toBe(true);
    expect(focusedCasualties(units, 200).permanentDeadUnitIds).toHaveLength(1);
    expect(calibratedCasualties([...units].reverse(), 200)).toEqual(result);
    expect(calibratedCasualties(JSON.parse(before), 200)).toEqual(result);
    expect(JSON.stringify(units)).toBe(before);
  });

  it('charges only calibrated deaths and conserves damage with the exact surviving cohort', () => {
    const units = party(), result = calibratedCasualties(units, 400);
    expect(result).toMatchObject({ deadUnitIds: ['a'], permanentDeadUnitIds: ['a'], expectedLossGold: UNIT_DEFS.emberRavager.cost });
    expect(result.survivors[0]!.hp).toBeCloseTo(30.4, 10);
    expect(casualtySurvivors(units, result).reduce((sum, unit) => sum + unit.hp, 0)).toBeCloseTo(190, 10);
    expect(result.wounds.every(wound => wound.readyInTicks === null)).toBe(true);
    const totalHp = units.reduce((sum, unit) => sum + unit.hp, 0);
    expect(calibratedCasualties(units, totalHp + 25)).toMatchObject({ survivors: [], unappliedDamage: 25,
      expectedHpLost: totalHp, expectedLossGold: UNIT_DEFS.emberRavager.cost * 5 });
  });
});
