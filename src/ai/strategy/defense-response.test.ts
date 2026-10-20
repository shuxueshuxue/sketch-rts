import { describe, expect, it } from 'vitest';
import { createBuilding, createUnit } from '../../shared/map';
import { createGame } from '../../shared/sim';
import { creepForce } from '../policy/v7/creep';
import { structureRating } from '../policy/v6/strength';
import { assessDefenseResponse } from './defense-response';
import type { Situation, SituationUnit } from './types';

const target = { entityId: 'hall', landId: 'land:1' as const, point: { x: 1000, y: 1000 } };
function fixture() {
  const snapshot = createGame('bareDuel', { aiPlayers: [] });
  snapshot.buildings = [createBuilding('hall', 'player', 'townHall', 1000, 1000, true)]; snapshot.units = [];
  const unit = (id: string, force: number, ticks: number | null): SituationUnit => ({
    id, owner: 'player', kind: 'footman', hp: 100, maxHp: 100, strength: force, roles: ['frontline'], expiresTick: null,
    commitments: [], location: { kind: 'land', landId: 'land:1', point: target.point },
    arrivals: [{ targetId: 'post', arrival: ticks === null ? { status: 'unknown', reason: { code: 'pending', detail: '', evidence: [] } }
      : { status: 'reachable', ticks, landTicks: ticks, crossings: [], evidence: [] } }],
  });
  const situation: Situation = { tick: snapshot.tick, owner: 'player', horizonTicks: 900, lands: [], seas: [], assets: [], opportunities: [],
    units: [unit('priced', 10, 0), unit('scout', .1, 1), unit('other-1', 1, 100), unit('other-2', 1, 300)],
    economy: { cashGold: 0, predictedIncomeGold: 0, horizonTicks: 900, ledger: [] }, limitations: [] };
  const input = { snapshot, situation, target, arrivalTargetId: 'post', eligibleUnitIds: situation.units.map(unit => unit.id),
    excludedUnitIds: ['priced'], actualMobileOpponentForce: 2, windowTicks: 900 };
  return { input, unit };
}

describe('same-window defense response without the priced cohort', () => {
  it('uses camp currency and native static protection when explicitly requested', () => {
    const { input, unit } = fixture();
    const a = createUnit('other-1', 'player', 'footman', 1000, 1000);
    const b = createUnit('other-2', 'player', 'footman', 1000, 1000);
    input.snapshot.units = [a, b];
    const tower = createBuilding('cover', 'player', 'defenseTower', 800, 1000, true);
    input.snapshot.buildings.push(tower);
    const situation = { ...input.situation, units: [unit(a.id, 99999, 100), unit(b.id, 99999, 300)] };
    const required = structureRating(tower) + creepForce([a]) * 1.5;
    const value = assessDefenseResponse({ ...input, situation, metric: 'camp-force', actualMobileOpponentForce: required });
    expect(value.staticForce).toBe(structureRating(tower));
    expect(value.response).toEqual({ status: 'known', ticks: 300 });
    expect(value.responseForce).toBeCloseTo(structureRating(tower) + creepForce([a, b]));
  });
  it('waits for an adequate other group instead of counting the priced defender or the first fast scout', () => {
    const { input } = fixture();
    const response = assessDefenseResponse(input);
    expect(response.response).toEqual({ status: 'known', ticks: 300 });
    expect(response.responseUnitIds).not.toContain('priced');
    expect(assessDefenseResponse({ ...input, eligibleUnitIds: ['priced', 'scout'] }).response).toEqual({ status: 'none' });
  });

  it('retains unresolved response ETA and respects temporary troops expiring before arrival', () => {
    const { input, unit } = fixture();
    expect(assessDefenseResponse({ ...input, situation: { ...input.situation, units: [unit('unknown', 3, null)] }, eligibleUnitIds: ['unknown'] }).response).toEqual({ status: 'unknown' });
    expect(assessDefenseResponse({ ...input, situation: { ...input.situation, units: [{ ...unit('expires', 3, 100), expiresTick: input.snapshot.tick + 50 }] }, eligibleUnitIds: ['expires'] }).response).toEqual({ status: 'none' });
  });

  it('uses actual building strike surfaces for both friendly protection and hostile tower demand', () => {
    const { input } = fixture();
    const own = createBuilding('cover', 'player', 'defenseTower', 800, 1000, true);
    const hostile = createBuilding('hostile', 'enemy', 'defenseTower', 1400, 1000, true); hostile.attackRange = 360;
    input.snapshot.buildings.push(own, hostile);
    const response = assessDefenseResponse({ ...input, actualMobileOpponentForce: 1 });
    expect(response.ownTowerIds).toEqual(['cover']); expect(response.hostileTowerIds).toEqual(['hostile']);
    expect(response.staticForce).toBe(1.3); expect(response.requiredForce).toBe(2.3);
    expect(response.response).toEqual({ status: 'known', ticks: 100 });
    expect(assessDefenseResponse({ ...input, actualMobileOpponentForce: 1, eligibleUnitIds: [] }).response).toEqual({ status: 'none' });
  });
});
