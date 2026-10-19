import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { castThreatReach, mountedThreatReach } from './threat-reach';

function field() {
  const game = sketchScene('threat-reach-boundaries').map('bareDuel').replaceDefaults()
    .player('us').player('foe')
    .unit('us', 'footman', 600, 200, { id: 'patient' })
    .unit('foe', 'knight', 200, 200, { id: 'charger' })
    .unit('foe', 'witch', 200, 400, { id: 'witch' })
    .unit('foe', 'priest', 200, 600, { id: 'healer' })
    .unit('foe', 'footman', 200, 800, { id: 'carrier' })
    .item('rod', 'lightningRod', 0, 0, { carrierId: 'carrier', cooldownRemaining: 20 })
    .item('staff', 'stormStaff', 0, 0, { carrierId: 'carrier', cooldownRemaining: 21 })
    .build().createGame();
  game.units.find(unit => unit.id === 'charger')!.abilityCooldowns = { charge: 20 };
  game.units.find(unit => unit.id === 'witch')!.abilityCooldowns = { curse: 17 };
  const snapshot = snapshotGame(game);
  const unit = (id: string) => snapshot.units.find(unit => unit.id === id)!;
  return { snapshot, unit, patient: unit('patient') };
}

it('keeps the charge cooldown and minimum-distance boundaries distinct from melee reach', () => {
  const { snapshot, unit, patient } = field(), foe = unit('charger');
  expect(castThreatReach(snapshot, foe, patient, 19)).toBe(0);
  expect(mountedThreatReach(snapshot, foe, patient, 19)).toBe(foe.attackRange + foe.radius + patient.radius);
  expect(castThreatReach(snapshot, foe, patient, 20)).toBe(300);
  expect(mountedThreatReach(snapshot, foe, { ...patient, x: 300 }, 20)).toBe(foe.attackRange);
  expect(castThreatReach(snapshot, foe, { ...patient, x: 300 }, 20)).toBe(0);
  expect(castThreatReach(snapshot, foe, { ...patient, x: 380 }, 20)).toBe(300);
});

it('counts offensive spells when ready and excludes healing from striking reach', () => {
  const { snapshot, unit, patient } = field();
  expect(castThreatReach(snapshot, unit('witch'), patient, 16)).toBe(0);
  expect(castThreatReach(snapshot, unit('witch'), patient, 17)).toBe(280);
  expect(castThreatReach(snapshot, unit('healer'), patient, 1000)).toBe(0);
});

it.each([
  { owner: 'foe', horizon: 19, reach: 0 },
  { owner: 'foe', horizon: 20, reach: 280 },
  { owner: 'foe', horizon: 21, reach: 320 },
  { owner: 'neutral', horizon: 20, reach: 240 },
  { owner: 'neutral', horizon: 21, reach: 280 },
])('uses the strongest ready item with $owner ranges at horizon $horizon', ({ owner, horizon, reach }) => {
  const { snapshot, unit, patient } = field();
  expect(castThreatReach(snapshot, { ...unit('carrier'), owner }, patient, horizon)).toBe(reach);
});
