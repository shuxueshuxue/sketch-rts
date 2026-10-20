/** Exact native command replay; no AI planning. Used with ai-objective-metrics.ts.
 * tsx scripts/ai-objective-clearing-replay.ts <immutable-source-tree> <export-dir> <output.json>
 * Export requires initial.json, summary.json, commands.jsonl.gz and traces.jsonl.gz.
 * Validate final snapshot/canonical/checksum before trusting the metrics.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { AiPlanTrace } from '../src/ai/plan-trace';
import type { GameSnapshot, GameCommand } from '../src/shared/types';

const [tree, folder, out] = process.argv.slice(2);
if (!tree || !folder || !out) throw new Error('Expected immutable-source-tree export-dir output.json');
const initial = JSON.parse(readFileSync(`${folder}/initial.json`, 'utf8'));
const original = JSON.parse(readFileSync(`${folder}/summary.json`, 'utf8'));
const { createGame, restoreSnapshotIntoGame, snapshotGame } = await import(`${tree}/src/shared/sim.ts`) as typeof import('../src/shared/sim');
const { createSdkCommandFrameRuntime } = await import(`${tree}/src/sdk/commands/frame.ts`) as typeof import('../src/sdk/commands/frame');
const { canonicalGameState, checksumGame } = await import(`${tree}/src/shared/sim/checksum.ts`) as typeof import('../src/shared/sim/checksum');
const { neutralCamps, EXPANSION_GUARD_RANGE } = await import(`${tree}/src/ai/policy/v7/creep.ts`) as typeof import('../src/ai/policy/v7/creep');
const load = <T>(name: string): T[] => gunzipSync(readFileSync(`${folder}/${name}.jsonl.gz`)).toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const commands = load<{ tick: number; owner: string; source: string; scriptId: string; command: GameCommand }>('commands');
const goals = load<AiPlanTrace>('traces').map(trace => ({ tick: trace.tick, owner: trace.owner,
  missions: trace.nodes.filter(node => node.source === 'naval.conquests' && node.kind === 'island'
    && node.status !== 'abandoned' && node.status !== 'done').map(node => ({ id: node.id, mineId: node.target.entityId })) }));
const game = createGame(initial.snapshot.map.id, { players: initial.activePlayers, aiPlayers: [] });
restoreSnapshotIntoGame(game, initial.snapshot as GameSnapshot, initial.nextId);
game.activePlayers = initial.activePlayers;
const runtime = createSdkCommandFrameRuntime(game);
const tasks = new Map<string, { owner: string; mineId: string; memberIds: string[]; firstAttackOrder: number | null;
  completed: number | null; observedOtherActors: string[] }>();
let commandIndex = 0, goalIndex = 0;
while (game.tick < original.tick) {
  while (goalIndex < goals.length && goals[goalIndex]!.tick <= game.tick) {
    const goal = goals[goalIndex++]!, camps = neutralCamps(snapshotGame(game));
    for (const mission of goal.missions) {
      if (tasks.has(mission.id)) continue;
      const mine = game.resources.find(resource => resource.id === mission.mineId);
      if (!mine) continue;
      // Reuse existing guard association and membership, without inventing camp IDs.
      const camp = camps.find(candidate => Math.hypot(candidate.center.x - mine.x, candidate.center.y - mine.y) <= EXPANSION_GUARD_RANGE);
      if (camp) tasks.set(mission.id, { owner: goal.owner, mineId: mine.id, memberIds: camp.creeps.map(unit => unit.id),
        firstAttackOrder: null, completed: null, observedOtherActors: [] });
    }
  }
  const entries = [];
  while (commandIndex < commands.length && commands[commandIndex]!.tick === game.tick) {
    const command = commands[commandIndex++]!;
    entries.push({ playerId: command.owner, source: command.source, scriptId: command.scriptId, command: command.command });
  }
  if (entries.length) runtime.issue(entries, {}, { checksum: false });
  runtime.tick();
  for (const task of tasks.values()) {
    if (task.completed !== null) continue;
    const attackers = game.units.filter(unit => unit.hp > 0 && unit.kind !== 'worker' && unit.order.type === 'attack'
      && task.memberIds.includes(unit.order.targetId));
    if (attackers.some(unit => unit.owner === task.owner)) task.firstAttackOrder ??= game.tick;
    for (const unit of attackers) if (unit.owner !== task.owner && !task.observedOtherActors.includes(unit.owner)) task.observedOtherActors.push(unit.owner);
    if (!game.units.some(unit => unit.hp > 0 && task.memberIds.includes(unit.id))) task.completed = game.tick;
  }
}
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checks = { snapshot: sha(snapshotGame(game)) === original.snapshotSha256,
  canonical: sha(canonicalGameState(game)) === original.canonicalSha256, checksum: checksumGame(game) === original.checksum };
const metrics: Record<string, { firstIslandClearAttackOrder: number | null; firstIslandClearComplete: number | null }> = {};
for (const task of tasks.values()) {
  const metric = metrics[task.owner] ??= { firstIslandClearAttackOrder: null, firstIslandClearComplete: null };
  // A camp cleared by somebody else is not our own clearing achievement.
  if (task.firstAttackOrder === null) continue;
  metric.firstIslandClearAttackOrder = metric.firstIslandClearAttackOrder === null ? task.firstAttackOrder : Math.min(metric.firstIslandClearAttackOrder, task.firstAttackOrder);
  if (task.completed !== null) metric.firstIslandClearComplete = metric.firstIslandClearComplete === null ? task.completed : Math.min(metric.firstIslandClearComplete, task.completed);
}
const result = { source: original.source, map: original.mapId, tick: game.tick, provenance: 'existing-task-guard-association-and-native-attack-orders',
  checks, metrics, tasks: [...tasks.values()] };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ map: original.mapId, checks, metrics }));
if (Object.values(checks).some(value => !value)) process.exitCode = 1;
