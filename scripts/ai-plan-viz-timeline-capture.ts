import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../src/shared/sim';
import type { Unit, GameSnapshot, BootstrapAiVersion } from '../src/shared/types';
import { runGameLoop } from '../src/sdk/game-runner';
import type { AiGameAgent } from '../src/ai/game-runner';
import type { AiPolicyMemory } from '../src/ai/memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import { buildAiPlanTrace, type AiPlanTrace } from '../src/ai/plan-trace';

// Presentation observer only. The native fixture, planner, scheduling and command stream are unchanged.
const input = 'src/ai/bootstrap_1/fixtures/ring-beachhead-15m.json';
const bytes = readFileSync(input);
const saved: { snapshot: GameSnapshot; nextId: number; memories: Record<string, AiPolicyMemory>; versions: Record<string, BootstrapAiVersion> } = JSON.parse(bytes.toString());
const game = createGame('bareDuel', { aiPlayers: [] });
restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
game.activePlayers = Object.keys(game.players);
const memories = structuredClone(saved.memories), provider = createAiMemoryProvider(memories);
const traces: Record<string, AiPlanTrace> = {}, thinks: unknown[] = [], frames: unknown[] = [], events: any[] = [];
const lastCommands = new Map<string, { tick: number; scriptId: string; type: string }>();
const fatal = new Map<string, { id: string; owner: string; kind: string; tick: number }>();
const dead = new Set<string>();
const unitCatalog: any[] = [], buildingCatalog: any[] = [], unitIndex = new Map<string, number>(), buildingIndex = new Map<string, number>();
const commandHash = createHash('sha256');
let commandCount = 0;
const agents: Record<string, AiGameAgent> = Object.fromEntries(Object.entries(saved.versions).map(([id, version]) => [id,
  { controller: 'external-agent', team: game.teams[id] ?? id, race: game.players[id]!.race, version, policyVersion: version }]));
