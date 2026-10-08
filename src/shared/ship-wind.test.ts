import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { shipProfile } from './ship-geometry';
import { shipMotionLimits, shipPartMax } from './ship-handling';
import { coursePerformance, DEFAULT_WIND, getWind, SAIL_RULES, sailRig, updateAutoTrim } from './ship-wind';
import { perTick } from './time';
import type { UnitKind } from './types';

function ship(kind: UnitKind = 'transport') {
  const unit = createUnit('boat', 'player', kind, 500, 500);
  unit.sailing = { heading: 0, speed: 0, load: 0, balance: 0,
    sail: { angle: 0, billow: 0, set: 1, mode: 'sail' } };
  return unit;
}
// Heading zero, with the wind coming from angle relative to the bow.
const windFrom = (angle: number, speed = 80) => ({ wind: { direction: angle + Math.PI, speed } });
const planned = (unit: ReturnType<typeof ship>, angle: number, speed = 80) =>
  coursePerformance(unit, windFrom(angle, speed), 0, { assumeTrimmed: true });

describe('deterministic wind and sail performance', () => {
  it('uses one fixed default air velocity and identifies the three rig families', () => {
    expect(getWind({})).toEqual(getWind({ wind: DEFAULT_WIND }));
    expect(getWind({}).speed).toBe(80);
    expect(getWind({}).direction).toBeCloseTo(Math.PI / 4);
    expect(getWind({}).x).toBeCloseTo(80 / Math.sqrt(2));
    expect(getWind({}).y).toBeCloseTo(80 / Math.sqrt(2));
    expect(['cutter', 'fireShip', 'bombardShip'].map(kind => sailRig(kind as UnitKind))).toEqual(['lateen', 'lateen', 'lateen']);
    expect(sailRig('transport')).toBe('lug');
    expect(sailRig('warship')).toBe('square');
    expect(sailRig('carrier')).toBe('square');
    expect(getWind({ wind: { direction: 0, speed: -10 } }).speed).toBe(0);
  });

  it.each(['cutter', 'transport', 'warship'] as const)('%s has a true-wind no-go zone and a useful upwind VMG course', kind => {
    const unit = ship(kind), bow = planned(unit, 0), edge = planned(unit, bow.noGoAngle);
    expect(bow.noGo).toBe(true);
    expect(bow.targetSpeed).toBe(0);
    expect(edge.noGo).toBe(true);
    expect(edge.targetSpeed).toBe(0);
    const beat = planned(unit, bow.beatAngle);
    expect(beat.noGo).toBe(false);
    expect(beat.beatAngle).toBeGreaterThan(beat.noGoAngle);
    expect(beat.beatAngle).toBeLessThan(Math.PI / 2);
    expect(beat.targetSpeed).toBeGreaterThan(0);
    const bestVmg = beat.targetSpeed * Math.cos(beat.beatAngle);
    for (let degree = 1; degree < 90; degree++) {
      const angle = degree * Math.PI / 180, speed = planned(unit, angle).targetSpeed;
      expect(bestVmg + 1e-8).toBeGreaterThanOrEqual(speed * Math.cos(angle));
    }
  });

  it('gives each rig a distinct broad-reach and running polar without exceeding the physical hull budget', () => {
    const lateen = ship('cutter'), square = ship('warship');
    expect(planned(lateen, Math.PI / 2).targetSpeed).toBeGreaterThan(planned(lateen, Math.PI).targetSpeed);
    expect(planned(square, Math.PI).targetSpeed).toBeGreaterThan(planned(square, Math.PI / 2).targetSpeed);
    for (const kind of ['transport', 'cutter', 'warship', 'carrier', 'bombardShip', 'fireShip'] as const) {
      const unit = ship(kind);
      for (let degree = 0; degree <= 180; degree += 5) {
        const performance = planned(unit, degree * Math.PI / 180, 800);
        expect(performance.targetSpeed).toBeLessThanOrEqual(shipMotionLimits(unit).speed);
        expect(performance.targetSpeed).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it.each(['cutter', 'transport', 'warship'] as const)('%s mirrors trim, apparent wind and propulsion on opposite tacks', kind => {
    const left = ship(kind), right = ship(kind), angle = Math.PI * .4;
    left.sailing!.velocityX = right.sailing!.velocityX = 20;
    left.sailing!.velocityY = 4; right.sailing!.velocityY = -4;
    for (let tick = 0; tick < 80; tick++) {
      updateAutoTrim(left, windFrom(angle)); updateAutoTrim(right, windFrom(-angle));
      expect(left.sailing!.sail!.angle).toBeCloseTo(-right.sailing!.sail!.angle, 8);
      // Square cloth's normal starts on the longitudinal axis, while a
      // fore-and-aft sail's normal starts across the beam.
      expect(left.sailing!.sail!.billow).toBeCloseTo(right.sailing!.sail!.billow * (kind === 'warship' ? 1 : -1), 8);
    }
    const a = coursePerformance(left, windFrom(angle)), b = coursePerformance(right, windFrom(-angle));
    expect(a.targetSpeed).toBeCloseTo(b.targetSpeed, 8);
    expect(a.apparentWindAngle).toBeCloseTo(-b.apparentWindAngle, 8);
    expect(a.trimEfficiency).toBeCloseTo(1, 8);
  });

  it('uses physical rig yaw to open an aft sail foot to leeward and brace a square yard into the airflow', () => {
    for (const kind of ['cutter', 'transport'] as const) {
      const angle = coursePerformance(ship(kind), windFrom(Math.PI / 2)).targetSailAngle;
      expect(angle).toBeGreaterThan(0);
      // The boom/foot starts aft at (-1,0); +yaw must take it toward -Y.
      expect(-Math.sin(angle)).toBeLessThan(0);
    }
    expect(coursePerformance(ship('warship'), windFrom(Math.PI / 2)).targetSailAngle).toBeLessThan(0);
    expect(coursePerformance(ship('warship'), windFrom(Math.PI)).targetSailAngle).toBeCloseTo(0);
  });

  it('does not turn the boat-generated apparent wind into propulsion in a calm', () => {
    const unit = ship();
    for (const velocity of [80, -80, 0]) {
      unit.sailing!.velocityX = velocity; unit.sailing!.velocityY = 17;
      for (let tick = 0; tick < 60; tick++) updateAutoTrim(unit, windFrom(0, 0), 'calm-assist');
      const performance = coursePerformance(unit, windFrom(0, 0));
      expect(performance.apparentSpeed).toBeGreaterThan(0);
      expect(performance.calm).toBe(true);
      expect(performance.targetSpeed).toBe(0);
      expect(planned(unit, Math.PI / 2, 0).targetSpeed).toBe(0);
      expect(unit.sailing!.sail!.billow).toBe(0);
      expect(performance.auxiliarySpeed).toBeCloseTo(shipMotionLimits(unit).speed * .2);
      expect(unit.sailing!.sail!.set).toBeCloseTo(.15);
    }
  });

  it('changes trim at a bounded rate and makes incorrect trim reduce actual propulsion', () => {
    const unit = ship('cutter'), map = windFrom(Math.PI / 2);
    unit.sailing!.sail!.angle = -SAIL_RULES.lateen.maxAngle;
    const initial = coursePerformance(unit, map).targetSpeed;
    const ideal = coursePerformance(unit, map, 0, { assumeTrimmed: true }).targetSpeed;
    for (let tick = 0; tick < 80; tick++) {
      const before = { ...unit.sailing!.sail! };
      const sail = updateAutoTrim(unit, map);
      expect(Math.abs(sail.angle - before.angle)).toBeLessThanOrEqual(perTick(SAIL_RULES.trimRate) + 1e-12);
      expect(Math.abs(sail.billow - before.billow)).toBeLessThanOrEqual(perTick(SAIL_RULES.billowRate) + 1e-12);
      expect(Math.abs(sail.set - before.set)).toBeLessThanOrEqual(perTick(SAIL_RULES.setRate) + 1e-12);
      expect(Math.abs(sail.angle)).toBeLessThanOrEqual(SAIL_RULES.lateen.maxAngle);
    }
    expect(initial).toBeLessThan(ideal * .5);
    expect(coursePerformance(unit, map).targetSpeed).toBeCloseTo(ideal);
    for (let tick = 0; tick < 80; tick++) updateAutoTrim(unit, map, 'idle');
    expect(unit.sailing!.sail).toEqual({ angle: 0, billow: 0, set: 0, mode: 'idle' });
    expect(coursePerformance(unit, map).targetSpeed).toBe(0);
  });

  it('keeps load and damaged rigging in the original speed limit, with no free propulsion for destroyed sails', () => {
    const unit = ship(), angle = Math.PI * 2 / 3, healthy = planned(unit, angle);
    unit.sailing!.load = shipProfile(unit)!.loadCapacity;
    const loaded = planned(unit, angle);
    expect(loaded.targetSpeed).toBeCloseTo(healthy.targetSpeed / 1.2);
    unit.shipParts = { ...shipPartMax(unit), rigging: shipPartMax(unit).rigging / 4 };
    const damaged = planned(unit, angle);
    expect(damaged.targetSpeed).toBeCloseTo(loaded.targetSpeed * .5);
    expect(damaged.auxiliarySpeed).toBeCloseTo(damaged.maxForwardSpeed * .2);
    unit.shipParts.rigging = 0;
    for (const mode of ['sail', 'tacking', 'maneuver', 'calm-assist'] as const) {
      updateAutoTrim(unit, windFrom(angle), mode);
      const stopped = coursePerformance(unit, windFrom(angle));
      expect(stopped.targetSpeed).toBe(0);
      expect(stopped.auxiliarySpeed).toBe(0);
    }
  });

  it('leaves the physical forward budget available while the chosen heading is inside the no-go zone', () => {
    const unit = ship('warship'), initial = shipMotionLimits(unit);
    const performance = planned(unit, 0);
    expect(performance.targetSpeed).toBe(0);
    expect(performance.maxForwardSpeed).toBe(initial.speed);
    expect(shipMotionLimits(unit)).toEqual(initial);
    unit.shipParts = { ...shipPartMax(unit), rudder: 0 };
    expect(planned(unit, Math.PI).targetSpeed).toBeGreaterThan(0);
    expect(shipMotionLimits(unit).turnRate).toBe(0);
  });

  it('changes apparent trim with signed astern velocity without changing the ideal true-wind polar', () => {
    const unit = ship(), map = windFrom(Math.PI / 2);
    unit.sailing!.velocityX = 35;
    const forward = coursePerformance(unit, map, 0, { assumeTrimmed: true });
    unit.sailing!.velocityX = -35;
    const reverse = coursePerformance(unit, map, 0, { assumeTrimmed: true });
    expect(forward.apparentWindAngle).not.toBe(reverse.apparentWindAngle);
    expect(forward.targetSailAngle).not.toBe(reverse.targetSailAngle);
    expect(forward.targetSpeed).toBe(reverse.targetSpeed);
  });
});
