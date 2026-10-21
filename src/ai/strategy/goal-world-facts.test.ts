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
import { boundGoalWorldFactMemory, createGoalFactReader, createGoalWorldFactMemory, retainGoalWorldFactMemory,
  worldCampCacheId, type GoalWorldFactInput, type GoalWorldFactMemory } from './goal-world-facts';
import { observationJsonBytes } from './observation-json-bytes';
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
function source(snapshot: GameSnapshot, memory = createGoalWorldFactMemory('us'), allowedUnitIds?: readonly string[], interruptedUnitIds?: readonly string[],
  cacheUse?: GoalWorldFactInput['cacheUse']) {
  const context = frame(snapshot), work = new FactWorkQueue(snapshot.tick, 0);
  return createGoalFactReader({ ...context, memory, ...(cacheUse ? { cacheUse } : {}), ...(allowedUnitIds === undefined ? {} : { allowedUnitIds }),
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

it('publishes legal assembly geometry separately from the presence of a hostile or a future safety promise', () => {
  const snapshot = snapshotGame(scene()), context = frame(snapshot), geometry: GoalGeometryMemory = { version: 1, entries: [] };
  const at = { point: { x: 2100, y: 2100 }, landId: landIdAt(snapshot.map, { x: 2100, y: 2100 })! };
  const fact = goalFact({ kind: 'assembly-post', at }), before = JSON.stringify(snapshot);
  let answer: ReturnType<ReturnType<typeof source>> | undefined;
  for (const sequence of [1, 2]) {
    const work = new FactWorkQueue(snapshot.tick, 1, undefined, sequence);
    const read = createGoalFactReader({ ...context, memory: createGoalWorldFactMemory('us'), ports: {
      reservedGold: 0, geometryRevision: 'native-assembly-ground',
      geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory: geometry }),
      regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point),
      landRoute: () => { throw Error('Point legality is not a new route query'); },
    } });
    answer = strict(() => withFactWork(work, () => { const row = read(fact); work.flush(); return row; }));
    expect(work.receipt.used).toBe(sequence === 1 ? 1 : 0);
    expect(answer.state).toBe(sequence === 1 ? 'pending' : 'met');
  }
  expect(answer!.derived).toBeUndefined(); expect(answer!.threats).toBeUndefined();
  expect(snapshot.units.some(unit => unit.id === 'guard' && unit.hp > 0)).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('keeps a shared pending proof and its original request time pinned across readers, JSON and count pressure', () => {
  const snapshot = snapshotGame(scene()), memory = createGoalWorldFactMemory('us');
  let plans = ['first'];
  const read = source(snapshot, memory, undefined, undefined, { thinkSequence: 1, planIds: () => plans });
  const fact = goalFact({ kind: 'site-safe', site: { point: { x: 1000, y: 1000 } }, throughTick: 1000 });
  expect(read(fact)).toMatchObject({ state: 'pending', requestedTick: snapshot.tick });
  plans = ['second'];
  expect(read(fact).state).toBe('pending'); // memoized facts still record every consumer.
  expect(memory.requests.find(entry => entry.id === fact.id)?.planIds).toEqual(['first', 'second']);
  memory.requests.push(...Array.from({ length: 65 }, (_, i) => ({ id: `other-${i}`, requestedTick: 1, lastUsedThink: 2 })));
  boundGoalWorldFactMemory(memory, 2);
  expect(memory.requests).toHaveLength(64);
  const restored: GoalWorldFactMemory = JSON.parse(JSON.stringify(memory));
  retainGoalWorldFactMemory(restored, new Map([['second', new Set([`world:${fact.id}`])]]), 2);
  expect(restored.requests.find(entry => entry.id === fact.id)?.planIds).toEqual(['second']);
  expect(source(snapshot, restored, undefined, undefined, { thinkSequence: 3, planIds: () => ['second'] })(fact))
    .toMatchObject({ state: 'pending', requestId: `world:${fact.id}`, requestedTick: snapshot.tick });
});

it('preserves recorded cleared-camp evidence while referenced and loses only proof after its pin is released', () => {
  const game = scene(), snapshot = snapshotGame(game), memory = createGoalWorldFactMemory('us');
  const campId = goalCampId(neutralCampExposure(snapshot).camps[0]!.memberIds), fact = goalFact({ kind: 'camp-cleared', campId });
  expect(source(snapshot, memory, undefined, undefined, { thinkSequence: 1, planIds: () => ['mine-plan'] })(fact).state).toBe('unmet');
  const guard = game.units.find(unit => unit.id === 'guard')!;
  game.units = game.units.filter(unit => unit !== guard); // Absent group requires the previously observed identity.
  memory.camps.push(...Array.from({ length: 65 }, (_, i) => goalCampId([`absent-${i}`])));
  boundGoalWorldFactMemory(memory, 2);
  expect(memory.camps).toHaveLength(64);
  const restored: GoalWorldFactMemory = JSON.parse(JSON.stringify(memory));
  retainGoalWorldFactMemory(restored, new Map([['mine-plan', new Set([worldCampCacheId(campId)])]]), 2);
  expect(source(snapshotGame(game), restored, undefined, undefined, { thinkSequence: 3, planIds: () => ['mine-plan'] })(fact).state).toBe('met');
  retainGoalWorldFactMemory(restored, new Map(), 4);
  restored.camps.push(goalCampId(['newer-identity']));
  restored.campUses!.push({ id: restored.camps.at(-1)!, lastUsedThink: 5 });
  // Make the formerly pinned proof the least recently used item.
  for (const id of restored.camps) if (id !== campId && !restored.campUses!.some(use => use.id === id))
    restored.campUses!.push({ id, lastUsedThink: 5 });
  boundGoalWorldFactMemory(restored, 5);
  expect(restored.camps).not.toContain(campId);
  expect(source(snapshotGame(game), restored)(fact)).toMatchObject({ state: 'unmet', reason: { code: 'camp-identity-unobserved' } });
});

it('reports pinned count and byte overflow without discarding proof, then recovers on release', () => {
  const memory = createGoalWorldFactMemory('us');
  memory.camps = Array.from({ length: 65 }, (_, i) => goalCampId([`guard-${i}`]));
  memory.campUses = memory.camps.map(id => ({ id, lastUsedThink: 1, planIds: ['camp-plan'] }));
  memory.requests = [{ id: 'large-fact'.repeat(2000), requestedTick: 0, lastUsedThink: 1, planIds: ['route-plan'] }];
  const overflow = boundGoalWorldFactMemory(memory, 1);
  expect(memory.camps).toHaveLength(65);
  expect(memory.requests).toHaveLength(1);
  expect(overflow.capacity.camps.pressure).toMatchObject({ kind: 'goal-world-camps', entries: 65, limitEntries: 64, planIds: ['camp-plan'] });
  expect(overflow.capacity.payload.pressure).toMatchObject({ kind: 'goal-world-payload', limitBytes: 16384, planIds: ['camp-plan', 'route-plan'] });
  const restored: GoalWorldFactMemory = JSON.parse(JSON.stringify(memory));
  boundGoalWorldFactMemory(restored, 2);
  expect(restored.capacity?.payload.overflowCount).toBe(1);
  retainGoalWorldFactMemory(restored, new Map(), 3);
  expect(restored.capacity?.payload.pressure).toBeUndefined();
  expect(restored.capacity?.camps.pressure).toBeUndefined();
  const { capacity: _diagnostics, ...payload } = restored;
  expect(observationJsonBytes(payload)).toBeLessThanOrEqual(16384);
  expect(restored.camps.length).toBeLessThanOrEqual(64);
});

it('uses deterministic LRU ties and counts the complete world payload including cache-use metadata', () => {
  const memory = createGoalWorldFactMemory('us');
  memory.requests = Array.from({ length: 65 }, (_, i) => ({ id: `fact-${String(i).padStart(2, '0')}`, requestedTick: 1 }));
  const first = structuredClone(memory), second = structuredClone(memory);
  second.requests.reverse();
  expect(boundGoalWorldFactMemory(first, 1).evicted.map(entry => entry.id)).toEqual(['fact-00']);
  expect(boundGoalWorldFactMemory(second, 1).evicted.map(entry => entry.id)).toEqual(['fact-00']);
  memory.requests = Array.from({ length: 40 }, (_, i) => ({ id: `${i}-${'x'.repeat(450)}`, requestedTick: 1, lastUsedThink: 1 }));
  const result = boundGoalWorldFactMemory(memory, 1), { capacity: _diagnostics, ...payload } = memory;
  expect(result.bytes).toBe(observationJsonBytes(payload));
  expect(result.bytes).toBeLessThanOrEqual(16384);
  expect(result.evicted.length).toBeGreaterThan(0);
});
