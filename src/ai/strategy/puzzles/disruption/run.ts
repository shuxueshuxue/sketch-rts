import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runAiGameLoop, type AiGameAgent } from '../../../game-runner';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../../../planner-context';
import type { AiPolicyMemory } from '../../../memory';
import type { AiScriptVersion } from '../../../policy';
import type { SdkGameCommandPlanner } from '../../../../sdk/game-runner';
import { snapshotGame } from '../../../../shared/sim';
import { UNIT_DEFS } from '../../../../shared/catalog';
import { sameGround } from '../../../../shared/terrain';
import type { GameCommand } from '../../../../shared/types';
import { createInterference } from './interference';
import type { DisruptionCase } from './scenes';

export function runDisruption(puzzle: DisruptionCase, options: { version?: AiScriptVersion;
  out?: string; maxTicks?: number; ownerPlanner?: SdkGameCommandPlanner<AiGameAgent> } = {}) {
  const world = puzzle.create(), { game, owner, opponent } = world;
  const initial = snapshotGame(game), initialBuildingIds = new Set(game.buildings.map(b => b.id));
  const originalUnits = new Set(game.units.filter(u => u.owner === owner).map(u => u.id));
  const out = options.out && resolve(options.out); if (out) mkdirSync(out, { recursive: true });
  const write = (stream: string, value: unknown) => { if (out) appendFileSync(resolve(out, stream + '.jsonl.gz'), gzipSync(JSON.stringify(value) + '\n')); };
  if (out) writeFileSync(resolve(out, 'initial.json.gz'), gzipSync(JSON.stringify(initial)));
  const memoryProvider = createAiMemoryProvider(), interruption = createInterference(puzzle, world, (kind, value) => write('events', { kind, value }));
  const milestones: Record<string, number> = {}, ownCommands: { tick: number; scriptId: string; command: GameCommand }[] = [];
  const staleProposals: { tick: number; unitIds: string[]; command: GameCommand }[] = [];
  const mainSwaps: { tick: number; unitId: string; region: string }[] = [];
  const lastRegion = new Map<string, string>(), createdTransports = new Set<string>(), createdSoldiers = new Set<string>();
  const localDamage = new Set<string>(), firstResponse: unknown[] = [], attribution: unknown[] = [];
  let firstLossThink: number | null = null, think = 0, lastMemory: AiPolicyMemory | undefined;
  const mark = (key: string, when: boolean) => { if (when && milestones[key] === undefined) milestones[key] = game.tick; };
  const ownPlanner: SdkGameCommandPlanner<AiGameAgent> = options.ownerPlanner ?? (context => {
    think++;
    const before = structuredClone(memoryProvider.get(owner) ?? null);
    const entries = planAiOwnerCommandEntries(context.snapshot, { playerId: owner, source: context.source, version: context.agent.version },
      { teams: context.teams, memoryProvider });
    lastMemory = memoryProvider.get(owner);
    const dead = new Set(interruption.state.removed.filter(e => e.reason === 'death').map(e => e.unit.id));
    for (const e of entries) {
      const ids = 'unitIds' in e.command ? e.command.unitIds : 'unitId' in e.command ? [e.command.unitId] : [];
      const missing = ids.filter(id => dead.has(id)); if (missing.length) staleProposals.push({ tick: context.snapshot.tick, unitIds: missing, command: e.command });
    }
    if (interruption.state.loss && firstLossThink === null) firstLossThink = game.tick;
    const response = { tick: game.tick, think, liveTransportIds: context.snapshot.units.filter(u => u.owner === owner && u.kind === 'transport').map(u => u.id),
      liveSoldierIds: context.snapshot.units.filter(u => u.owner === owner && u.kind !== 'worker' && !UNIT_DEFS[u.kind].naval).map(u => u.id),
      loss: interruption.state.loss, memoryBefore: before, memoryAfter: lastMemory, returnedCommands: entries, snapshot: context.snapshot };
    write('thinks', response);
    if (interruption.state.loss && firstResponse.length < 3) firstResponse.push(response);
    return entries;
  });
  const firstObserver = interruption.state.removed;
  const result = runAiGameLoop({ name: `public-disruption:${puzzle.key}:${puzzle.variant}`, game,
    maxTicks: game.tick + (options.maxTicks ?? puzzle.maxTicks), thinkInterval: 15,
    agents: { [owner]: { controller: 'internal-ai', team: owner, race: 'grove', version: options.version ?? 'v9_knight' },
      [opponent]: { controller: 'external-agent', team: opponent, race: 'ember', version: 'v9_knight' } },
    commandPlanner: context => context.owner === owner ? ownPlanner(context) : interruption.planner(context),
  }, {
    onCommand(e) { const row = { tick: e.tick, owner: e.owner, source: e.source, scriptId: e.scriptId, command: e.command };
      write('sdk', row); if (e.owner === owner) ownCommands.push({ tick: e.tick, scriptId: e.scriptId, command: e.command });
    },
    onStep() {
      const guardsAlive = world.guards.some(u => game.units.includes(u) && u.hp > 0);
      mark('trigger', interruption.state.trigger !== null); mark('victim-loss', interruption.state.loss !== null);
      mark('camp-cleared', world.guards.length > 0 && !guardsAlive);
      mark('hall-complete', game.buildings.some(b => b.owner === owner && b.kind === 'townHall' && b.hp > 0 && b.complete
        && !initialBuildingIds.has(b.id) && sameGround(game.map, b, world.mine) && Math.hypot(b.x - world.mine.x, b.y - world.mine.y) <= 300));
      mark('interceptors-cleared', !interruption.liveInterceptors().length);
      for (const u of game.units.filter(u => u.owner === owner && u.hp > 0 && !originalUnits.has(u.id))) {
        if (u.kind === 'transport') createdTransports.add(u.id);
        else if (u.kind !== 'worker' && !UNIT_DEFS[u.kind].naval) createdSoldiers.add(u.id);
      }
      for (const id of world.mainForce) {
        const u = game.units.find(u => u.id === id && u.hp > 0); if (!u) continue;
        const region = u.deck || u.cabin ? 'aboard' : sameGround(game.map, u, world.mine) ? 'target-land' : sameGround(game.map, u, world.home) ? 'home-land' : 'other';
        if (lastRegion.has(id) && lastRegion.get(id) !== region) mainSwaps.push({ tick: game.tick, unitId: id, region });
        lastRegion.set(id, region);
      }
      for (const e of firstObserver.slice(attribution.length)) attribution.push({ native: e,
        actualMatchingKill: interruption.state.kills.find(k => k.unit.id === e.unit.id) ?? null,
        assignments: Object.values(lastMemory?.strategyAllocation?.assignments ?? {}).filter(a => a.unitId === e.unit.id),
        note: 'Only original native source and original authority at observation time; empty attribution is not invented.' });
    },
  });
  interruption.dispose();
  for (const e of interruption.state.damage) if (world.localDefenders.includes(e.source.id) && world.interceptors.includes(e.target.id)) localDamage.add(e.source.id);
  // Enemy observer retains damage in either direction, so local response is native damage, not orders.
  const kills = interruption.state.kills, originalHull = world.transport?.id;
  const repeatedHullLosses = kills.filter(e => e.unit.owner === owner && e.unit.kind === 'transport' && e.unit.id !== originalHull && world.interceptors.includes(e.source.id));
  const repeatedWorkerLosses = kills.filter(e => e.unit.owner === owner && e.unit.kind === 'worker'
    && e.unit.id !== interruption.state.trigger?.targetId && world.interceptors.includes(e.source.id));
  const oldPassengerLosses = kills.filter(e => interruption.state.trigger?.passengerIds.includes(e.unit.id));
  const abandoned = Object.values(lastMemory?.strategyAllocation?.objectives ?? {}).filter(o => o.status === 'abandoned');
  const navalAbandoned = Object.values(lastMemory?.naval?.conquests ?? {}).filter(o => 'status' in o && o.status === 'abandoned');
  const checks = puzzle.key === 'transport-sunk' ? {
    interferenceTriggered: !!interruption.state.trigger, originalHullSunk: !!interruption.state.loss,
    correctPayloadLoss: puzzle.variant === 'empty' ? oldPassengerLosses.length === 0 : oldPassengerLosses.length > 0,
    noDeadActorRecommands: staleProposals.length === 0, noSecondHullLostToSameEnemy: repeatedHullLosses.length === 0,
    replacementOrExplicitAbandonment: puzzle.variant === 'poor' ? abandoned.length + navalAbandoned.length > 0 : createdTransports.size > 0,
    targetOrExplicitAbandonment: puzzle.variant === 'poor' ? abandoned.length + navalAbandoned.length > 0 : milestones['hall-complete'] !== undefined,
  } : puzzle.key === 'worker-ambush' ? {
    interferenceTriggered: !!interruption.state.trigger, originalWorkerKilled: !!interruption.state.loss,
    noDeadActorRecommands: staleProposals.length === 0, noRepeatedWorkerDeathToSameEnemy: repeatedWorkerLosses.length === 0,
    targetComplete: milestones['hall-complete'] !== undefined,
  } : {
    interferenceTriggered: !!interruption.state.trigger,
    islandClearContinuedOrReasonedInterruption: puzzle.variant === 'small' ? milestones['camp-cleared'] !== undefined
      && !mainSwaps.some(e => e.region === 'home-land') : abandoned.length > 0 || milestones['camp-cleared'] !== undefined,
    localDefenseUsed: puzzle.variant === 'large' || localDamage.size > 0,
    noArmyPingPong: world.mainForce.every(id => mainSwaps.filter(e => e.unitId === id && e.region === 'home-land').length <= 1),
  };
  const summary = { puzzle: `${puzzle.key}/${puzzle.variant}`, thinkCount: think, maxTicks: options.maxTicks ?? puzzle.maxTicks,
    initialSnapshotSha256: createHash('sha256').update(JSON.stringify(initial)).digest('hex'), initialTick: initial.tick,
    triggerRule: puzzle.triggerRule, responseRule: puzzle.responseRule, passed: Object.values(checks).every(Boolean), checks, milestones,
    trigger: interruption.state.trigger, confirmedLoss: interruption.state.loss, firstPostLossThink: firstLossThink,
    repeatedHullLosses, repeatedWorkerLosses, oldPassengerLosses, staleProposals, mainSwaps,
    createdTransportIds: [...createdTransports], createdSoldierIds: [...createdSoldiers], localDefenderIdsWithActualDamage: [...localDamage],
    abandonmentEvidence: { allocation: abandoned, naval: navalAbandoned }, deaths: attribution,
    sdkCommands: ownCommands.length, opponentSdkCommands: interruption.state.commands.length,
    elapsedMs: result.elapsedMs, cpuMs: result.cpuMs,
    final: { tick: result.snapshot.tick, ownerGold: result.snapshot.players[owner]!.gold,
      originalArmy: world.army.map(u => ({ id: u.id, present: game.units.includes(u), hp: u.hp, x: u.x, y: u.y })),
      interceptors: world.interceptors.map(id => game.units.find(u => u.id === id) ?? { id, present: false }),
      guardsAlive: world.guards.filter(u => game.units.includes(u) && u.hp > 0).map(u => u.id) },
    scope: 'Native main AI behavior baseline only. Physical behavior and missing formal fact/requote/attribution evidence remain distinct; a never-triggered scene does not prove interruption handling failed.' };
  if (out) {
    writeFileSync(resolve(out, 'final.json.gz'), gzipSync(JSON.stringify(result.snapshot)));
    writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    writeFileSync(resolve(out, 'interference.json.gz'), gzipSync(JSON.stringify(interruption.state)));
  }
  return { world, summary, state: interruption.state, final: result.snapshot };
}
