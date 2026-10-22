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
import { UNIT_DEFS, RACE_TECH_RULES } from '../../../../shared/catalog';
import { sameGround } from '../../../../shared/terrain';
import type { GameCommand } from '../../../../shared/types';
import { createInterference } from './interference';
import type { DisruptionCase } from './scenes';
import { departureProtection, retreatInterception } from './protection';

export function runDisruption(puzzle: DisruptionCase, options: { version?: AiScriptVersion;
  out?: string; maxTicks?: number; ownerPlanner?: SdkGameCommandPlanner<AiGameAgent> } = {}) {
  const world = puzzle.create(), { game, owner, opponent } = world;
  const interception = retreatInterception(world);
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
  const departureEvidence: ReturnType<typeof departureProtection>[] = [], departureSeen = new Set<string>();
  const previousWorkerX = new Map(game.units.filter(u => u.owner === owner && u.kind === 'worker').map(u => [u.id, u.x]));
  const physicalEntrances: ReturnType<typeof departureProtection>[] = [], entrySeen = new Set<string>();
  const speedObservations = new Map<string, { id: string; kind: string; firstTick: number; maxSpeed: number; mounted: boolean }>();
  const producerKinds = new Map<string, number>();
  const localDamage = new Set<string>(), firstResponse: unknown[] = [], attribution: unknown[] = [];
  let actualOpponentCommands = 0;
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
      if (puzzle.key === 'worker-ambush' && interruption.state.trigger) {
        const cmd = e.command;
        const going = (cmd.type === 'move' || cmd.type === 'attackMove' || cmd.type === 'build') && cmd.x > world.road!.x
          || cmd.type === 'mine' && cmd.resourceId === world.mine.id;
        const actors = 'unitIds' in cmd ? cmd.unitIds : 'unitId' in cmd ? [cmd.unitId] : [];
        if (going) for (const id of actors) {
          const u = context.snapshot.units.find(u => u.id === id && u.kind === 'worker');
          if (u && u.x < 1280 && id !== interruption.state.trigger.targetId && !departureSeen.has(id)) {
            departureSeen.add(id); const proof = departureProtection(context.snapshot, world, u, new Set(interruption.state.kills.map(k => k.unit.id)));
            departureEvidence.push(proof); write('departure-protection', { ...proof, nativeProposal: e });
          }
        }
      }
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
    maxTicks: game.tick + (options.maxTicks ?? puzzle.maxTicks), thinkInterval: puzzle.variant === 'fast-hit-run' ? 1 : 15,
    agents: { [owner]: { controller: 'internal-ai', team: owner, race: 'grove', version: options.version ?? 'v9_knight' },
      [opponent]: { controller: 'external-agent', team: opponent, race: 'ember', version: 'v9_knight' } },
    commandPlanner: context => context.owner === owner
      ? puzzle.variant === 'fast-hit-run' && context.snapshot.tick % 15 !== 0 ? [] : ownPlanner(context)
      : interruption.planner(context),
  }, {
    onCommand(e) { const row = { tick: e.tick, owner: e.owner, source: e.source, scriptId: e.scriptId, command: e.command };
      write('sdk', row); if (e.owner === opponent) actualOpponentCommands++; if (e.owner === owner) ownCommands.push({ tick: e.tick, scriptId: e.scriptId, command: e.command });
    },
    onStep() {
      interruption.observeWorld();
      if (puzzle.variant === 'fast-hit-run') {
        for (const u of game.units) if (u.owner === owner && u.kind !== 'worker' && !UNIT_DEFS[u.kind].naval && u.hp > 0) {
          const prior = speedObservations.get(u.id);
          speedObservations.set(u.id, { id: u.id, kind: u.kind, firstTick: prior?.firstTick ?? game.tick,
            maxSpeed: Math.max(prior?.maxSpeed ?? 0, u.speed), mounted: UNIT_DEFS[u.kind].bodyForm === 'mounted' });
        }
        for (const b of game.buildings) if (b.owner === owner && b.complete && b.hp > 0 && !producerKinds.has(b.kind)) producerKinds.set(b.kind, game.tick);
      }
      if (puzzle.key === 'worker-ambush' && interruption.state.trigger) for (const u of game.units) {
        if (u.owner === owner && u.kind === 'worker' && u.x >= 1280 && u.x < 3712 && u.y >= 704 && u.y <= 896
          && (previousWorkerX.get(u.id) ?? u.x) < 1280 && u.id !== interruption.state.trigger.targetId && !entrySeen.has(u.id)) {
          entrySeen.add(u.id); const proof = departureProtection(snapshotGame(game), world, u, new Set(interruption.state.kills.map(k => k.unit.id)));
          physicalEntrances.push(proof); write('road-entrances', proof);
        }
      }
      for (const u of game.units) if (u.owner === owner && u.kind === 'worker') previousWorkerX.set(u.id, u.x);
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
        assignments: structuredClone(Object.values(lastMemory?.strategyAllocation?.assignments ?? {}).filter(a => a.unitId === e.unit.id)),
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
  const navalAbandoned = Object.values(lastMemory?.naval?.conquests ?? {}).filter(o => o.abandonedTick !== undefined);
  const workerDeaths = interruption.state.removed.filter(e => e.unit.owner === owner && e.unit.kind === 'worker' && e.reason === 'death');
  const newHullDamagedBySameLiveCause = interruption.state.damage.filter(e => e.target.owner === owner && e.target.kind === 'transport'
    && e.target.id !== originalHull && e.source.present && world.interceptors.includes(e.source.id));
  const checks = puzzle.key === 'transport-sunk' ? {
    interferenceTriggered: !!interruption.state.trigger, originalHullSunk: !!interruption.state.loss && world.interceptors.includes(interruption.state.loss.actualKill?.source.id ?? ''),
    correctPayloadLoss: puzzle.variant === 'empty' ? oldPassengerLosses.length === 0 : oldPassengerLosses.length > 0,
    noDeadActorRecommands: staleProposals.length === 0, noUnsafeReplacementHullDamage: newHullDamagedBySameLiveCause.length === 0, noSecondHullLostToSameEnemy: repeatedHullLosses.length === 0,
    replacementOrExplicitAbandonment: puzzle.variant === 'poor' ? abandoned.length + navalAbandoned.length > 0 : createdTransports.size > 0,
    targetOrExplicitAbandonment: puzzle.variant === 'poor' ? abandoned.length + navalAbandoned.length > 0 : milestones['hall-complete'] !== undefined,
  } : puzzle.key === 'worker-ambush' ? {
    interferenceTriggered: !!interruption.state.trigger,
    ...(puzzle.variant === 'fast-hit-run' ? {} : { originalWorkerKilled: !!interruption.state.loss && world.interceptors.includes(interruption.state.loss.actualKill?.source.id ?? '') }),
    noDeadActorRecommands: staleProposals.length === 0, noRepeatedWorkerDeathToSameEnemy: repeatedWorkerLosses.length === 0,
    workerDeathsAtMostOne: workerDeaths.length <= 1,
    secondWorkerProtectedBeforeDeparture: departureEvidence.filter(e => e.tick >= (interruption.state.loss?.tick ?? (puzzle.variant === 'fast-hit-run' ? interruption.state.trigger?.tick : undefined) ?? Infinity)).every(e => e.positive)
      && physicalEntrances.filter(e => e.tick >= (interruption.state.loss?.tick ?? (puzzle.variant === 'fast-hit-run' ? interruption.state.trigger?.tick : undefined) ?? Infinity)).every(e => e.positive),
    loopExercisedOrRaidersCleared: (puzzle.variant !== 'hit-run' && puzzle.variant !== 'fast-hit-run') || interruption.state.cycles.length >= 3
      || world.interceptors.every(id => kills.some(k => k.unit.id === id)),
    targetComplete: milestones['hall-complete'] !== undefined,
  } : {
    interferenceTriggered: !!interruption.state.trigger,
    islandClearContinuedOrReasonedInterruption: puzzle.variant === 'small' ? milestones['camp-cleared'] !== undefined
      && !mainSwaps.some(e => e.region === 'home-land') : abandoned.length > 0 || milestones['camp-cleared'] !== undefined,
    localDefenseUsed: puzzle.variant === 'large' || localDamage.size > 0,
    noArmyPingPong: world.mainForce.every(id => mainSwaps.filter(e => e.unitId === id && e.region === 'home-land').length <= 1),
  };
  const initialEnemySpeed = Math.min(...initial.units.filter(u => world.interceptors.includes(u.id)).map(u => u.speed));
  const producible = Object.entries(RACE_TECH_RULES.grove.units).filter(([kind, rule]) => kind !== 'worker' && !UNIT_DEFS[kind as keyof typeof UNIT_DEFS].naval && producerKinds.has(rule.at))
    .map(([kind, rule]) => ({ kind, baseSpeed: UNIT_DEFS[kind as keyof typeof UNIT_DEFS].speed, producer: rule.at, producerFirstCompleteTick: producerKinds.get(rule.at)!,
      note: 'Producer exists; supply/technology/payment eligibility is not inferred.' }));
  const speedPremise = puzzle.variant === 'fast-hit-run' ? { initialEnemySpeed, actualOwnCombat: [...speedObservations.values()], producerAvailableKinds: producible,
    allObservedOwnCombatSlower: [...speedObservations.values()].every(u => u.maxSpeed < initialEnemySpeed),
    allObservedOwnCombatUnmounted: [...speedObservations.values()].every(u => !u.mounted),
    allProducerPotentialKindsSlower: producible.every(u => u.baseSpeed < initialEnemySpeed),
    interpretation: 'Speeds are native observations. No production, research, catalogue or AI option is disabled to enforce a result; a new faster producer/unit invalidates the corresponding premise.' } : null;
  const summary = { puzzle: `${puzzle.key}/${puzzle.variant}`, thinkCount: think, maxTicks: options.maxTicks ?? puzzle.maxTicks,
    initialSnapshotSha256: createHash('sha256').update(JSON.stringify(initial)).digest('hex'), initialTick: initial.tick,
    triggerRule: puzzle.triggerRule, responseRule: puzzle.responseRule, behaviorChecksPassed: Object.values(checks).every(Boolean), publicPlannerAcceptance: null, checks,
    missingFormalAcceptance: ['post-loss fact-driven replan and remaining-chain requote', 'cause-linked interruption and death ledger', 'full proportional response and nonpositive-value abandonment evidence'], milestones,
    interception, speedPremise, fogOfWar: false, cycles: interruption.state.cycles,
    cycleCoverage: (puzzle.variant !== 'hit-run' && puzzle.variant !== 'fast-hit-run') ? null : { actualCycles: interruption.state.cycles.length,
      atLeast3OrAttackersCleared: interruption.state.cycles.length >= 3 || world.interceptors.every(id => kills.some(k => k.unit.id === id)),
      limitation: 'No owner worker or retry is injected to force cycles; if AI stalls, coverage remains explicit and target liveness fails.' },
    departureEvidence, physicalEntrances, workerDeaths, newHullDamagedBySameLiveCause,
    trigger: interruption.state.trigger, confirmedLoss: interruption.state.loss, firstPostLossThink: firstLossThink,
    repeatedHullLosses, repeatedWorkerLosses, oldPassengerLosses, staleProposals, mainSwaps,
    createdTransportIds: [...createdTransports], createdSoldierIds: [...createdSoldiers], localDefenderIdsWithActualDamage: [...localDamage],
    abandonmentEvidence: { allocation: abandoned, naval: navalAbandoned }, deaths: attribution,
    sdkCommands: ownCommands.length, opponentSdkCommands: actualOpponentCommands, opponentProposals: interruption.state.commands.length,
    scenarioStatus: interruption.state.trigger ? 'world-trigger-observed' : 'trigger-not-reached-no-postloss-verdict',
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
