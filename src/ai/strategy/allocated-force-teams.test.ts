import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { AiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import { assessPresentCampEngagement, targetCoveringTowers, targetEnemyReinforcements } from './allocated-force';
import { landIdAt } from './regions';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import type { ExecutorInput } from './allocation-types';
import { evacuateExecutor } from './executors/evacuate';
import { observeWorkerSafetyInterruption } from './executors/worker-safety';

type Frame = { owner: string; snapshot: GameSnapshot; memory: AiPolicyMemory };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL(
  '../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
const ordinary: Frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/team-sapphire-4510.json.gz', import.meta.url))).toString());
const cases = [...Object.entries(frames), ['ordinary-sapphire-4510', ordinary] as const].filter(([, frame]) => {
  const teams = frame.snapshot.teams, own = teams?.[frame.owner];
  return own !== undefined && Object.entries(teams!).some(([owner, team]) => owner !== frame.owner && team === own);
});

describe('shared battle facts in real room alliances', () => {
  it.each(cases)('%s never puts allied soldiers or towers into an opponent pool', (_name, source) => {
    const { snapshot, owner, memory } = structuredClone(source), teams = snapshot.teams!;
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const allies = new Set(Object.keys(teams).filter(candidate => candidate !== owner && teams[candidate] === teams[owner]));
    const alliedUnits = snapshot.units.filter(unit => allies.has(unit.owner) && unit.hp > 0 && unit.attackDamage > 0
      && !unit.deck && !unit.cabin && landIdAt(snapshot.map, unit));
    const alliedTowers = snapshot.buildings.filter(building => allies.has(building.owner) && building.complete && building.hp > 0 && building.attackDamage > 0);
    expect(alliedUnits.length + alliedTowers.length).toBeGreaterThan(0);
    const situation = buildStrategyDecision(snapshot, owner, { memory }, undefined, undefined, Infinity).situation;
    const forbidden = new Set([...alliedUnits, ...alliedTowers].map(entity => entity.id));
    for (const entity of [...alliedUnits, ...alliedTowers]) {
      const landId = landIdAt(snapshot.map, entity);
      if (!landId) continue;
      const target = { entityId: entity.id, landId, point: { x: entity.x, y: entity.y } };
      const response = targetEnemyReinforcements({ snapshot, situation, target, battleStartTicks: 0, windowTicks: 2400 });
      expect(response.candidateEnemies.some(unit => forbidden.has(unit.id))).toBe(false);
      expect([...response.unknownEnemyIds, ...response.onStation.map(unit => unit.id), ...response.arriving.map(entry => entry.unit.id)]
        .some(id => forbidden.has(id))).toBe(false);
      expect(targetCoveringTowers(snapshot, owner, target, 'opponent').some(tower => forbidden.has(tower.id))).toBe(false);
      expect(targetCoveringTowers(snapshot, owner, target, 'own').every(tower => tower.owner === owner)).toBe(true);
      const present = assessPresentCampEngagement({ snapshot, owner, target,
        unitIds: snapshot.units.filter(unit => unit.owner === owner).map(unit => unit.id), campMemberIds: [] });
      expect([...present.hostile, ...present.towers].some(unit => forbidden.has(unit.id))).toBe(false);
      expect(present.ours.every(unit => unit.owner === owner)).toBe(true);
    }
  }, 30000);

  it('does not interrupt a real native worker order or block its evacuation because of an allied tower', () => {
    const snapshot = snapshotGame(sketchScene('allied-tower-evacuation').map('bareDuel').replaceDefaults()
      .player('us', { team: 'home' }).player('ally', { team: 'home' })
      .building('us', 'townHall', 2100, 1500, { id: 'shelter' })
      .building('ally', 'defenseTower', 1750, 1580, { id: 'allied-tower' })
      .unit('us', 'worker', 1500, 1500, { id: 'worker', order: { type: 'move', x: 2100, y: 1500 } }).build().createGame());
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const worker = snapshot.units.find(unit => unit.id === 'worker')!, target = { entityId: 'shelter', point: { x: 2100, y: 1500 } };
    const action = { actionId: 'evacuate-worker', generation: 1 }, objectiveId = 'evacuate', methodId = 'evacuate/method';
    const command = { type: 'move' as const, unitIds: [worker.id], x: 2100, y: 1500 };
    const input: ExecutorInput = { snapshot, owner: 'us', objective: { id: objectiveId, kind: 'Evacuate', owner: 'us', target,
      effects: [{ kind: 'assets-evacuated', unitIds: [worker.id], destination: target }],
      utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
      status: 'active', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [methodId],
      stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } },
      method: { id: methodId, objectiveId, kind: 'evacuation', preconditions: [], subgoals: [], demands: [],
        estimatedTicks: 200, status: 'selected', reasons: [] },
      execution: { token: action, objectiveId, methodId, executor: 'strategy.evacuate', intent: { kind: 'evacuate' }, target,
        dependsOn: [], completionEffects: [], status: 'active', phase: 'evacuating', sinceTick: snapshot.tick,
        lastProgressTick: snapshot.tick, state: {} },
      grant: { revision: 1, action, objectiveId, methodId,
        leases: [{ id: 'lease:worker', resourceKey: 'unit:worker', objectiveId, methodId, action,
          sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick, origin: 'allocator', incumbentTask: null }],
        assignments: [], budgets: [], voyages: [], orderOverrides: [],
        orders: [{ unitId: worker.id, action, executor: 'strategy.evacuate', purpose: 'task', acceptedTick: snapshot.tick,
          commandId: 'accepted:move', observedTick: snapshot.tick, observedOrder: worker.order }],
        commands: [{ id: 'accepted:move', action, executor: 'strategy.evacuate', purpose: 'task', acceptedTick: snapshot.tick, command }] }, events: [] };
    expect(observeWorkerSafetyInterruption(input)).toBeNull();
    const result = evacuateExecutor.execute(input);
    expect(result.status).toBe('active');
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.command.type).toBe('move');
  });
});
