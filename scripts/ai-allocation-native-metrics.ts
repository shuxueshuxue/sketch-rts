/** Offline §8 measurements, with no AI think. Usage:
 * tsx scripts/ai-allocation-native-metrics.ts <immutable-tree> <export-dir> <report.json>
 * Requires original initial/summary, commands and memory-after exports. All three
 * final world checks must match before interpreting the report. The #570 three
 * milestone columns remain a separate report from ai-objective-metrics.ts and
 * ai-objective-clearing-replay.ts; this script does not redefine a sortie.
 */
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { AiPolicyMemory } from '../src/ai/memory';
import type { AiDeathTask, AiIssuedOrder } from '../src/ai/death-ledger-types';
import { deathTaskIndex, inferDeathAssignment, sameDeathAssignmentGoal } from '../src/ai/death-ledger-context';
import type { GameCommand, GameSnapshot, Unit } from '../src/shared/types';
import { SIM_TICKS_PER_SECOND } from '../src/shared/time';

const [tree, folder, output] = process.argv.slice(2);
if (!tree || !folder || !output) throw new Error('Expected immutable-tree export-dir report.json');
const initial = JSON.parse(readFileSync(`${folder}/initial.json`, 'utf8'));
const original = JSON.parse(readFileSync(`${folder}/summary.json`, 'utf8'));
const { createGame, restoreSnapshotIntoGame, snapshotGame } = await import(`${tree}/src/shared/sim.ts`) as typeof import('../src/shared/sim');
const { createSdkCommandFrameRuntime } = await import(`${tree}/src/sdk/commands/frame.ts`) as typeof import('../src/sdk/commands/frame');
const { canonicalGameState, checksumGame } = await import(`${tree}/src/shared/sim/checksum.ts`) as typeof import('../src/shared/sim/checksum');
const { strengthOf } = await import(`${tree}/src/ai/policy/v6/strength.ts`) as typeof import('../src/ai/policy/v6/strength');
const { unitMover } = await import(`${tree}/src/shared/catalog.ts`) as typeof import('../src/shared/catalog');
const { sameGround } = await import(`${tree}/src/shared/terrain.ts`) as typeof import('../src/shared/terrain');
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
async function* rows<T>(name: string): AsyncGenerator<T> {
  const zipped = `${folder}/${name}.jsonl.gz`, plain = `${folder}/${name}.jsonl`;
  const stream = existsSync(zipped) ? createReadStream(zipped).pipe(createGunzip()) : createReadStream(plain);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of lines) if (line.trim()) yield JSON.parse(line) as T; }
  finally { lines.close(); stream.destroy(); }
}
type CommandRow = { tick: number; owner: string; source: string; scriptId: string; command: GameCommand };
type MemoryRow = { tick: number; owner: string; memory: AiPolicyMemory };
const commands = rows<CommandRow>('commands'), memories = rows<MemoryRow>('memory-after');
let nextCommand = await commands.next(), nextMemory = await memories.next();
const game = createGame(initial.snapshot.map.id, { players: initial.activePlayers, aiPlayers: [] });
restoreSnapshotIntoGame(game, initial.snapshot as GameSnapshot, initial.nextId); game.activePlayers = initial.activePlayers;
const runtime = createSdkCommandFrameRuntime(game), owners: string[] = original.owners;
const memory = new Map<string, AiPolicyMemory>(), tasks = new Map<string, AiDeathTask | null>();
const issued = new Map<string, AiIssuedOrder>(), previousTask = new Map<string, AiDeathTask>();
const histories = new Map<string, string[]>(), seenEvents = new Set<string>(), completed = new Set<string>();
const initialHalls = new Set(game.buildings.filter(building => building.kind === 'townHall' && building.complete).map(building => building.id));
const laterHalls = new Set<string>();
const timeline = openSync(`${output}.timeline.jsonl`, 'w');
const emit = (row: unknown) => writeSync(timeline, JSON.stringify(row) + '\n');
const stats = Object.fromEntries(owners.map(owner => [owner, { combatUnitSeconds: 0, combatForceSeconds: 0,
  idleUnitSeconds: 0, idleForceSeconds: 0, assignedIdleForceSeconds: 0, inTransitForceSeconds: 0,
  interruptedForceSeconds: 0, outwardForceSeconds: 0, taskUnknownForceSeconds: 0,
  aba: { assignment: 0, inferred: 0 }, formalCompletedObjectives: null as number | null,
  nativeNewCompletedHalls: 0, preemptions: {} as Record<string, number>, candidateReassignments: 0,
  maximumAllocationBytes: 0, hallsLostWithArmyElsewhere: 0 }]));
