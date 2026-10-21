import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { calibratedCasualties } from './focused-casualties';
import { casualtyUnitValues } from './allocated-unit-values';
import { voyageCostAfterPreservedAssets } from './allocated-voyage-value';
import { transportExpectedLoss, type VoyageRisk } from './voyage-risk';
import { assertUnitValueSides } from './unit-value-ledger';

it('identifies exactly the existing permanent casualty model losses without pricing wounds', () => {
  const snapshot = snapshotGame(sketchScene('catalog-casualty-identities').map('bareDuel').replaceDefaults()
    .player('us').unit('us', 'footman', 1200, 1200, { id: 'wounded', hp: 20 })
    .unit('us', 'worker', 1300, 1200, { id: 'worker', hp: 10 }).build().createGame());
  const wounds = calibratedCasualties(snapshot.units, 5);
  expect(casualtyUnitValues(snapshot.units, wounds.permanentDeadUnitIds)).toEqual([]);
  const dead = calibratedCasualties(snapshot.units, 30), values = casualtyUnitValues(snapshot.units, dead.permanentDeadUnitIds);
  expect(values.map(entry => entry.unitId)).toEqual(['worker', 'wounded']);
  expect(values.reduce((sum, entry) => sum + entry.valueGold, 0)).toBe(dead.expectedLossGold);
});

it('charges rescue survival once while retaining the hull and unrelated passenger loss', () => {
  const snapshot = snapshotGame(sketchScene('catalog-rescue-survival').map('bareDuel').replaceDefaults()
    .player('us').unit('us', 'transport', 1000, 2000, { id: 'ferry' })
    .unit('us', 'worker', 1200, 2000, { id: 'rescued-worker' })
    .unit('us', 'footman', 1250, 2000, { id: 'other-passenger' }).build().createGame());
  const safe: VoyageRisk = { status: 'known', survivalProbability: 1, expectedDamage: 0, expectedHpLoss: 0,
    damageErrorBound: 0, samples: 0, totalSamples: 0, computedTick: snapshot.tick, basis: 'native-route-exposure', threatIds: [] };
  const stages = { approach: safe, loaded: { ...safe, survivalProbability: .8 } };
  const loss = transportExpectedLoss({ snapshot, shipId: 'ferry', boardingPassengerIds: ['rescued-worker', 'other-passenger'],
    shipResidualGold: 240, stages });
  expect(loss.status).toBe('known'); if (loss.status !== 'known') return;
  const wave = { expectedLossGold: loss.expectedLossGold, passengerLosses: loss.passengerLosses,
    catalogUnitValues: [{ unitId: 'ferry', valueGold: loss.hullLossGold }, ...loss.passengerLosses] };
  const benefit = [{ catalogUnitValues: [{ unitId: 'rescued-worker', valueGold: 75 }] }];
  expect(() => assertUnitValueSides({ benefit, cost: [wave] })).toThrow('both benefit and loss: rescued-worker');
  const cost = voyageCostAfterPreservedAssets([wave], new Set(['rescued-worker']));
  expect(cost.expectedLossGold).toBeCloseTo(.2 * (240 + 100));
  expect(cost.catalogUnitValues.map(entry => entry.unitId)).toEqual(['ferry', 'other-passenger']);
  expect(() => assertUnitValueSides({ benefit, cost: [cost] })).not.toThrow();
  // Without hull/cargo, the saved worker contributes 75*.8=60, never 45.
  const personOnly = { expectedLossGold: .2 * 75, passengerLosses: loss.passengerLosses.filter(entry => entry.unitId === 'rescued-worker'),
    catalogUnitValues: loss.passengerLosses.filter(entry => entry.unitId === 'rescued-worker') };
  expect(75 * .8 - voyageCostAfterPreservedAssets([personOnly], new Set(['rescued-worker'])).expectedLossGold).toBeCloseTo(60);
});
