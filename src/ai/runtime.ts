import { createAiPolicyMemory, type AiPolicyMemory, type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./policy";
import { DEFAULT_AI_PLANNER_VERSION, planAiOwnerCommandEntries, type AiMemoryProvider } from "./planner-context";
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

// One think: the owners due on `tick`, planned from the world as it stood then. Their commands land on `deliveryTick`.
export type AiThinkJob = { tick: number; deliveryTick: number; requests: AiCommandFrameRequest[] };

// Where thinks run: right here (createInlineAiThinkExecutor) or beside the simulation on another thread. A think's commands
// land on its delivery tick either way, so the match is the same (see @@@planner-schedule).
export type AiThinkExecutor = {
  // `check` rejects a command that is illegal in the world it was planned from.
  submit(game: Game, job: AiThinkJob, check: (commands: CommandEnvelope[]) => void): void;
  // Whether every think due by this tick has been planned.
  ready(tick: number): boolean;
  take(tick: number): CommandEnvelope[];
};

export function createInlineAiThinkExecutor(runtime: AiRuntimeState): AiThinkExecutor {
  const planned = new Map<number, CommandEnvelope[]>();
  return {
    submit(game, job, check) {
      const result = planAiCommandFrame(game, job.requests, runtime.policyMode ? { policyMode: runtime.policyMode } : {});
      const commands = result.commands.map((entry) => ({ playerId: entry.playerId, command: entry.command }));
      check(commands);
      if (commands.length > 0) planned.set(job.deliveryTick, [...(planned.get(job.deliveryTick) ?? []), ...commands]);
    },
    ready: () => true,
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
    ready: () => executor.ready(game.tick),
    plan: (check) => {
      const owners = dueAiOwners(game, runtime);
      if (owners.length > 0) executor.submit(game, { tick: game.tick, deliveryTick: game.tick + delay, requests: claimThink(game, runtime, owners) }, check);
      return executor.take(game.tick);
    },
  };
}

export function planAiRuntimeCommandEntries(game: Game, runtime: AiRuntimeState, owners: PlayerId[] = runtime.controlledPlayers, options: PresetAiPolicyOptions = {}): AiRuntimeIssuedCommand[] {
  if (game.match.winner) return [];
  const requests = owners.map((owner) => runtimeRequestForOwner(runtime, owner));
  return planAiCommandFrame(game, requests, { ...(runtime.policyMode ? { policyMode: runtime.policyMode } : {}), ...options }).commands;
}

export function planAiCommandFrame<Source extends string = string>(game: Game, requests: AiCommandFrameRequest<Source>[], options: PresetAiPolicyOptions & { memoryProvider?: AiMemoryProvider } = {}): AiRuntimeResult<Source> {
  return planAiCommandFrameFromSnapshot(snapshotGame(game), requests, { teams: game.teams, ...options });
}

export function planAiCommandFrameFromSnapshot<Source extends string = string>(snapshot: GameSnapshot, requests: AiCommandFrameRequest<Source>[], options: PresetAiPolicyOptions & { memoryProvider?: AiMemoryProvider } = {}): AiRuntimeResult<Source> {
  if (snapshot.match.winner) return { commands: [] };
  const { memoryProvider, ...policyOptions } = options;
  return { commands: normalizeCommandFrameEntries(planAiCommandFrameRequestsFromSnapshot(snapshot, requests, policyOptions, memoryProvider)) };
}

function planAiCommandFrameRequestsFromSnapshot<Source extends string = string>(snapshot: GameSnapshot, requests: AiCommandFrameRequest<Source>[], policyOptions: PresetAiPolicyOptions = {}, memoryProvider?: AiMemoryProvider) {
  const planned: AiRuntimeIssuedCommand<Source>[] = [];
  // @@@shared-ai-frame - All requests of one think reason over one world frame; replay/SDK equivalence depends on this.
  for (const request of requests) {
    planned.push(...planAiOwnerCommandEntries(snapshot, request, { ...policyOptions, ...(memoryProvider ? { memoryProvider } : {}) }));
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
