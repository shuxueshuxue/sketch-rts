import { expect, it } from 'vitest';
import { routeLeavesDisks } from './route-selection';

const disk = { x: 0, y: 0, radius: 1 };

it('admits an outside detour and rejects a road through coverage', () => {
  expect(routeLeavesDisks([{ x: -3, y: 0 }, { x: -3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 0 }], [disk])).toBe(true);
  expect(routeLeavesDisks([{ x: -3, y: 0 }, { x: 3, y: 0 }], [disk])).toBe(false);
});

it('admits outward escape, including from the center and boundary', () => {
  expect(routeLeavesDisks([{ x: .5, y: 0 }, { x: 1.5, y: 0 }, { x: 3, y: 0 }], [disk])).toBe(true);
  expect(routeLeavesDisks([{ x: 0, y: 0 }, { x: 2, y: 0 }], [disk])).toBe(true);
  expect(routeLeavesDisks([{ x: 1, y: 0 }, { x: 2, y: 0 }], [disk])).toBe(true);
});

it('rejects inward travel before escape and reentry after escape', () => {
  expect(routeLeavesDisks([{ x: .5, y: 0 }, { x: .2, y: 0 }, { x: 3, y: 0 }], [disk])).toBe(false);
  expect(routeLeavesDisks([{ x: .5, y: 0 }, { x: 2, y: 0 }, { x: -2, y: 0 }], [disk])).toBe(false);
});

it('keeps other coverage forbidden during escape', () => {
  expect(routeLeavesDisks([{ x: .5, y: 0 }, { x: 5, y: 0 }], [disk, { x: 3, y: 0, radius: .5 }])).toBe(false);
});

it('requires an escape route to finish outside its initial coverage', () => {
  expect(routeLeavesDisks([{ x: 0, y: 0 }, { x: .4, y: 0 }], [disk])).toBe(false);
  expect(routeLeavesDisks([{ x: 0, y: 0 }], [disk])).toBe(false);
  expect(routeLeavesDisks([{ x: 2, y: 0 }], [disk])).toBe(true);
});

it('rejects outside tangency rather than claiming it misses attack range', () => {
  expect(routeLeavesDisks([{ x: -2, y: 1 }, { x: 2, y: 1 }], [disk])).toBe(false);
});
