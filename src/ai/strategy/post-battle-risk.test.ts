import { describe, expect, it } from 'vitest';
import { createBuilding, createUnit } from '../../shared/map';
import { createGame } from '../../shared/sim';
import { assessPostBattleSiteRisk } from './allocated-force';
import { assetSurvivalProbability } from './utility';
import type { Situation, Target } from './types';

function fixture() {
  const snapshot = createGame('bareDuel', { aiPlayers: [] });
  snapshot.units = [createUnit('remote-army', 'enemy', 'footman', 3000, 1000)];
  snapshot.units[0]!.order = { type: 'hold', x: 3000, y: 1000 };
  snapshot.buildings = [createBuilding('hall', 'player', 'townHall', 1000, 1000, true)];
  const target: Target = { entityId: 'hall', landId: 'land:1', point: { x: 1000, y: 1000 } };
  const enemy = snapshot.units[0]!;
  const situation: Situation = { tick: snapshot.tick, owner: 'player', horizonTicks: 2400, lands: [], seas: [], assets: [], opportunities: [],
    economy: { cashGold: 0, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] }, limitations: [],
    units: [{ id: enemy.id, owner: enemy.owner, kind: enemy.kind, hp: enemy.hp, maxHp: enemy.maxHp, strength: 99999,
      location: { kind: 'land', landId: 'land:1', point: enemy }, roles: ['frontline'], commitments: [], expiresTick: null,
      arrivals: [{ targetId: 'hall', arrival: { status: 'reachable', ticks: 900, landTicks: 900, crossings: [], evidence: [] } }] }] };
  return { snapshot, situation, target, battleStartTicks: 100, windowTicks: 2400, excludedEnemyIds: [],
    survivingPermanentCampForce: 2, plannedAssetRadius: snapshot.buildings[0]!.radius };
}

describe('post-battle actual intrusions and potential redirects', () => {
  it('prices a remote hold group as real mutually exclusive armies, not a certain arrival or average army', () => {
    const input = fixture(), before = JSON.stringify(input);
    const value = assessPostBattleSiteRisk({ ...input, response: { status: 'known', ticks: 100 } });
    expect(value.status).toBe('known'); expect(value.scenarios.actualIds).toEqual([]);
    expect(value.scenarios.redirects[0]!.probability).toBeCloseTo(.1, 12);
    const expected = value.scenarios.scenarios.reduce((sum, scenario) => sum + scenario.probability
      * assetSurvivalProbability({ status: 'known', ourForce: value.ownForce, opponentForce: scenario.force })!, 0);
    expect(value.survivalProbability).toBe(expected);
    const averagedForce = value.scenarios.scenarios.reduce((sum, scenario) => sum + scenario.probability * scenario.force, 0);
    expect(value.survivalProbability).not.toBeCloseTo(assetSurvivalProbability({ status: 'known', ourForce: value.ownForce,
      opponentForce: averagedForce })!, 8);
    expect(assessPostBattleSiteRisk(input).status).toBe('unknown');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps an actual attack at full force and preserves explicit absence of other response', () => {
    const input = fixture();
    input.snapshot.units[0]!.order = { type: 'attack', targetId: 'hall' };
    const actual = assessPostBattleSiteRisk(input);
    expect(actual.status).toBe('known'); expect(actual.scenarios.actualIds).toEqual(['remote-army']);
    expect(actual.scenarios.redirects).toEqual([]);
    expect(actual.survivalProbability).toBe(assetSurvivalProbability({ status: 'known', ourForce: actual.ownForce, opponentForce: actual.opponentForce }));
    input.snapshot.units[0]!.order = { type: 'hold', x: 3000, y: 1000 };
    const noResponse = assessPostBattleSiteRisk({ ...input, response: { status: 'none' } });
    expect(noResponse.scenarios.redirects[0]!.probability).toBe(1);
    expect(noResponse.survivalProbability).toBe(actual.survivalProbability);
  });

  it('does not retain enemies conditionally defeated in the first battle and reproduces serialized inputs', () => {
    const input = fixture(), noEnemies = { ...input, excludedEnemyIds: ['remote-army'] };
    expect(assessPostBattleSiteRisk(noEnemies)).toMatchObject({ status: 'known', survivalProbability: 1, memberIds: [] });
    expect(assessPostBattleSiteRisk(JSON.parse(JSON.stringify(input)))).toEqual(assessPostBattleSiteRisk(input));
  });
});
