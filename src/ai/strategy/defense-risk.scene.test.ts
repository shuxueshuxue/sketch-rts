import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { landIdAt } from './regions';
import { createThreatIntentQuery } from './threat-intent';
import { defenseProtectionValue, defenseThreatScenarios, redirectProbability } from './defense-risk';
import type { SiteThreat } from './types';

const original: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
  new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases.find((frame: { event: string }) => frame.event === 'E01');
const front = 'building-p0-townHall-1166', home = 'building-p0-townhall';
function input(snapshot = structuredClone(original.snapshot)) {
  const sites = snapshot.buildings.filter(building => building.owner === original.owner && building.kind === 'townHall')
    .map(building => ({ id: building.id, target: { entityId: building.id,
      landId: landIdAt(snapshot.map, building)!, point: { x: building.x, y: building.y } } }));
  return { snapshot, sites, intent: createThreatIntentQuery(snapshot, original.owner, sites) };
}

describe('actual and redirect risk at the E01 two-hall raid', () => {
  it('assigns the native forward attack once and preserves the alternative main-hall route', () => {
    const { snapshot, sites, intent } = input();
    const enemies = snapshot.units.filter(unit => unit.owner === 'p1');
    const direct = enemies.filter(unit => intent(unit, front).kind === 'actual-intrusion');
    expect(direct).toHaveLength(8);
    expect(enemies.filter(unit => intent(unit, home).kind === 'actual-intrusion')).toEqual([]);
    for (const unit of direct) {
      expect(intent(unit, home)).toMatchObject({ kind: 'potential-redirect', actualSiteId: front,
        redirectGroupId: `site:${front}` });
      expect(sites.filter(site => intent(unit, site.id).kind === 'actual-intrusion')).toHaveLength(1);
    }
    expect(enemies.some(unit => unit.order.type === 'move' && unit.order.avoidCombat
      && intent(unit, front).kind === 'potential-redirect')).toBe(true);
    const restored = input(JSON.parse(JSON.stringify(snapshot)));
    expect(JSON.stringify(enemies.map(unit => sites.map(site => intent(unit, site.id)))))
      .toBe(JSON.stringify(enemies.map(unit => sites.map(site => restored.intent(unit, site.id)))));
  });

  it('uses mutually exclusive redirects rather than charging the whole enemy army twice', () => {
    const { snapshot, intent } = input();
    const direct = snapshot.units.filter(unit => unit.owner === 'p1' && intent(unit, front).kind === 'actual-intrusion');
    const threat: SiteThreat = { siteId: home, horizonTicks: 900,
      attackers: direct.map(unit => ({ unitId: unit.id, strength: 1, intent: intent(unit, home),
        arrival: { status: 'reachable', ticks: 300, landTicks: 300, crossings: [], evidence: [] } })),
      arrivedStrength: 0, incomingStrength: direct.length, friendlyOnStationStrength: 0,
      firstArrivalTicks: 300, lossProbability: 1, evidence: [] };
    const assessed = defenseThreatScenarios(threat, { status: 'known', ticks: 150 });
    expect(assessed.status).toBe('known');
    expect(assessed.actualIds).toEqual([]);
    expect(assessed.redirects).toHaveLength(1);
    expect(assessed.scenarios.map(({ probability: _probability, ...scenario }) => scenario)).toEqual([
      { force: 0, unitIds: [] },
      { force: direct.length, unitIds: direct.map(unit => unit.id).sort() },
    ]);
    expect(assessed.scenarios[0]!.probability).toBeCloseTo(2 / 3);
    expect(assessed.scenarios[1]!.probability).toBeCloseTo(1 / 3);
    expect(assessed.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0)).toBeCloseTo(1);
    expect(defenseThreatScenarios(threat, { status: 'unknown' }).status).toBe('unknown');
    const forFront = { ...threat, siteId: front, attackers: threat.attackers.map(attacker => ({ ...attacker,
      intent: intent({ id: attacker.unitId }, front) })) };
    expect(defenseThreatScenarios(forFront, { status: 'known', ticks: 150 }).scenarios)
      .toEqual([{ probability: 1, force: direct.length, unitIds: direct.map(unit => unit.id).sort() }]);
    const potential = defenseProtectionValue({ threat: assessed, assetValueGold: 900, cohortForce: 12, staticForce: 0 })!;
    const actual = defenseProtectionValue({ threat: defenseThreatScenarios(forFront, { status: 'known', ticks: 150 }),
      assetValueGold: 900, cohortForce: 12, staticForce: 0 })!;
    expect(potential.grossGold).toBeCloseTo(actual.grossGold / 3);
    expect(potential.benefitGold).toBeCloseTo(300);
    expect(actual.benefitGold).toBe(900);
    expect(defenseProtectionValue({ threat: assessed, assetValueGold: 900, cohortForce: 0, staticForce: 3 })!.grossGold).toBe(0);
  });

  it('increases redirect risk when the enemy wins the arrival race without unit or map parameters', () => {
    expect(redirectProbability(300, { status: 'known', ticks: 150 })).toBeCloseTo(1 / 3);
    expect(redirectProbability(150, { status: 'known', ticks: 150 })).toBe(.5);
    expect(redirectProbability(75, { status: 'known', ticks: 150 })).toBeCloseTo(2 / 3);
    expect(redirectProbability(75, { status: 'known', ticks: 0 })).toBe(0);
    expect(redirectProbability(75, { status: 'none' })).toBe(1);
    expect(redirectProbability(75, { status: 'unknown' })).toBeNull();
    expect(redirectProbability(Number.MAX_VALUE, { status: 'known', ticks: Number.MAX_VALUE })).toBe(.5);
    expect(() => redirectProbability(-1, { status: 'none' })).toThrow(/Invalid/);
  });
});
