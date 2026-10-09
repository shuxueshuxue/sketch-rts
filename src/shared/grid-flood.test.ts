import { describe, expect, it } from 'vitest';
import { GridFlood } from './grid-flood';

describe('map connectivity traversal', () => {
  it('visits breadth-first in the generator’s right-left-down-up order', () => {
    const order: number[] = [-1], tested: number[] = [];
    const result = new GridFlood(3).walk(4, index => { tested.push(index); return true; }, order);
    expect(order).toEqual([-1, 4, 5, 3, 7, 1, 8, 2, 6, 0]);
    expect(tested).not.toContain(4);
    expect(result.count).toBe(9);
    expect([...result.reached]).toEqual(Array(9).fill(1));
  });

  it('keeps diagonal patches and cells across row boundaries disconnected', () => {
    const diagonal = new GridFlood(3).walk(0, index => index === 4);
    expect(diagonal.count).toBe(1);
    expect(diagonal.reached[4]).toBe(0);
    const boundary = new GridFlood(4, 2).walk(3, index => index === 4);
    expect(boundary.count).toBe(1);
    expect(boundary.reached[4]).toBe(0);
  });

  it('retains the original unconditional start cell and resets changed connectivity', () => {
    const flood = new GridFlood(3, 2);
    const first = flood.walk(0, index => index !== 0 && index !== 2);
    expect(first.count).toBe(5);
    expect([...first.reached]).toEqual([1, 1, 0, 1, 1, 1]);
    const next = flood.walk(2, () => false);
    expect(next.reached).toBe(first.reached);
    expect(next.count).toBe(1);
    expect([...next.reached]).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it('keeps a nested predicate traversal from overwriting its outer work', () => {
    const flood = new GridFlood(3);
    let nested = false;
    const order: number[] = [];
    const result = flood.walk(4, () => {
      if (!nested) {
        nested = true;
        const inner = flood.walk(0, () => false);
        expect(inner.count).toBe(1);
        expect([...inner.reached]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
      }
      return true;
    }, order);
    expect(result.count).toBe(9);
    expect(order).toEqual([4, 5, 3, 7, 1, 8, 2, 6, 0]);
    expect([...result.reached]).toEqual(Array(9).fill(1));
  });

  it('can discover a previously rejected cell from a later neighbor', () => {
    let tries = 0;
    const result = new GridFlood(2).walk(0, index => index !== 1 || ++tries === 2);
    expect(tries).toBe(2);
    expect(result.count).toBe(4);
    expect([...result.reached]).toEqual([1, 1, 1, 1]);
  });

  it('releases scratch after a predicate throws', () => {
    const flood = new GridFlood(2);
    const initial = flood.walk(0, () => false).reached;
    expect(() => flood.walk(0, () => { throw new Error('predicate'); })).toThrow('predicate');
    const next = flood.walk(3, () => true);
    expect(next.reached).toBe(initial);
    expect(next.count).toBe(4);
  });
});