const outward = (task: AiDeathTask | null) => !!task && (task.clearing || ['attack', 'attack-site', 'raid', 'island',
  'contest-route', 'counter-harass', 'naval-combat'].includes(task.kind));
function observeThink(snapshot: GameSnapshot, owner: string) {
  const state = memory.get(owner); if (!state || !stats[owner]) return;
  const index = deathTaskIndex(snapshot, owner, state);
  for (const unit of snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0)) {
    const assignment = inferDeathAssignment(snapshot, unit, state, index, issued.get(unit.id) ?? null);
    const task = assignment.task; tasks.set(unit.id, task);
    if (!task || assignment.state === 'emergency-interruption' && task.attribution !== 'assignment') continue;
    const before = previousTask.get(unit.id);
    if (sameDeathAssignmentGoal(before, task)) continue;
    const history = histories.get(unit.id) ?? [], aba = history.length > 1 && history.at(-2) === task.id;
    if (aba) stats[owner]!.aba[task.attribution]++;
    history.push(task.id); if (history.length > 3) history.shift(); histories.set(unit.id, history); previousTask.set(unit.id, task);
    emit({ tick: snapshot.tick, owner, unitId: unit.id, kind: 'objective-transition', from: before?.id ?? null,
      to: task.id, authority: task.attribution, source: task.source, aba, nativeOrder: unit.order });
  }
  const allocation = state.strategyAllocation;
  if (!allocation) return;
  stats[owner]!.formalCompletedObjectives ??= 0;
  stats[owner]!.maximumAllocationBytes = Math.max(stats[owner]!.maximumAllocationBytes, Buffer.byteLength(JSON.stringify(allocation)));
  for (const objective of Object.values(allocation.objectives)) if (objective.status === 'complete' && !completed.has(objective.objectiveId)) {
    completed.add(objective.objectiveId); stats[owner]!.formalCompletedObjectives!++;
    emit({ tick: snapshot.tick, owner, kind: 'objective-complete', objectiveId: objective.objectiveId, authority: 'assignment' });
  }
  for (const event of allocation.events) if (!seenEvents.has(event.id)) {
    seenEvents.add(event.id); emit({ owner, kind: 'allocation-event', event });
    if (event.kind === 'preempted') stats[owner]!.preemptions[event.reason.code] = (stats[owner]!.preemptions[event.reason.code] ?? 0) + 1;
    const kind: string = event.kind;
    if (kind === 'candidate-reassigned') stats[owner]!.candidateReassignments++;
  }
}
type Episode = { owner: string; hallId: string; attackTick: number; lastDamageTick: number; endedTick: number | null;
  post: { x: number; y: number }; postSource: string; initialDefenderIds: string[];
  reinforcementTick: number | null; reinforcementIds: string[]; destroyedTick: number | null; elsewhereUnitIds: string[] };
const episodes: Episode[] = [], activeEpisodes = new Map<string, Episode>();
const groundSoldiers = (owner: string) => game.units.filter(unit => unit.hp > 0 && unit.owner === owner
  && unit.kind !== 'worker' && unit.attackDamage > 0 && unitMover(unit.kind) === 'land');
