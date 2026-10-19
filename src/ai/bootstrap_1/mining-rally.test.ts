import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { runAiGameLoop } from '../game-runner';
import { bootstrapScripts, planBootstrapCommands } from './policy';
import { unitMover } from '../../shared/catalog';
import { walkableGoal } from '../../shared/terrain';
import { MINING_RALLY_RADIUS, miningRallyAssignment } from './mining-rally';
import { bootstrapPolicyContext } from './policy';
import { mainArmyIntel, miningRally, planBootstrapGeneral } from './mine-defense';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { strengthOf } from '../policy/v6/strength';

const saved: { snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory> } =
  JSON.parse(readFileSync(new URL('./fixtures/defense-rally-14m48.json', import.meta.url), 'utf8'));
const subject = 'v9_archer';
const defenders = saved.snapshot.units.filter(unit => unit.owner === subject && unit.kind !== 'worker'
  && !['priest', 'summoner', 'witch', 'ashHexer', 'fieldMedic'].includes(unit.kind)
  && unit.id !== 'unit-v9_archer-sparkArcher-2014').map(unit => unit.id);

function replay(anchored: boolean) {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  let point: { x: number; y: number } | undefined, maxGathered = 0, firstGatheredTick: number | undefined;
  let firstEngagement = Infinity, hallDamage = 0, firstFight = Infinity;
  const arrived = new Set<string>();
  const hall = saved.snapshot.buildings.find(building => building.id === 'building-v9_archer-townhall')!;
  game.observer = { hit(source, target, damage) {
    if (target.id === hall.id) hallDamage += damage;
    if (defenders.includes(source.id) && target.owner === 'p1'
      && Math.hypot(source.x - hall.x, source.y - hall.y) <= 650) firstEngagement = Math.min(firstEngagement, game.tick);
  } };
  const halls = new Set<string>();
  const result = runAiGameLoop({ name: 'real-mine-rally-14m48', game, maxTicks: 20760, thinkInterval: 15,
    agents: {
      p1: { controller: 'external-agent', team: 'rivals', race: 'grove', version: 'v9' },
      v9_archer: { controller: 'external-agent', team: 'v9_archer-side', race: 'ember', version: 'v9_archer' },
    }, commandPlanner: ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot,
      { playerId: owner, source, version: agent.version,
        ...(!anchored && owner === subject ? { scripts: bootstrapScripts('v9_archer').filter(script => script.id !== 'miningRally') } : {}) },
      { teams, memoryProvider }),
  }, { onStep({ game }) {
    const anchor = memories[subject]?.miningDefense;
    // Check this raid's anchor until every original defender has arrived. Once the rally has
    // finished, expansion may resume and a later, separate raid may legitimately defend another mine.
    if (anchor) { point ??= anchor.point; if (firstGatheredTick === undefined) halls.add(anchor.hallId);
      if (anchor.phase === 'fight') firstFight = Math.min(firstFight, game.tick); }
    // Both runs are measured at the same first threatened hall's mouth, regardless of the mode label.
    const post = point ?? { x: 2681.6543031765154, y: 4102.184899904971 };
    const atPost = game.units.filter(unit => defenders.includes(unit.id)
      && Math.hypot(unit.x - post.x, unit.y - post.y) <= MINING_RALLY_RADIUS);
    for (const unit of atPost) arrived.add(unit.id);
    maxGathered = Math.max(maxGathered, atPost.length);
    if (arrived.size === defenders.length) firstGatheredTick ??= game.tick;
  } });
  return { result, memories, maxGathered, firstGatheredTick, halls, arrived, firstEngagement, firstFight, hallDamage };
}

it('feeds all 19 real 14:48 defenders into one mine defense while the first sufficient group fights', () => {
  expect(defenders).toHaveLength(19);
  const before = replay(false), after = replay(true);
  expect(before.maxGathered).toBeLessThan(19);

  expect(after.arrived.size).toBe(19);
  expect(after.firstEngagement).toBeLessThan(before.firstEngagement);
  expect(after.hallDamage).toBeLessThanOrEqual(before.hallDamage);
  expect(after.firstFight).toBeLessThan(after.firstGatheredTick!);
  expect(after.firstFight).toBeLessThanOrEqual(saved.snapshot.tick + 45 * 20);
  expect(after.firstGatheredTick).toBeLessThanOrEqual(saved.snapshot.tick + 90 * 20);
  expect([...after.halls]).toEqual(['building-v9_archer-townhall']);
  // Script the next raid from the real replay's final state: pursuit changes can alter whether
  // a natural second raid happens within this short window, but it must remain a legal new task.
  const snapshot = snapshotGame(after.result.game), memory = after.memories[subject]!;
  const point = { x: 2681.6543031765154, y: 4102.184899904971 };
  const foes = snapshot.units.filter(unit => unit.owner === 'p1' && unit.kind !== 'worker' && !unit.deck && unitMover(unit.kind) === 'land');
  const enemyHome = snapshot.buildings.find(building => building.owner === 'p1' && building.kind === 'townHall')!;
  foes.forEach((unit, index) => { Object.assign(unit, walkableGoal(snapshot.map, enemyHome.x + 200 + index % 6 * 40,
    enemyHome.y + 200 + Math.floor(index / 6) * 40)); unit.order = { type: 'idle' }; });
  // The original raid is over and every surviving original defender is back at its own post.
  for (const unit of snapshot.units.filter(unit => defenders.includes(unit.id))) Object.assign(unit, point);
  planBootstrapCommands(snapshot, subject, 'v9_archer', { memory, teams: after.result.game.teams });
  expect(memory.miningDefense).toBeUndefined();

  const nextHall = snapshot.buildings.find(building => building.id === 'building-v9_archer-townHall-1602')!;
  snapshot.tick += 15;
  foes.forEach((unit, index) => { Object.assign(unit, walkableGoal(snapshot.map, nextHall.x - 240 + index % 6 * 25,
    nextHall.y - 240 + Math.floor(index / 6) * 25)); unit.order = { type: 'attackMove', x: nextHall.x, y: nextHall.y }; });
  const entries = planBootstrapCommands(snapshot, subject, 'v9_archer', { memory, teams: after.result.game.teams });
  expect(memory.miningDefense?.hallId).toBe(nextHall.id);
  expect(memory.miningDefense!.unitIds.length).toBeGreaterThan(0);
  expect(Math.hypot(memory.miningDefense!.point.x - nextHall.x, memory.miningDefense!.point.y - nextHall.y)).toBeLessThanOrEqual(201);
  expect(foes.some(unit => unit.attackDamage > 0 && memory.miningDefense!.attackerIds.includes(unit.id)
    && Math.hypot(unit.x - nextHall.x, unit.y - nextHall.y) <= 1000)).toBe(true);
  expect(entries.some(entry => entry.scriptId === 'miningRally' && 'unitIds' in entry.command
    && entry.command.unitIds.some(id => memory.miningDefense!.unitIds.includes(id)))).toBe(true);
}, 30000);


