import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../src/shared/sim';
import type { GameSnapshot, BootstrapAiVersion } from '../src/shared/types';
import { runGameLoop } from '../src/sdk/game-runner';
import type { AiGameAgent } from '../src/ai/game-runner';
import type { AiPolicyMemory } from '../src/ai/memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import { buildAiPlanTrace, type AiPlanTrace } from '../src/ai/plan-trace';

// An actual native AFK-human/default-AI room. No unit, cash, order, claim or task edits.
const input = 'src/ai/bootstrap_1/fixtures/ring-beachhead-15m.json';
const bytes = readFileSync(input);
const saved: { snapshot: GameSnapshot; nextId: number; memories: Record<string, AiPolicyMemory>; versions: Record<string, BootstrapAiVersion> } = JSON.parse(bytes.toString());
const game = createGame('bareDuel', { aiPlayers: [] });
restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
game.activePlayers = Object.keys(game.players);
const memories = structuredClone(saved.memories), provider = createAiMemoryProvider(memories);
const traces: Record<string, AiPlanTrace> = {}, events: unknown[] = [], frames: unknown[] = [];
const agents: Record<string, AiGameAgent> = Object.fromEntries(Object.entries(saved.versions).map(([id, version]) => [id,
  { controller: 'external-agent', team: game.teams[id] ?? id, race: game.players[id]!.race, version, policyVersion: version }]));
let thinkMs = 0, traceMs = 0, thinks = 0, nodeCount = 0;
const captures = [18015, 18600, 19800];
const planHistory: unknown[] = [];
function capture() {
  frames.push({ tick: game.tick, traces: structuredClone(traces),
    units: game.units.filter(u => u.hp > 0).map(u => ({ id: u.id, owner: u.owner, kind: u.kind, x: u.x, y: u.y, hp: u.hp,
      ...(u.deck ? { shipId: u.deck.shipId } : {}) })),
    buildings: game.buildings.filter(b => b.hp > 0).map(b => ({ id: b.id, owner: b.owner, kind: b.kind, x: b.x, y: b.y, complete: b.complete })),
  });
}
runGameLoop({ name: 'plan-viz-native-ring-room', game, agents, maxTicks: captures.at(-1)!, thinkInterval: 15,
  commandPlanner({ snapshot, owner, agent, source, teams }) {
    const start = performance.now();
    const commands = planAiOwnerCommandEntries(snapshot, { playerId: owner, version: agent.version, source }, { teams, memoryProvider: provider });
    thinkMs += performance.now() - start;
    const traceStart = performance.now();
    const trace = buildAiPlanTrace(snapshot, owner, memories[owner]!, agent.version, traces[owner]);
    traceMs += performance.now() - traceStart; thinks++; nodeCount += trace.nodes.length;
    const rootIds = new Set([...trace.roots, ...(traces[owner]?.roots ?? [])]);
    traces[owner] = trace;
    for (const change of trace.changes) if (rootIds.has(change.nodeId) && change.kind !== 'allocation' && change.kind !== 'utility')
      events.push({ tick: snapshot.tick, owner, ...change });
    if (snapshot.tick % 150 < 15) planHistory.push({ tick: snapshot.tick, owner, roots: trace.roots,
      statuses: trace.nodes.filter(n => trace.roots.includes(n.id)).map(n => ({ id: n.id, status: n.status, reason: n.reasons[0]?.code })) });
    return commands;
  },
}, { onStep() { if (captures.includes(game.tick)) capture(); } });
const out = process.argv[2] ?? '/tmp/ai-plan-viz-capture';
mkdirSync(out, { recursive: true });
const snapshot = snapshotGame(game);
const result = {
  provenance: { input, inputSha256: createHash('sha256').update(bytes).digest('hex'), baseCommit: '883f57c5',
    startTick: saved.snapshot.tick, endTick: game.tick, thinkInterval: 15, secondsPerTick: .05,
    description: '原生环水群岛房间的 15 分钟真实存档，保留 AFK 人类、全部 AI、单位、资源、订单和任务，续跑 90 秒。' },
  map: { id: game.map.id, name: game.map.name, width: game.map.width, height: game.map.height, terrain: game.map.terrain,
    resources: game.resources.map(r => ({ id: r.id, x: r.x, y: r.y, amount: r.amount })) },
  players: Object.fromEntries(Object.entries(saved.versions).map(([owner, version]) => [owner, { version, race: game.players[owner]!.race, team: game.teams[owner] }])),
  frames, events,
  performance: { thinks, nodesPerTrace: nodeCount / thinks, plannerMs: thinkMs, traceMs,
    plannerMeanMs: thinkMs / thinks, traceMeanMs: traceMs / thinks, overheadPercent: traceMs / thinkMs * 100 },
};
writeFileSync(join(out, 'capture.json'), JSON.stringify(result));
writeFileSync(join(out, 'history.json'), JSON.stringify(planHistory));
console.log(JSON.stringify({ provenance: result.provenance, performance: result.performance,
  frames: frames.map((f: any) => ({ tick: f.tick, owners: Object.fromEntries(Object.entries(f.traces as Record<string, AiPlanTrace>).map(([o,t]) => [o,t.nodes.filter(n => t.roots.includes(n.id)).map(n=>({label:n.label,status:n.status,reason:n.reasons[0]?.code}))])) })),
  finalUnits: snapshot.units.length }));
