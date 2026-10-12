import { describe, expect, it } from 'vitest';
import { DEFAULT_WIND, getWind, updateWindField, windAt, WIND_CHANGE_INTERVAL_TICKS } from './wind-field';
import type { GameMap } from './types';

const interval = WIND_CHANGE_INTERVAL_TICKS;
function map(seed = 'weather'): Pick<GameMap, 'id' | 'wind' | 'terrain'> {
  return { id: 'bareDuel', wind: { ...DEFAULT_WIND },
    terrain: { cols: 1, rows: 1, cell: 40, cells: '~', ecology: { version: 1, seed } },
  };
}
const angleGap = (a: number, b: number) => Math.abs(((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);

describe('scheduled wind fields', () => {
  it('reuses an immutable uniform sample and observes edits, replacements and separate matches', () => {
    const world = map(), first = windAt(world, { x: 0, y: 0 });
    expect(windAt(world, { x: 3000, y: 2000 })).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    world.wind!.direction += Math.PI / 2;
    const turned = windAt(world, { x: 0, y: 0 });
    expect(turned).not.toBe(first);
    expect(turned.x).toBeLessThan(0);
    world.wind!.speed = 0;
    expect(windAt(world, { x: 0, y: 0 }).speed).toBe(0);
    world.wind = { direction: 0, speed: 40 };
    expect(getWind(world)).toMatchObject({ direction: 0, speed: 40, x: 40, y: 0 });
    expect(getWind(map())).toEqual(first);
    delete world.wind;
    expect(getWind(world)).toEqual(first);
  });

  it('keeps an authored field until exactly eight simulation minutes and changes it again at sixteen', () => {
    expect(interval).toBe(9600);
    const world = map();
    world.wind = { direction: -.73, speed: 37 };
    const initial = world.wind;
    expect(updateWindField(world, interval - 1)).toBe(false);
    expect(world.wind).toBe(initial);
    expect(updateWindField(world, interval)).toBe(true);
    const first = world.wind!;
    expect(first).not.toBe(initial);
    expect(first.changedAtTick).toBe(9600);
    expect(first.fromDirection).toBeCloseTo(initial.direction);
    expect(first.fromSpeed).toBe(37);
    expect(angleGap(first.direction, initial.direction)).toBeGreaterThan(Math.PI / 4);
    expect(updateWindField(world, interval * 2 - 1)).toBe(false);
    expect(world.wind).toBe(first);
    expect(updateWindField(world, interval * 2)).toBe(true);
    expect(world.wind!.changedAtTick).toBe(19200);
    expect(world.wind!.fromDirection).toBeCloseTo(first.direction);
    expect(world.wind!.fromSpeed).toBe(first.speed);
    expect(world.wind!.direction).not.toBe(first.direction);
  });

  it('has no side effects between boundaries or on repeated, fractional or backward ticks', () => {
    const world = map();
    expect(updateWindField(world, interval)).toBe(true);
    const changed = world.wind;
    for (const tick of [interval, interval, interval + 1, interval + 499, interval - 1,
      interval - .5, interval + .5, 0, -interval, NaN, Infinity]) {
      expect(updateWindField(world, tick)).toBe(false);
      expect(world.wind).toBe(changed);
    }
    updateWindField(world, interval * 2);
    const next = world.wind;
    expect(updateWindField(world, interval)).toBe(false);
    expect(world.wind).toBe(next);
  });

  it('restores an identical bounded weather sequence, independently of extra sampling and update calls', () => {
    const uninterrupted = map(), otherSeed = map('other-weather');
    let restored = map();
    const sequence: string[] = [], otherSequence: string[] = [];
    const strengths = new Set<number>();
    for (let round = 1; round <= 24; round++) {
      const tick = interval * round, old = getWind(uninterrupted);
      updateWindField(uninterrupted, tick);
      updateWindField(restored, tick);
      updateWindField(otherSeed, tick);
      expect(restored.wind).toEqual(uninterrupted.wind);
      const actual = getWind(uninterrupted), turn = angleGap(old.direction, actual.direction);
      expect(turn).toBeGreaterThanOrEqual(Math.PI / 4);
      expect(turn).toBeLessThan(Math.PI * .75);
      expect(actual.speed).toBeGreaterThanOrEqual(40);
      expect(actual.speed).toBeLessThanOrEqual(80);
      strengths.add(actual.speed); sequence.push(actual.key); otherSequence.push(getWind(otherSeed).key);
      for (const point of [{ x: 0, y: 0 }, { x: 4000, y: 3000 }, { x: 139.7, y: 826.9 }]) {
        expect(windAt(restored, point)).toEqual(actual);
      }
      updateWindField(restored, tick); updateWindField(restored, tick + 211);
      restored = JSON.parse(JSON.stringify(restored));
    }
    expect(sequence).not.toEqual(otherSequence);
    expect(new Set(sequence).size).toBeGreaterThan(8);
    expect(strengths.size).toBeGreaterThan(1);
  });

  it('uses the same default and current field at every sampled world location', () => {
    expect(windAt({}, { x: 240, y: 750 })).toEqual(getWind({ wind: DEFAULT_WIND }));
    const world = map(), before = JSON.stringify(world);
    const sample = windAt(world, { x: 123, y: 456 });
    expect(sample.x).toBeCloseTo(DEFAULT_WIND.speed / Math.sqrt(2));
    expect(sample.y).toBeCloseTo(DEFAULT_WIND.speed / Math.sqrt(2));
    expect(angleGap(sample.from, sample.direction)).toBeCloseTo(Math.PI);
    expect(JSON.stringify(world)).toBe(before);
    expect(windAt({ wind: { direction: NaN, speed: -30 } }, { x: 123, y: 456 }).speed).toBe(0);
  });
});
