import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { evaluateSituation } from './situation';
import { decisionProjection } from './explanations';

type Frame = { event: string; snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory };
const frames: Frame[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
function frame() {
  const value = structuredClone(frames.find(frame => frame.event === 'E01')!);
  setBuildingBodies(value.snapshot.map, standingBodies(value.snapshot)); return value;
}
const evaluate = (input: Frame) => decisionProjection(() => evaluateSituation(input.snapshot, input.owner, input.memory), false).facts;

describe('control facts from the same Situation', () => {
  it('assigns the actual E01 attack to the front mine and leaves the same army a potential main-hall redirect', () => {
    const input = frame(), situation = evaluate(input), threats = situation.lands.flatMap(land => land.threats);
    const forward = threats.find(threat => threat.siteId === 'building-p0-townHall-1166')!;
    const home = threats.find(threat => threat.siteId === 'building-p0-townhall')!;
    expect(forward.attackers.some(attacker => attacker.intent?.kind === 'actual-intrusion')).toBe(true);
    expect(home.attackers.some(attacker => attacker.intent?.kind === 'actual-intrusion')).toBe(false);
    const shared = forward.attackers.filter(attacker => attacker.intent?.kind === 'actual-intrusion'
      && home.attackers.some(other => other.unitId === attacker.unitId));
    expect(shared.length).toBeGreaterThan(0);
    for (const attacker of shared) expect(home.attackers.find(other => other.unitId === attacker.unitId)!.intent)
      .toMatchObject({ kind: 'potential-redirect', actualSiteId: forward.siteId });
    const actualSites = new Map<string, Set<string>>();
    for (const threat of threats) for (const attacker of threat.attackers.filter(attacker => attacker.intent?.kind === 'actual-intrusion')) {
      const sites = actualSites.get(attacker.unitId) ?? new Set(); sites.add(threat.siteId); actualSites.set(attacker.unitId, sites);
    }
    expect([...actualSites.values()].every(sites => sites.size === 1)).toBe(true);
  });

  it('does not count a dispatched miner as current income before its native mining cycle starts', () => {
    const input = frame(), worker = input.snapshot.units.find(unit => unit.owner === input.owner && unit.kind === 'worker'
      && unit.order.type === 'mine')!;
    if (worker.order.type !== 'mine') throw new Error('Missing native E01 miner');
    const resourceId = worker.order.resourceId;
    input.snapshot.units = input.snapshot.units.filter(unit => unit === worker || unit.kind !== 'worker' || unit.owner !== input.owner);
    delete worker.mineSlot;
    worker.order.phase = 'toMine';
    const travelling = evaluate(input).assets.find(asset => asset.id === resourceId)!;
    expect(travelling.incomeGoldPerTick).toBe(0);
    expect(travelling.miningCapacity!.staffedWorkerIds).toEqual([]);
    worker.order.phase = 'gather';
    const arrived = evaluate(input).assets.find(asset => asset.id === resourceId)!;
    expect(arrived.incomeGoldPerTick).toBeGreaterThan(0);
    expect(arrived.miningCapacity!.staffedWorkerIds).toEqual([worker.id]);
    const cold = JSON.parse(JSON.stringify(input)) as Frame;
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(JSON.stringify(evaluate(cold))).toBe(JSON.stringify(evaluate(input)));
  });
});
