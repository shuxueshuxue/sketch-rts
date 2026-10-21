import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import { strategyIsOpponent, strategyTeamOptions } from './ownership';
import { seaIdAt } from './regions';
import { assessVoyageRisks } from './voyage-risk';
import { assessAllocatedCampEngagement, targetEnemyReinforcements } from './allocated-force';

type Frame = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
for (const name of ['ordinary-gullIsland-1500', 'ordinary-sapphireArchipelago-4510'])
  frames[name] = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const baselineTeams: { frames: Record<string, Frame> } = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/team-relation-frames.json.gz', import.meta.url))).toString());
Object.assign(frames, baselineTeams.frames);
const teamed = Object.entries(frames).filter(([, frame]) => Object.entries(frame.snapshot.teams ?? {})
  .some(([owner, team]) => owner !== frame.owner && team === frame.snapshot.teams?.[frame.owner]));

describe('strategy relations in real team rooms', () => {
  it('covers every active seat in all six team configurations from the eleven-map baseline', () => {
    expect(Object.keys(baselineTeams.frames)).toHaveLength(26);
    expect(new Set(Object.values(baselineTeams.frames).map(frame => frame.snapshot.map.id)).size).toBe(6);
  });
  it('takes an explicit room relation before the snapshot and retains native FFA without teams', () => {
    const frame = structuredClone(teamed[0]![1]);
    const ally = Object.keys(frame.snapshot.teams!).find(owner => owner !== frame.owner
      && frame.snapshot.teams![owner] === frame.snapshot.teams![frame.owner])!;
    expect(strategyIsOpponent(frame.snapshot, frame.owner, ally)).toBe(false);
    expect(strategyIsOpponent(frame.snapshot, frame.owner, ally, { [frame.owner]: 'a', [ally]: 'b' })).toBe(true);
    expect(strategyTeamOptions(frame.snapshot).teams).toEqual(frame.snapshot.teams);
    expect(strategyIsOpponent(frame.snapshot, frame.owner, 'neutral')).toBe(false);
  });

  it.each(teamed)('%s never targets an allied building or prices allied units as intrusion or hull exposure', (_name, source) => {
    const { snapshot, owner, memory } = structuredClone(source);
    const allies = new Set(Object.entries(snapshot.teams!).filter(([other, team]) => other !== owner
      && team === snapshot.teams![owner]).map(([other]) => other));
    const alliedIds = new Set([...snapshot.units, ...snapshot.buildings].filter(unit => allies.has(unit.owner)).map(unit => unit.id));
    const decision = buildStrategyDecision(snapshot, owner, { memory }, undefined, undefined, Infinity);
    for (const objective of decision.objectives.filter(objective => objective.kind === 'AttackSite'))
      expect(alliedIds.has(objective.target.entityId ?? '')).toBe(false);
    for (const attacker of decision.situation.lands.flatMap(land => land.threats).flatMap(threat => threat.attackers))
      expect(alliedIds.has(attacker.unitId)).toBe(false);
    for (const asset of decision.situation.assets.filter(asset => asset.kind === 'mine' && asset.target.landId)) {
      const query = { snapshot, situation: decision.situation, target: asset.target, battleStartTicks: 0, windowTicks: 2400 };
      const reinforcements = targetEnemyReinforcements(query);
      for (const unit of [...reinforcements.onStation, ...reinforcements.arriving.map(entry => entry.unit)]) expect(alliedIds.has(unit.id)).toBe(false);
      for (const id of reinforcements.unknownEnemyIds) expect(alliedIds.has(id)).toBe(false);
      const engagement = assessAllocatedCampEngagement({ ...query, unitIds: [] });
      for (const id of [...engagement.onStationEnemyIds, ...engagement.enRouteEnemyIds, ...engagement.unknownEnemyIds])
        expect(alliedIds.has(id)).toBe(false);
    }
    const ship = snapshot.units.find(unit => unit.owner === owner && unit.kind === 'transport' && seaIdAt(snapshot.map, unit));
    if (ship) {
      const result = assessVoyageRisks(snapshot, owner, [{ id: 'team-invariant', shipId: ship.id,
        seaId: seaIdAt(snapshot.map, ship)!, destination: { x: ship.x, y: ship.y } }],
      { version: 1, owner, tick: -1, routeIds: [], entries: [] });
      for (const id of result.results.get('team-invariant')!.threatIds) expect(alliedIds.has(id)).toBe(false);
    }
  }, 60000);

  it('keeps direct policy enemy comparisons behind the single strategy adapter', () => {
    const root = new URL('./', import.meta.url), violations: string[] = [];
    const visit = (at: URL, relative = '') => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const path = relative + entry.name;
        if (entry.isDirectory()) visit(new URL(`${entry.name}/`, at), `${path}/`);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && path !== 'ownership.ts'
          && /\b(?:isOpponentOwner|isEnemyOwner)\s*\(|\barmedFoes\s*\([^;]*,\s*\{\s*\}\s*\)/.test(readFileSync(new URL(entry.name, at), 'utf8'))) violations.push(path);
      }
    };
    visit(root); expect(violations).toEqual([]);
  });
});
