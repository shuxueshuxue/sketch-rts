import { expect, it } from 'vitest';
import { assertUnitValueSides } from './unit-value-ledger';

it('rejects the same rescued person on both valuation sides without reading prose', () => {
  const saved = { catalogUnitValues: [{ unitId: 'worker', valueGold: 60 }] };
  const hull = { catalogUnitValues: [{ unitId: 'transport', valueGold: 48 }] };
  expect(() => assertUnitValueSides({ benefit: [saved], cost: [hull] })).not.toThrow();
  expect(() => assertUnitValueSides({ benefit: [saved], cost: [hull,
    { catalogUnitValues: [{ unitId: 'worker', valueGold: 15 }] }] })).toThrow('both benefit and loss: worker');
  expect(() => assertUnitValueSides({ benefit: [], cost: [hull,
    { catalogUnitValues: [{ unitId: 'fighter', valueGold: 120 }] }] })).not.toThrow();
  expect(() => assertUnitValueSides({ benefit: [{ catalogUnitValues: [{ unitId: 'worker', valueGold: NaN }] }], cost: [] })).toThrow('Invalid');
});
