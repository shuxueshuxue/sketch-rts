import { buildAiPlanTrace } from './plan-trace';
import type { AiPlanTrace } from './plan-trace';
import { projectDeathThinkContext, type AiDeathThinkContext } from './death-ledger-context';
import { createAiPolicyMemory, type AiPolicyMemory, type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./policy";
import { DEFAULT_AI_PLANNER_VERSION, planAiOwnerCommandEntries, type AiMemoryProvider, type AiOwnerPlannerOptions } from "./planner-context";
import type { CommandFrameEntry } from "../sdk/commands/frame";
import { snapshotGame, type Game } from "../shared/sim";
import { normalizeCommandFrameEntries, type CommandFrameRuntimeAiPlanner } from "../shared/sim/command-frame-runtime";
import { PLANNER_COMMAND_DELAY_TICKS, plannerPhase, plannerThinksAt } from "../shared/sim/planner-schedule";
import type { CommandEnvelope } from "../shared/net/types";
import type { GameSnapshot, PlayerId } from "../shared/types";

export const DEFAULT_AI_THINK_INTERVAL = 15;
export const DEFAULT_AI_SCRIPT_VERSION: AiScriptVersion = DEFAULT_AI_PLANNER_VERSION;

export type AiRuntimeState = {
  controlledPlayers: PlayerId[];
  lastThink: Partial<Record<PlayerId, number>>;
  thinkInterval: number;
  scripts?: AiScript[];
  scriptIds?: string[];
  scriptIdsByPlayer?: Partial<Record<PlayerId, string[]>>;
  version: AiScriptVersion;
  versions: Partial<Record<PlayerId, AiScriptVersion>>;
  policyMode?: PresetAiPolicyOptions["policyMode"];
  disabledBehaviorsByPlayer?: Partial<Record<PlayerId, NonNullable<PresetAiPolicyOptions["disabledBehaviors"]>>>;
  memories: Record<PlayerId, AiPolicyMemory>;
};

export type AiRuntimeResult<Source extends string = string> = {
  commands: AiRuntimeIssuedCommand<Source>[];
};

export type AiCommandFrameRequest<Source extends string = string> = {
  playerId: PlayerId;
  source?: Source;
  version?: AiScriptVersion;
  scripts?: AiScript[];
  memory?: AiPolicyMemory;
  disabledBehaviors?: PresetAiPolicyOptions["disabledBehaviors"];
};

export type AiRuntimeIssuedCommand<Source extends string = string> = CommandFrameEntry<Source>;

export type AiRuntimeFramePlannerState = Partial<Record<PlayerId, number>>;

export function createAiRuntime(
  players: PlayerId[],
  options: {
    thinkInterval?: number;
    scripts?: AiScript[];
    scriptIds?: string[];
    scriptIdsByPlayer?: Partial<Record<PlayerId, string[]>>;
    version?: AiScriptVersion;
    versions?: Partial<Record<PlayerId, AiScriptVersion>>;
    policyMode?: PresetAiPolicyOptions["policyMode"];
    disabledBehaviorsByPlayer?: Partial<Record<PlayerId, NonNullable<PresetAiPolicyOptions["disabledBehaviors"]>>>;
  } = {},
): AiRuntimeState {
  const thinkInterval = options.thinkInterval ?? DEFAULT_AI_THINK_INTERVAL;
  const controlledPlayers = [...new Set(players)];
  return {
    controlledPlayers,
    lastThink: Object.fromEntries(players.map((owner) => [owner, -thinkInterval])),
    thinkInterval,
    ...(options.scripts ? { scripts: options.scripts } : {}),
    ...(options.scriptIds ? { scriptIds: [...options.scriptIds] } : {}),
    ...(options.scriptIdsByPlayer ? { scriptIdsByPlayer: cloneScriptIdsByPlayer(options.scriptIdsByPlayer) } : {}),
    version: options.version ?? DEFAULT_AI_SCRIPT_VERSION,
    versions: options.versions ?? {},
    ...(options.policyMode ? { policyMode: options.policyMode } : {}),
    ...(options.disabledBehaviorsByPlayer ? { disabledBehaviorsByPlayer: cloneDisabledBehaviorsByPlayer(options.disabledBehaviorsByPlayer) } : {}),
    memories: Object.fromEntries(controlledPlayers.map((owner) => [owner, createAiPolicyMemory()])) as Record<PlayerId, AiPolicyMemory>,
  };
}

// Each controlled player thinks on its own phase of the shared interval (see @@@planner-schedule), so five AIs spread
// their thinking over the interval instead of all landing on one tick.
function dueAiOwners(game: Game, runtime: AiRuntimeState): PlayerId[] {
  if (game.match.winner) return [];
  const count = runtime.controlledPlayers.length;
  return runtime.controlledPlayers.filter((owner, index) =>
    !!game.players[owner] && plannerThinksAt(game.tick, plannerPhase(index, count, runtime.thinkInterval), runtime.thinkInterval));
}

function claimThink(game: Game, runtime: AiRuntimeState, owners: PlayerId[]): AiCommandFrameRequest[] {
  return owners.map((owner) => {
    runtime.lastThink[owner] = game.tick;
    return runtimeRequestForOwner(runtime, owner);
  });
}

/** Plans the owners due on this tick and returns their commands now, with no delivery delay (tools and tests). */
export function planPresetAiRuntimeCommands(game: Game, runtime: AiRuntimeState, options: PresetAiPolicyOptions = {}): AiRuntimeResult {
  const owners = dueAiOwners(game, runtime);
  if (owners.length === 0) return { commands: [] };
  return planAiCommandFrame(game, claimThink(game, runtime, owners), { ...(runtime.policyMode ? { policyMode: runtime.policyMode } : {}), ...options });
}

// One think: the owners due on `tick`, planned from the world as it stood then. Their commands are due on `deliveryTick`.
export type AiThinkJob = { tick: number; deliveryTick: number; requests: AiCommandFrameRequest[] };

// Where thinks run: right here (createInlineAiThinkExecutor) or beside the simulation on another thread. A think's commands
// land on its delivery tick, or on the first tick after a slow think arrives (see @@@planner-schedule).
export type AiThinkObservation = { trace: AiPlanTrace; context: AiDeathThinkContext };
export type AiThinkObserver = (observation: AiThinkObservation) => void;
export type AiThinkExecutor = {
  observe?(observer?: AiThinkObserver): void;
  // Collect already arrived replies without consuming or applying queued commands.
  poll?(): void;
  // `check` rejects a command that is illegal in the world it was planned from.
  submit(game: Game, job: AiThinkJob, check: (commands: CommandEnvelope[]) => void): void;
  // Whether a think of this owner is still running.
  thinking(owner: PlayerId): boolean;
  // The commands of every think due by this tick that has arrived. `settle` first waits for the rest, where the
  // executor's thread can wait.
  take(tick: number, settle: boolean): CommandEnvelope[];
  // What thinking on another thread has been like since the last report (the ?perf=1 readout shows it).
  report?(): AiThinkReport;
  // Releases whatever the executor holds for the match (a thinking thread's session).
  close?(): void;
};

// Thinks that arrived and how long they took on their thread; thinks that landed after their due tick and by how many
// ticks at most; and turns players skipped because their last think was still running (see @@@planner-schedule).
export type AiThinkReport = { thinks: number; thinkMs: number; slowestMs: number; late: number; lateTicks: number; skipped: number };

export function emptyAiThinkReport(): AiThinkReport {
  return { thinks: 0, thinkMs: 0, slowestMs: 0, late: 0, lateTicks: 0, skipped: 0 };
}

export type AiThinkExecutorFactory = (runtime: AiRuntimeState, game: Game) => AiThinkExecutor;

export function createInlineAiThinkExecutor(runtime: AiRuntimeState): AiThinkExecutor {
  const planned = new Map<number, CommandEnvelope[]>();
  let observer: AiThinkObserver | undefined;
  return {
    observe(next) { observer = next; },
    submit(game, job, check) {
      const result = observer
        ? planAiCommandFrame(game, job.requests, { ...(runtime.policyMode ? { policyMode: runtime.policyMode } : {}), observer })
        : planAiCommandFrame(game, job.requests, runtime.policyMode ? { policyMode: runtime.policyMode } : {});
      const commands = result.commands.map((entry) => ({ playerId: entry.playerId, command: entry.command }));
      check(commands);
      if (commands.length > 0) planned.set(job.deliveryTick, [...(planned.get(job.deliveryTick) ?? []), ...commands]);
    },
    thinking: () => false,
    take(tick) {
      const commands = planned.get(tick) ?? [];
      planned.delete(tick);
      return commands;
    },
  };
}

export type AiFramePlannerOptions = {
  executor?: AiThinkExecutor;
  // Ticks between a think and its commands; 0 lands them on the think's own tick.
  commandDelayTicks?: number;
};

export function createPresetAiRuntimeFramePlanner(game: Game, runtime: AiRuntimeState, options: AiFramePlannerOptions = {}): CommandFrameRuntimeAiPlanner<AiRuntimeFramePlannerState> {
  const delay = options.commandDelayTicks ?? PLANNER_COMMAND_DELAY_TICKS;
  const executor = options.executor ?? createInlineAiThinkExecutor(runtime);
  return {
    checkpoint: () => ({ ...runtime.lastThink }),
    restore: (lastThink) => {
      runtime.lastThink = lastThink;
    },
    plan: (check, settle) => {
      // A player still thinking skips its turn, as a person thinks again once done (see @@@planner-schedule).
      const owners = dueAiOwners(game, runtime).filter((owner) => !executor.thinking(owner));
      if (owners.length > 0) executor.submit(game, { tick: game.tick, deliveryTick: game.tick + delay, requests: claimThink(game, runtime, owners) }, check);
      return executor.take(game.tick, settle);
    },
  };
}

export function planAiRuntimeCommandEntries(game: Game, runtime: AiRuntimeState, owners: PlayerId[] = runtime.controlledPlayers, options: PresetAiPolicyOptions = {}): AiRuntimeIssuedCommand[] {
  if (game.match.winner) return [];
  const requests = owners.map((owner) => runtimeRequestForOwner(runtime, owner));
  return planAiCommandFrame(game, requests, { ...(runtime.policyMode ? { policyMode: runtime.policyMode } : {}), ...options }).commands;
}

export function planAiCommandFrame<Source extends string = string>(game: Game, requests: AiCommandFrameRequest<Source>[], options: AiOwnerPlannerOptions & { observer?: AiThinkObserver } = {}): AiRuntimeResult<Source> {
  return planAiCommandFrameFromSnapshot(snapshotGame(game), requests, { teams: game.teams, ...options });
}

export function planAiCommandFrameFromSnapshot<Source extends string = string>(snapshot: GameSnapshot, requests: AiCommandFrameRequest<Source>[], options: AiOwnerPlannerOptions & { observer?: AiThinkObserver } = {}): AiRuntimeResult<Source> {
  if (snapshot.match.winner) return { commands: [] };
  const { memoryProvider, observer, ...policyOptions } = options;
  return { commands: normalizeCommandFrameEntries(planAiCommandFrameRequestsFromSnapshot(snapshot, requests, policyOptions, memoryProvider, observer)) };
}

function planAiCommandFrameRequestsFromSnapshot<Source extends string = string>(snapshot: GameSnapshot, requests: AiCommandFrameRequest<Source>[], policyOptions: AiOwnerPlannerOptions = {}, memoryProvider?: AiMemoryProvider, observer?: AiThinkObserver) {
  const planned: AiRuntimeIssuedCommand<Source>[] = [];
  // @@@shared-ai-frame - All requests of one think reason over one world frame; replay/SDK equivalence depends on this.
  for (const request of requests) {
    const options = { ...policyOptions, ...(memoryProvider ? { memoryProvider } : {}) };
    if (observer) {
      let strategy: import('./strategy/bootstrap-control').BootstrapStrategyOutput | undefined;
      let memory = request.memory ?? policyOptions.memory;
      const observingProvider: AiMemoryProvider = {
        get(owner) { const value = memoryProvider?.get(owner); if(owner===request.playerId && value) memory=value; return value; },
        set(owner,value) { if(owner===request.playerId)memory=value; memoryProvider?.set?.(owner,value); },
      };
      // Commit commands before touching diagnostics. An output/consumer fault must never discard a completed think.
      planned.push(...planAiOwnerCommandEntries(snapshot,request,{...options,memoryProvider:observingProvider,
        observeBootstrapPlan(context, entries, actual) {
          strategy = actual; policyOptions.observeBootstrapPlan?.(context, entries, actual);
        }}));
      try {
        const observed = memory ?? createAiPolicyMemory();
        const base = buildAiPlanTrace(snapshot,request.playerId,observed,request.version??DEFAULT_AI_PLANNER_VERSION);
        observer({trace:{ ...(strategy?.project ? { ...base, strategy: strategy.project() } : base),
          ...(strategy?.goalPlanner ? { goalPlanner: strategy.goalPlanner } : {}) },
          context:projectDeathThinkContext(snapshot,request.playerId,observed)});
      } catch(error) { console.error('AI plan observation failed',error); }
    } else planned.push(...planAiOwnerCommandEntries(snapshot, request, options));
  }

  return planned;
}

function runtimeRequestForOwner(runtime: AiRuntimeState, owner: PlayerId): AiCommandFrameRequest {
  const scriptIds = runtimeScriptIdsForOwner(runtime, owner);
  return {
    playerId: owner,
    version: runtime.versions[owner] ?? runtime.version,
    ...(runtime.scripts ? { scripts: runtime.scripts } : {}),
    ...(scriptIds ? { scriptIds } : {}),
    memory: runtime.memories[owner] ?? (runtime.memories[owner] = createAiPolicyMemory()),
    ...(runtime.disabledBehaviorsByPlayer?.[owner] ? { disabledBehaviors: runtime.disabledBehaviorsByPlayer[owner] } : {}),
  };
}

function runtimeScriptIdsForOwner(runtime: AiRuntimeState, owner: PlayerId) {
  return runtime.scriptIdsByPlayer?.[owner] ?? runtime.scriptIds;
}

function cloneScriptIdsByPlayer(value: Partial<Record<PlayerId, string[]>>) {
  return Object.fromEntries(Object.entries(value).map(([owner, scriptIds]) => [owner, scriptIds ? [...scriptIds] : scriptIds])) as Partial<Record<PlayerId, string[]>>;
}

function cloneDisabledBehaviorsByPlayer(value: Partial<Record<PlayerId, NonNullable<PresetAiPolicyOptions["disabledBehaviors"]>>>) {
  return Object.fromEntries(Object.entries(value).map(([owner, disabled]) => [owner, disabled ? [...disabled] : disabled])) as Partial<Record<PlayerId, NonNullable<PresetAiPolicyOptions["disabledBehaviors"]>>>;
}