function context(elapsed = 100) {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  runAiGameLoop({ name: 'first-real-rally-order', game, maxTicks: saved.snapshot.tick + elapsed, thinkInterval: 15,
    agents: {
      p1: { controller: 'external-agent', team: 'rivals', race: 'grove', version: 'v9' },
      v9_archer: { controller: 'external-agent', team: 'v9_archer-side', race: 'ember', version: 'v9_archer' },
    }, commandPlanner: ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot,
      { playerId: owner, source, version: agent.version }, { teams, memoryProvider }),
  });
  const snapshot = snapshotGame(game), memory = memories[subject]!;
  const options = bootstrapPolicyContext(snapshot, subject, 'v9_archer', { memory, teams: game.teams });
  const assignment = miningRallyAssignment(snapshot, subject, options, mainArmyIntel(snapshot, subject, options))!;
  return { snapshot, memory, options, assignment };
}

it('starts the mine fight with a sufficient arrived group while the rest are still coming', () => {
  const { snapshot, options, assignment } = context(600);
  const attackers = snapshot.units.filter(unit => assignment.state.attackerIds.includes(unit.id)
    && Math.hypot(unit.x - assignment.hall.x, unit.y - assignment.hall.y) <= 1400);
  const advance = [] as typeof assignment.units;
  for (const unit of assignment.units) {
    advance.push(unit); Object.assign(unit, assignment.state.point);
    if (strengthOf(advance) >= strengthOf(attackers) * 1.25) break;
  }
  expect(advance.length).toBeLessThan(assignment.units.length);
  const next = miningRallyAssignment(snapshot, subject, options, mainArmyIntel(snapshot, subject, options))!;
  expect(next.state.phase).toBe('fight');
  expect(next.state.arrivedIds.length).toBeLessThan(next.state.unitIds.length);
});

it.each(['hall', 'worker'] as const)('starts the mine fight immediately when its %s takes damage, even without a sufficient arrived force', victim => {
  const { snapshot, options, assignment, memory } = context();
  const target = victim === 'hall' ? assignment.hall : snapshot.units.find(unit => unit.owner === subject && unit.kind === 'worker'
    && Math.hypot(unit.x - assignment.hall.x, unit.y - assignment.hall.y) <= 650)!;
  target.hp -= 1;
  const next = miningRallyAssignment(snapshot, subject, options, mainArmyIntel(snapshot, subject, options))!;
  expect(next.state.arrivedIds).toHaveLength(0);
  expect(next.state.phase).toBe('fight');
});

it('keeps commanding troops outside the actual rally assignment during gather', () => {
  const { snapshot, options, memory, assignment } = context();
  memory.miningDefense!.unitIds = assignment.state.unitIds.slice(0, 3);
  const commands = planBootstrapGeneral(snapshot, subject, options);
  const ordered = commands.flatMap(command => 'unitIds' in command ? command.unitIds : []);
  expect(ordered.length).toBeGreaterThan(0);
  expect(ordered.some(id => memory.miningDefense!.unitIds.includes(id))).toBe(false);
});

it.each(['local', 'strategic', undefined] as const)('uses a newly named script declaration (%s) to decide actual reassignment', redirects => {
  const { snapshot, options, assignment, memory } = context();
  const unit = assignment.units[0]!;
  Object.assign(unit, assignment.state.point);
  memory.miningDefense = { ...assignment.state, phase: 'fight', unitIds: [unit.id], arrivedIds: [unit.id] };
  const entries = runAiCommandEntriesFromScripts(snapshot, subject, [miningRally,
    { id: 'new-task-with-no-rally-special-case', phase: 'tactics', ...(redirects ? { redirects } : {}),
      run: () => ({ type: 'move', unitIds: [unit.id], x: 1000, y: 1000 }) },
  ], options);
  expect(entries.some(entry => entry.scriptId === 'new-task-with-no-rally-special-case')).toBe(true);
  expect(memory.miningDefense?.unitIds.includes(unit.id) ?? false).toBe(redirects === 'local');
});

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s declares every tactical script’s task redirection semantics', version => {
  expect(bootstrapScripts(version).filter(script => script.phase === 'tactics' && !script.redirects).map(script => script.id)).toEqual([]);
});
