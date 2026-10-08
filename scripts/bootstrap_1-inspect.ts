import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { bootstrapGame, bootstrapMatches } from '../src/ai/bootstrap_1/benchmark';
import { runAiGameLoop } from '../src/ai/game-runner';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import type { BootstrapAiVersion, MapId, PlayerId } from '../src/shared/types';
import { restoreSnapshotIntoGame, snapshotGame } from '../src/shared/sim';
import type { AiPolicyMemory } from '../src/ai/policy';
import { rankBootstrapGoals } from '../src/ai/bootstrap_1/economy';
import { bootstrapPolicyContext } from '../src/ai/bootstrap_1/policy';
const { values } = parseArgs({ options: {
  map: { type: 'string', default: 'pineshade' },
  subject: { type: 'string', default: 'v9_summoner' },
  opponents: { type: 'string', default: 'v5+v7' },
  race: { type: 'string', default: 'grove' },
  side: { type: 'string', default: '0' },
  ticks: { type: 'string', default: '6000' },
  'sample-ticks': { type: 'string', default: '600' },
  frames: { type: 'boolean' },
  resume: { type: 'string' },
  out: { type: 'string', default: '/tmp/bootstrap_1-trace.json' },
} });
const subject = values.subject as BootstrapAiVersion;
const sampleTicks = Number(values['sample-ticks']);
const match = bootstrapMatches('bootstrap_1-development', [values.map as MapId], Number(values.ticks)).find(match =>
  match.subject === subject && match.agents.p0!.race === values.race && match.side === Number(values.side)
  && Object.values(match.agents).slice(1).map(agent => agent.version).join('+') === values.opponents)!;
const rows: unknown[] = [];
const purchases: unknown[] = [];
if (values.frames) mkdirSync(values.out + '.frames', { recursive: true });
const memories = createAiMemoryProvider();
const game = bootstrapGame(match);
if (values.resume) {
  const previous: { rows: { tick: number; players: Record<PlayerId, { policy: AiPolicyMemory }> }[] } = JSON.parse(readFileSync(values.resume, 'utf8'));
  const row = previous.rows.at(-1)!;
  const frame = JSON.parse(readFileSync(`${values.resume}.frames/${row.tick}.json`, 'utf8'));
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  for (const [owner, player] of Object.entries(row.players)) memories.set!(owner, player.policy);
}
const commandPlanner: Parameters<typeof runAiGameLoop>[0]['commandPlanner'] = ({ snapshot, owner, agent, source, teams }) => {
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: owner, version: agent.version, source }, { teams, memoryProvider: memories });
  if (owner === 'p0') for (const entry of entries) {
    if (['build', 'train', 'research', 'hire', 'buy'].includes(entry.command.type)) {
      purchases.push({ tick: snapshot.tick, script: entry.scriptId, command: entry.command });
    }
  }
  return entries;
};
const result = runAiGameLoop({ ...match, game, commandPlanner }, { onStep: ({ game }) => {
  if (game.tick % sampleTicks !== 0) return;
  const snapshot = snapshotGame(game);
  if (values.frames) writeFileSync(`${values.out}.frames/${game.tick}.json`, JSON.stringify({ snapshot, nextId: game.nextId }) + '\n');
  const row = {
    tick: game.tick,
    players: Object.fromEntries(Object.keys(match.agents).map(owner => [owner, {
      policy: memories.get(owner),
      gold: game.players[owner]!.gold,
      supply: game.players[owner]!.supplyUsed,
      cap: game.players[owner]!.supplyCap,
      upgrades: game.players[owner]!.upgrades,
      bases: game.buildings.filter(building => building.owner === owner && building.kind === 'townHall')
        .map(({ id, x, y, hp, complete }) => ({ id, x, y, hp, complete })),
      units: game.units.filter(unit => unit.owner === owner)
        .map(({ id, kind, x, y, hp, maxHp, order, cooldown }) => ({ id, kind, x, y, hp, maxHp, order, cooldown })),
      buildings: game.buildings.filter(building => building.owner === owner)
        .map(({ id, kind, hp, complete, queue }) => ({ id, kind, hp, complete, queue })),
    }])),
  };
  const context = bootstrapPolicyContext(snapshot, 'p0', subject, { teams: game.teams, memory: structuredClone(memories.get('p0')!) });
  const goals = rankBootstrapGoals(snapshot, 'p0', context).map(({ id, priority, cost }) => ({ id, priority, cost }));
  rows.push(structuredClone({ ...row, goals }));
  console.log(JSON.stringify({ tick: game.tick, players: Object.fromEntries(Object.entries(row.players).map(([owner, player]) => [owner, {
    gold: player.gold, supply: player.supply, cap: player.cap, bases: player.bases.length,
    army: player.units.filter(unit => unit.kind !== 'worker').length,
  }])) }));
} });
writeFileSync(values.out, JSON.stringify({ subject, result: { tick: result.game.tick, winner: result.game.match.winner }, rows, purchases }) + '\n');