const atPost = (unit: Unit, post: { x: number; y: number }) => !unit.deck && !unit.cabin && sameGround(game.map, unit, post) && gap(unit, post) <= 240;
function postFor(owner: string, hall: { id: string; x: number; y: number }) {
  const state = memory.get(owner), execution = Object.values(state?.strategyAllocation?.executions ?? {}).find(action =>
    action.target.entityId === hall.id && ['strategy.defend-site', 'strategy.establish-garrison'].includes(action.executor)
    && !['complete', 'failed', 'abandoned'].includes(action.status));
  const value = execution?.state.post;
  if (value && typeof value === 'object' && 'x' in value && 'y' in value && typeof value.x === 'number' && typeof value.y === 'number')
    return { post: { x: value.x, y: value.y }, source: 'assignment-execution-post' };
  if (execution) return { post: execution.target.point, source: 'assignment-action-target' };
  const rally = [state?.miningDefense, state?.miningLeash].find(post => post?.hallId === hall.id);
  return rally ? { post: rally.point, source: 'inferred-task-post' } : { post: { x: hall.x, y: hall.y }, source: 'site-center-fallback' };
}
while (game.tick < original.tick) {
  const changed = new Set<string>();
  while (!nextMemory.done && nextMemory.value.tick <= game.tick) {
    const row = nextMemory.value; memory.set(row.owner, row.memory); changed.add(row.owner); nextMemory = await memories.next();
  }
  const entries = [];
  while (!nextCommand.done && nextCommand.value.tick === game.tick) {
    const row = nextCommand.value; entries.push({ playerId: row.owner, source: row.source, scriptId: row.scriptId, command: row.command });
    const ids = 'unitIds' in row.command ? row.command.unitIds : 'unitId' in row.command ? [row.command.unitId] : [];
    for (const id of ids) issued.set(id, { tick: game.tick, command: row.command, executor: row.scriptId, source: row.source, attribution: 'recorded-issued-command' });
    nextCommand = await commands.next();
  }
  if (entries.length) runtime.issue(entries, {}, { checksum: false });
  if (changed.size) { const snapshot = snapshotGame(game); for (const owner of changed) observeThink(snapshot, owner); }
  for (const unit of game.units) {
    const row = stats[unit.owner];
    if (!row || unit.hp <= 0 || unit.kind === 'worker' || unit.attackDamage <= 0 || unitMover(unit.kind) !== 'land') continue;
    const force = strengthOf([unit]) / SIM_TICKS_PER_SECOND, task = tasks.get(unit.id) ?? null;
    row.combatUnitSeconds += 1 / SIM_TICKS_PER_SECOND; row.combatForceSeconds += force;
    if (!task) row.taskUnknownForceSeconds += force;
    if (unit.deck || unit.cabin) row.inTransitForceSeconds += force;
    else if (['idle', 'hold'].includes(unit.order.type)) {
      if (task) row.assignedIdleForceSeconds += force;
      else { row.idleForceSeconds += force; row.idleUnitSeconds += 1 / SIM_TICKS_PER_SECOND; }
    }
    if (task?.formal?.interruption || unit.order.type === 'move' && unit.order.avoidCombat && !task?.formal) row.interruptedForceSeconds += force;
    if (outward(task)) row.outwardForceSeconds += force;
  }
  const halls = game.buildings.filter(building => building.kind === 'townHall' && stats[building.owner]).map(building => ({ building, hp: building.hp }));
  runtime.tick();
  for (const { building: hall, hp } of halls) {
    const soldiers = groundSoldiers(hall.owner);
    if (hall.hp < hp) {
      let episode = activeEpisodes.get(hall.id);
      if (!episode) {
        const post = postFor(hall.owner, hall);
        episode = { owner: hall.owner, hallId: hall.id, attackTick: game.tick, lastDamageTick: game.tick, endedTick: null,
          post: { ...post.post }, postSource: post.source, initialDefenderIds: soldiers.filter(unit => atPost(unit, post.post)).map(unit => unit.id),
          reinforcementTick: null, reinforcementIds: [], destroyedTick: null, elsewhereUnitIds: [] };
        episodes.push(episode); activeEpisodes.set(hall.id, episode);
      }
      episode.lastDamageTick = game.tick;
    }
    const episode = activeEpisodes.get(hall.id); if (!episode) continue;
    const arrivals = soldiers.filter(unit => !episode.initialDefenderIds.includes(unit.id) && atPost(unit, episode.post));
    if (episode.reinforcementTick === null && arrivals.length) { episode.reinforcementTick = game.tick; episode.reinforcementIds = arrivals.map(unit => unit.id); }
    if (hall.hp <= 0) {
      episode.destroyedTick = game.tick; episode.endedTick = game.tick;
      episode.elsewhereUnitIds = soldiers.filter(unit => !atPost(unit, episode.post)).map(unit => unit.id);
      if (episode.elsewhereUnitIds.length) stats[hall.owner]!.hallsLostWithArmyElsewhere++;
      activeEpisodes.delete(hall.id);
    } else if (game.tick - episode.lastDamageTick >= 5 * SIM_TICKS_PER_SECOND && !game.units.some(unit => unit.hp > 0
      && unit.owner !== 'neutral' && unit.owner !== hall.owner
      && (game.teams[unit.owner] === undefined || game.teams[unit.owner] !== game.teams[hall.owner])
      && unit.attackDamage > 0 && !unit.cabin && gap(unit, hall) <= 650)) {
      episode.endedTick = game.tick; activeEpisodes.delete(hall.id);
    }
  }
  for (const hall of game.buildings) if (stats[hall.owner] && hall.kind === 'townHall' && hall.complete && hall.hp > 0
    && !initialHalls.has(hall.id) && !laterHalls.has(hall.id)) {
    laterHalls.add(hall.id); stats[hall.owner]!.nativeNewCompletedHalls++;
    emit({ tick: game.tick, owner: hall.owner, kind: 'native-hall-complete', hallId: hall.id, x: hall.x, y: hall.y });
  }
}
closeSync(timeline);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checks = { snapshot: sha(snapshotGame(game)) === original.snapshotSha256,
  canonical: sha(canonicalGameState(game)) === original.canonicalSha256, checksum: checksumGame(game) === original.checksum };
