import { expect, it } from 'vitest';
import { createBuilding, createUnit } from '../../shared/map';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { planVoyageRoute } from '../../shared/ship-navigation';
import { createGame, snapshotGame } from '../../shared/sim';
import { FactWorkQueue, withFactWork } from './fact-work';
import { createGoalVoyageRiskReader, type GoalVoyageRiskMemory } from './goal-voyage-risk-source';
import type { StrategyObservationMemory } from './observation-memory';
import { assessVoyageRisks, type VoyageRisk, type VoyageRiskRequest } from './voyage-risk';

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
    const read = createGoalVoyageRiskReader({ snapshot, owner: 'player', work, observation, memory });
    withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => withFactWork(work, () => {
        result = read(request);
        expect(read(request)).toEqual(result);
        work.flush();
      })));
    if (sequence === 1) expect(memory.publications).toEqual([]);
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