const endTick = Number(process.argv[3] ?? 19800);
const observe = process.env.PLAN_VIZ_OBSERVE !== '0';
const r = (n: number) => Math.round(n * 10) / 10;
function indexUnit(u: Unit) {
  if (!unitIndex.has(u.id)) { unitIndex.set(u.id, unitCatalog.length); unitCatalog.push({ id: u.id, owner: u.owner, kind: u.kind, maxHp: u.maxHp }); }
  return unitIndex.get(u.id)!;
}
function capture() {
  frames.push({ tick: game.tick,
    units: game.units.filter(u => u.hp > 0).map(u => [indexUnit(u), r(u.x), r(u.y), r(u.hp), ...(u.deck ? [unitIndex.get(u.deck.shipId) ?? -1] : [])]),
    buildings: game.buildings.filter(b => b.hp > 0).map(b => {
      if (!buildingIndex.has(b.id)) { buildingIndex.set(b.id, buildingCatalog.length); buildingCatalog.push({ id: b.id, owner: b.owner, kind: b.kind, x: r(b.x), y: r(b.y) }); }
      return [buildingIndex.get(b.id)!, b.complete ? 1 : 0, r(b.hp)];
    }),
  });
}
function subtree(trace: AiPlanTrace, id: string): string[] {
  const n = trace.nodes.find(n => n.id === id);
  return n ? [...n.resources.unitIds, ...n.children.flatMap(c => subtree(trace, c))] : [];
}
function loss(u: Unit, cause: string) {
  if (dead.has(u.id)) return;
  dead.add(u.id);
  const trace = traces[u.owner];
  const roots = trace?.roots.filter(id => trace.nodes.find(n => n.id === id)?.selected && subtree(trace, id).includes(u.id)) ?? [];
  const storedClaim = memories[u.owner]?.unitClaims[u.id];
  const claim = storedClaim && storedClaim.expiresTick >= game.tick ? storedClaim : undefined;
  const matched = trace?.nodes.filter(n => n.selected && n.resources.unitIds.includes(u.id));
  const order = structuredClone(u.order), command = lastCommands.get(u.id);
  // Suspicion is deliberately a narrow, auditable heuristic, not a planner verdict.
  const concern = u.kind === 'worker' || u.order.type === 'idle' || u.order.type === 'move' || /retreat|heal|safety/i.test(command?.scriptId ?? '');
  events.push({ id: `death:${u.id}`, type: 'death', tick: game.tick, unitId: u.id, owner: u.owner, kind: u.kind,
    x: r(u.x), y: r(u.y), killer: fatal.get(u.id) ?? null, cause,
    attribution: { certainty: 'inferred', rootIds: roots, stages: matched?.filter(n => !trace!.roots.includes(n.id)).map(n => ({ id: n.id, label: n.label })) ?? [],
      claim: claim ? structuredClone(claim) : null, order, command: command ?? null,
      assessment: concern ? 'review' : 'unclassified',
      reason: concern ? '工人、移动/空闲订单或撤退相关执行器下阵亡，需复核；不能仅凭订单认定异常。' : '缺少目标接受的战损与局部兵力上下文，暂不判定正常或异常。' } });
}
// All damage facts come from the existing read-only simulation observer; no effects are synthesized.
if (observe) game.observer = { hit(attacker, target, _damage, hpBefore) {
  if (hpBefore > 0 && target.hp <= 0) fatal.set(target.id, { id: attacker.id, owner: attacker.owner, kind: attacker.kind, tick: game.tick });
} };
let beforeUnits: Unit[] = [], beforeBuildings: typeof game.buildings = [];
capture();
runGameLoop({ name: 'plan-viz-timeline-native-ring-room', game, agents, maxTicks: endTick, thinkInterval: 15,
  commandPlanner({ snapshot, owner, agent, source, teams }) {
    const commands = planAiOwnerCommandEntries(snapshot, { playerId: owner, version: agent.version, source }, { teams, memoryProvider: provider });
    if (!observe) return commands;
    const trace = buildAiPlanTrace(snapshot, owner, memories[owner]!, agent.version, traces[owner]);
    traces[owner] = trace;
    thinks.push({ trace, claims: Object.entries(memories[owner]!.unitClaims).filter(([, c]) => c.expiresTick >= snapshot.tick)
      .map(([id, c]) => ({ id, kind: c.kind, targetId: c.targetId, sinceTick: c.sinceTick, arrived: c.arrived ?? null, returning: c.returning ?? false })) });
    return commands;
  },
}, {
  onCommand({ tick, owner, scriptId, command }) {
    commandHash.update(JSON.stringify({ tick, owner, scriptId, command }) + '\n'); commandCount++;
    if (observe && 'unitIds' in command) for (const id of command.unitIds) lastCommands.set(id, { tick, scriptId, type: command.type });
  },
  beforeStep() { if (!observe) return; beforeUnits = [...game.units]; beforeBuildings = [...game.buildings]; },
  onStep() {
    if (!observe) return;
    // Dead objects remain readable after removal. Expired summons and scripted exits have hp > 0 and are excluded.
    for (const u of beforeUnits) if (u.hp <= 0 && saved.versions[u.owner]) loss(u, u.deck && !game.units.some(s => s.id === u.deck!.shipId) ? 'ship-loss' : 'combat');
    for (const b of beforeBuildings) if (b.hp <= 0 && saved.versions[b.owner]) events.push({ id: `building:${b.id}`, type: 'building-loss', tick: game.tick,
      entityId: b.id, owner: b.owner, kind: b.kind, x: r(b.x), y: r(b.y), killer: fatal.get(b.id) ?? null });
    if (game.tick % 20 === 0 || game.tick === endTick) capture();
  },
});
const out = process.argv[2] ?? '/tmp/ai-plan-viz-timeline';
mkdirSync(out, { recursive: true });
const result = {
  provenance: { input, inputSha256: createHash('sha256').update(bytes).digest('hex'), baseCommit: '3c0844e3',
    startTick: saved.snapshot.tick, endTick: game.tick, thinkInterval: 15, frameInterval: 20, secondsPerTick: .05,
    description: '真实原生环水群岛存档的连续 90 秒；不编辑单位、资源、订单或 AI 状态。',
    commandCount, commandSha256: commandHash.digest('hex'), finalWorldSha256: createHash('sha256').update(JSON.stringify(snapshotGame(game))).digest('hex') },
  map: { id: game.map.id, name: game.map.name, width: game.map.width, height: game.map.height, terrain: game.map.terrain,
    resources: game.resources.map(res => ({ id: res.id, x: res.x, y: res.y, amount: res.amount })) },
  players: Object.fromEntries(Object.entries(saved.versions).map(([owner, version]) => [owner, { version, race: game.players[owner]!.race, team: game.teams[owner] }])),
  unitCatalog, buildingCatalog, frames, thinks, events,
};
writeFileSync(join(out, 'capture.json'), JSON.stringify(result));
console.log(JSON.stringify({ provenance: result.provenance, frames: frames.length, thinks: thinks.length,
  deaths: events.filter(e => e.type === 'death').length, buildingsLost: events.filter(e => e.type === 'building-loss').length,
  reviews: events.filter(e => e.attribution?.assessment === 'review').length }));
