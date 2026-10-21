import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame, issuePlayerCommand, stepGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { effectiveCombatRating } from '../policy/v6/strength';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { withAllocationArrivalQuery } from './allocation-arrival-query';
import { buildStrategyDecision } from './decision';
import { FactWorkQueue, withFactWork } from './fact-work';
import { goalCampId, goalFact } from './goal-facts';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory } from './goal-grounding-ports';
import { createGoalFactReader, createGoalWorldFactMemory, type GoalWorldFactMemory } from './goal-world-facts';
import { landIdAt, regionIndex, seaIdAt } from './regions';

function scene() {
  const game = sketchScene('composing-world-facts').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'home' }).player('ally', { team: 'home' }).player('foe', { team: 'away' })
    .townHall('us', 350, 350).townHall('foe', 4000, 4000).worker('us', 430, 350, { id: 'worker' })
    .unit('us', 'footman', 1000, 1000, { id: 'a' }).unit('us', 'archer', 1500, 1000, { id: 'b' })
    .unit('ally', 'knight', 1000, 1000, { id: 'ally' })
    .unit('neutral', 'footman', 2100, 2100, { id: 'guard', hp: 1 }).build().createGame();
  game.scriptedVictory = true; return game;
}
function frame(snapshot: GameSnapshot) {
  regionIndex(snapshot.map);
  return { snapshot, owner: 'us', tick: snapshot.tick, version: 'v9_summoner' as const,
    situation: buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity).situation };
}
function source(snapshot: GameSnapshot, memory = createGoalWorldFactMemory('us'), allowedUnitIds?: readonly string[], interruptedUnitIds?: readonly string[]) {
  const context = frame(snapshot), work = new FactWorkQueue(snapshot.tick, 0);
  return createGoalFactReader({ ...context, memory, ...(allowedUnitIds === undefined ? {} : { allowedUnitIds }),
    ...(interruptedUnitIds === undefined ? {} : { interruptedUnitIds }), ports: {
    reservedGold: 0, geometryRevision: 'native-test-bodies',
    geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory: { version: 1, entries: [] } }),
    regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point),
    landRoute: () => { throw Error('Current amount facts must not request navigation'); },
  } });
}
function strict<T>(run: () => T) { return withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run)); }

it('measures actual eligible HP/weapon cohorts and distinguishes the land pool from arrival at a post', () => {
  const snapshot = snapshotGame(scene()), at = { landId: landIdAt(snapshot.map, { x: 1000, y: 1000 })!, point: { x: 1000, y: 1000 } };
  const cohort = ['a', 'b'].map(entityId => ({ kind: 'existing' as const, entityId }));
  const fact = goalFact({ kind: 'force-available', at, minimum: 0, metric: 'combat-rating', cohort, byTick: 1000 });
  const before = JSON.stringify(snapshot), read = source(snapshot);
  const expected = snapshot.units.filter(unit => ['a', 'b'].includes(unit.id)).reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
  expect(strict(() => read(fact))).toMatchObject({ state: 'met', quantity: expected, entityIds: ['a', 'b'] });
  expect(read(goalFact({ ...fact.predicate as Extract<typeof fact.predicate, { kind: 'force-available' }>, kind: 'force-at' })))
    .toMatchObject({ state: 'unmet', entityIds: ['a'] });
  expect(source(snapshot, undefined, undefined, ['a'])(fact)).toMatchObject({ state: 'unmet', entityIds: ['b'] });
  expect(source(snapshot, undefined, [])(fact)).toMatchObject({ state: 'unmet', quantity: 0, entityIds: [] });
  expect(source(snapshot, undefined, ['a'])(fact)).toMatchObject({ state: 'unmet', entityIds: ['a'] });
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('requires recorded native camp identity before an absent group can count as cleared', () => {
  const game = scene(), first = snapshotGame(game), memory = createGoalWorldFactMemory('us');
  const campId = goalCampId(neutralCampExposure(first).camps[0]!.memberIds), fact = goalFact({ kind: 'camp-cleared', campId });
  expect(source(first, memory)(fact).state).toBe('unmet');
  expect(source(first, memory)(goalFact({ kind: 'camp-cleared', campId: goalCampId(['never-existed']) })))
    .toMatchObject({ state: 'unmet', reason: { code: 'camp-identity-unobserved' } });
  const fighter = game.units.find(unit => unit.id === 'a')!, guard = game.units.find(unit => unit.id === 'guard')!;
  fighter.x = guard.x - 40; fighter.y = guard.y;
  issuePlayerCommand(game, 'us', { type: 'attack', unitIds: ['a'], targetId: 'guard' });
  for (let step = 0; step < 200 && guard.hp > 0; step++) stepGame(game);
  expect(guard.hp).toBeLessThanOrEqual(0);
  const restored: GoalWorldFactMemory = JSON.parse(JSON.stringify(memory));
  expect(source(snapshotGame(game), restored)(fact)).toMatchObject({ state: 'met', entityIds: [] });
  expect(source(snapshotGame(game))(fact)).toMatchObject({ state: 'unmet', reason: { code: 'camp-identity-unobserved' } });
});

it('shares finite route publication and preserves first-request time across JSON owner thinks', () => {
  const game = scene(), aiMemory = createAiPolicyMemory(), geometryMemory: GoalGeometryMemory = { version: 1, entries: [] };
  let memory = createGoalWorldFactMemory('us'), published = false, firstTick: number | undefined;
  for (let think = 0; think < 80 && !published; think++) {
    if (think) for (let step = 0; step < 15; step++) stepGame(game);
    const snapshot = snapshotGame(game), context = frame(snapshot), work = new FactWorkQueue(snapshot.tick, think ? 6144 : 0);
    strict(() => withFactWork(work, () => withAllocationArrivalQuery(snapshot, 'us', aiMemory, (_f, _l, _a, landRoute) => {
      const from = { point: { x: 1000, y: 1000 } }, to = { point: { x: 3000, y: 3000 } };
      const read = createGoalFactReader({ ...context, memory, ports: { reservedGold: 0,
        geometryRevision: 'same-bodies', geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory: geometryMemory }),
        regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point), landRoute } });
      const result = read(goalFact({ kind: 'route', mover: 'land', from, to, actor: { kind: 'existing', entityId: 'a' } }));
      if (result.state === 'pending') { firstTick ??= result.requestedTick; expect(result.requestedTick).toBe(firstTick); }
      else { expect(result).toMatchObject({ state: 'met', route: { ticks: expect.any(Number) } }); published = true; }
      work.flush();
    })));
    expect(work.receipt.used).toBeLessThanOrEqual(think ? 6144 : 0);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(published).toBe(true);
});
