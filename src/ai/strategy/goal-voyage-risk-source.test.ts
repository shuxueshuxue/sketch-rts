import { expect, it } from 'vitest';
import { createBuilding, createUnit } from '../../shared/map';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { planVoyageRoute } from '../../shared/ship-navigation';
import { createGame, snapshotGame } from '../../shared/sim';
import { FactWorkQueue, withFactWork } from './fact-work';
import { boundGoalVoyageRiskPublications, createGoalVoyageRiskReader, retainGoalVoyageRiskPublications,
  type GoalVoyageRiskMemory } from './goal-voyage-risk-source';
import type { StrategyObservationMemory } from './observation-memory';
import { assessVoyageRisks, type VoyageRisk, type VoyageRiskRequest } from './voyage-risk';

it('proves a basin without capable enemies independently of native timing and keeps a capable hazard unknown', () => {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = [createUnit('ferry', 'player', 'transport', 1000, 2000)];
  game.buildings = []; game.items = []; game.obstacles = []; game.resources = [];
  game.map = { ...game.map, width: 20000, height: 10000, terrain: { cols: 200, rows: 100, cell: 100, cells: '~'.repeat(20000) } };
  const request: VoyageRiskRequest = { id: 'connected-sea-time-only', shipId: 'ferry', seaId: 'sea:1', destination: { x: 1256, y: 2000 } };
  const read = () => {
    const snapshot = snapshotGame(game), work = new FactWorkQueue(snapshot.tick, 0, undefined, 1);
    const memory: GoalVoyageRiskMemory = { model: { version: 1, owner: 'player', tick: -1, routeIds: [], entries: [] }, publications: [] };
    const risk = withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => createGoalVoyageRiskReader({ snapshot, owner: 'player', work,
        observation: {} as StrategyObservationMemory, memory })(request)));
    expect(work.receipt.used).toBe(0); return risk;
  };
  expect(read()).toMatchObject({ status: 'known', basis: 'no-capable-basin-enemy', survivalProbability: 1, expectedHpLoss: 0 });
  game.buildings = [createBuilding('tower', 'enemy', 'defenseTower', 1128, 2100, true)];
  expect(read().status).toBe('unknown');
});

it('publishes the unchanged native voyage model through one charged sampling batch and JSON owner-think boundaries', () => {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = [createUnit('ferry', 'player', 'transport', 1000, 2000)];
  game.buildings = [createBuilding('tower', 'enemy', 'defenseTower', 1128, 2100, true)];
  game.items = []; game.obstacles = []; game.resources = [];
  game.map = { ...game.map, width: 20000, height: 10000, wind: { direction: Math.PI, speed: 80 },
    terrain: { cols: 200, rows: 100, cell: 100, cells: '~'.repeat(20000) } };
  game.units[0]!.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  const destination = { x: 1256, y: 2000 };
  const route = planVoyageRoute(game.map, game.units[0]!, destination)!;
  const request: VoyageRiskRequest = { id: 'actual-native-leg', shipId: 'ferry', seaId: 'sea:1', destination, route };
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const expected = assessVoyageRisks(snapshot, 'player', [request], { version: 1, owner: 'player', tick: -1, routeIds: [], entries: [] }).results.get(request.id)!;
  expect(expected.status).toBe('known');
  let memory: GoalVoyageRiskMemory = { model: { version: 1, owner: 'player', tick: -1, routeIds: [], entries: [] }, publications: [] };
  const observation = {} as StrategyObservationMemory;
  let result: VoyageRisk | undefined, sampled = 0;
  for (let sequence = 1; sequence <= 20; sequence++) {
    const work = new FactWorkQueue(snapshot.tick, sequence === 1 ? 0 : 3, undefined, sequence);
    let plans = ['first'];
    const read = createGoalVoyageRiskReader({ snapshot, owner: 'player', work, observation, memory,
      cacheUse: { thinkSequence: sequence, planIds: () => plans } });
    withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => withFactWork(work, () => {
        result = read(request);
        plans = ['second'];
        expect(read(request)).toEqual(result);
        work.flush();
      })));
    if (sequence === 1) expect(memory.publications).toEqual([]);
    else expect(memory.publications.find(entry => entry.id === request.id)?.planIds).toEqual(['first', 'second']);
    expect(work.receipt.used).toBeLessThanOrEqual(sequence === 1 ? 0 : 3);
    expect(work.receipt.services.reduce((sum, service) => sum + service.work, 0)).toBe(work.receipt.used);
    sampled += Math.max(0, work.receipt.used - 1);
    memory = JSON.parse(JSON.stringify(memory));
    if (result!.status === 'known') break;
  }
  expect(result).toEqual(expected);
  expect(sampled).toBeGreaterThan(0);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('retains a plan-referenced publication through LRU pressure and JSON, and evicts it after release', () => {
  const memory: GoalVoyageRiskMemory = {
    model: { version: 1, owner: 'player', tick: -1, routeIds: [], entries: [] },
    publications: [{ id: 'selected-leg', readyTick: 0, readyThink: 1, lastUsedThink: 1, planIds: ['island-plan'] },
      ...Array.from({ length: 128 }, (_, i) => ({ id: `other-${i}`, readyTick: 0, readyThink: 2, lastUsedThink: 2 }))],
  };
  expect(boundGoalVoyageRiskPublications(memory, 2).evicted).toHaveLength(1);
  expect(memory.publications).toHaveLength(128);
  expect(memory.publications.some(entry => entry.id === 'selected-leg')).toBe(true);
  const restored: GoalVoyageRiskMemory = JSON.parse(JSON.stringify(memory));
  retainGoalVoyageRiskPublications(restored, new Map([['island-plan', new Set(['selected-leg'])]]), 3);
  expect(restored.publications.find(entry => entry.id === 'selected-leg')?.planIds).toEqual(['island-plan']);
  retainGoalVoyageRiskPublications(restored, new Map(), 4);
  restored.publications.push({ id: 'new-leg', readyTick: 0, lastUsedThink: 4 });
  expect(boundGoalVoyageRiskPublications(restored, 4).evicted.map(entry => entry.id)).toEqual(['selected-leg']);
  expect(restored.model).toEqual(memory.model);
});

it('keeps an oversized pinned publication set with explicit pressure until its plan drops references', () => {
  const memory: GoalVoyageRiskMemory = {
    model: { version: 1, owner: 'player', tick: -1, routeIds: [], entries: [] },
    publications: Array.from({ length: 129 }, (_, i) => ({ id: `leg-${i}`, readyTick: 0, lastUsedThink: 1, planIds: ['island-plan'] })),
  };
  expect(boundGoalVoyageRiskPublications(memory, 1)).toMatchObject({ evicted: [], capacity: { overflowCount: 1,
    pressure: { kind: 'goal-voyage-publications', entries: 129, limitEntries: 128, planIds: ['island-plan'] } } });
  expect(memory.publications).toHaveLength(129);
  const restored: GoalVoyageRiskMemory = JSON.parse(JSON.stringify(memory));
  boundGoalVoyageRiskPublications(restored, 2);
  expect(restored.publicationCapacity?.overflowCount).toBe(1);
  retainGoalVoyageRiskPublications(restored, new Map([['island-plan', new Set(['leg-0'])]]), 3);
  expect(restored.publications).toHaveLength(128);
  expect(restored.publicationCapacity?.pressure).toBeUndefined();
  expect(restored.publications.find(entry => entry.id === 'leg-0')?.planIds).toEqual(['island-plan']);
});