const result = { schemaVersion: 1, source: original.source, mapId: original.mapId, ticks: game.tick, checks,
  definitions: { force: 'native V6 field strength, live armed land units, integrated once per sim tick; ships reported by transport membership only',
    idle: 'native idle/hold with no retained task; assigned idle/hold is separate and may be legitimate guarding',
    aba: 'three distinct retained objective transitions; inferred candidates kept separate from formal assignment authority',
    offenseShare: 'outward retained task force seconds divided by all live land combat force seconds; inference is not actual firing',
    aid: 'first new physically landed soldier within 240 of captured task post; center fallback explicitly labelled; arrival alone does not prove its task',
    siteAttack: 'native per-step net hall HP decrease, lower bound when repair masks damage; episode ends after 5 seconds quiet with no nearby hostile',
    lostElsewhere: 'observed co-occurrence, not causal blame; full unit witnesses retained',
    completed: 'formal completed objectives are null without a formal allocator; physical new halls are separate, never a fabricated baseline goal count' },
  owners: Object.fromEntries(Object.entries(stats).map(([owner, row]) => [owner, { ...row,
    offenseShare: row.combatForceSeconds ? row.outwardForceSeconds / row.combatForceSeconds : null }])),
  siteAttacks: episodes.map(episode => ({ ...episode, responseTicks: episode.reinforcementTick === null ? null : episode.reinforcementTick - episode.attackTick })) };
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ mapId: result.mapId, checks, owners: result.owners }));
if (Object.values(checks).some(value => !value)) process.exitCode = 1;
