import { AI_SCRIPT_LIBRARY, AI_SCRIPT_VERSIONS, SKETCH_RTS_PRESET_AI_STACK, createAiPolicyMemory, planAiCommandEntriesFromScripts, type AiPolicyMemory, type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./policy";
import { issueCommandFrame, type CommandFrameEntry, type CommandFrameHooks } from "../sdk/commands/frame";
import { snapshotGame, type Game } from "../shared/sim";
import type { PlayerId } from "../shared/types";

export const DEFAULT_AI_THINK_INTERVAL = 15;

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
  memories: Record<PlayerId, AiPolicyMemory>;
};

export type AiRuntimeResult = {
  commands: AiRuntimeIssuedCommand[];
};

export type AiCommandFrameRequest<Source extends string = string> = {
  playerId: PlayerId;
  source?: Source;
  version?: AiScriptVersion;
  scripts?: AiScript[];
  memory?: AiPolicyMemory;
};

export type AiMemoryProvider = {
  get(owner: PlayerId): AiPolicyMemory | undefined;
  set?(owner: PlayerId, memory: AiPolicyMemory): void;
};

export type AiRuntimeIssuedCommand<Source extends string = string> = CommandFrameEntry<Source>;

export type AiCommandFrameHooks<Source extends string = string> = CommandFrameHooks<Source>;

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
    version: options.version ?? "v1",
    versions: options.versions ?? {},
    ...(options.policyMode ? { policyMode: options.policyMode } : {}),
    memories: Object.fromEntries(controlledPlayers.map((owner) => [owner, createAiPolicyMemory()])) as Record<PlayerId, AiPolicyMemory>,
  };
}

export function runPresetAiRuntime(game: Game, runtime: AiRuntimeState, options: PresetAiPolicyOptions = {}): AiRuntimeResult {
  if (game.match.winner) return { commands: [] };

  const dueOwners = runtime.controlledPlayers.filter((owner) => {
    if (!game.players[owner]) return false;
    return game.tick - (runtime.lastThink[owner] ?? -runtime.thinkInterval) >= runtime.thinkInterval;
  });
  if (dueOwners.length === 0) return { commands: [] };

  const requests = dueOwners.map((owner) => {
    runtime.lastThink[owner] = game.tick;
    const version = runtime.versions[owner] ?? runtime.version;
    return {
      playerId: owner,
      version,
      scripts: runtimeScriptsForOwner(runtime, owner, version),
      memory: runtime.memories[owner] ?? (runtime.memories[owner] = createAiPolicyMemory()),
    };
  });
  return issueAiCommandFrame(game, requests, { ...(runtime.policyMode ? { policyMode: runtime.policyMode } : {}), ...options });
}

export function issueAiCommandFrame<Source extends string = string>(game: Game, requests: AiCommandFrameRequest<Source>[], options: PresetAiPolicyOptions & { memoryProvider?: AiMemoryProvider } = {}, hooks: AiCommandFrameHooks<Source> = {}) {
  if (game.match.winner) return { commands: [] };
  const snapshot = snapshotGame(game);
  const planned: AiRuntimeIssuedCommand<Source>[] = [];
  const { memoryProvider, ...policyOptions } = options;
  // @@@shared-ai-frame - All controlled slots reason over one world frame; replay/SDK equivalence depends on this.
  for (const request of requests) {
    const owner = request.playerId;
    if (!game.players[owner]) continue;
    const version = request.version ?? "v1";
    const scripts = request.scripts ?? AI_SCRIPT_VERSIONS[version] ?? SKETCH_RTS_PRESET_AI_STACK;
    const memory = request.memory ?? memoryProvider?.get(owner) ?? policyOptions.memory ?? createAiPolicyMemory();
    memoryProvider?.set?.(owner, memory);
    for (const entry of planAiCommandEntriesFromScripts(snapshot, owner, scripts, { teams: game.teams, version, ...policyOptions, memory })) {
      planned.push({
        playerId: owner,
        ...(request.source !== undefined ? { source: request.source } : {}),
        scriptId: entry.scriptId,
        command: entry.command,
      });
    }
  }

  return issueCommandFrame(game, planned, hooks);
}

function runtimeScriptsForOwner(runtime: AiRuntimeState, owner: PlayerId, version: AiScriptVersion) {
  const scriptIds = runtime.scriptIdsByPlayer?.[owner] ?? runtime.scriptIds;
  if (scriptIds) return scriptsFromIds(scriptIds);
  return runtime.scripts ?? AI_SCRIPT_VERSIONS[version] ?? SKETCH_RTS_PRESET_AI_STACK;
}

function scriptsFromIds(scriptIds: string[]): AiScript[] {
  return scriptIds.map((id) => {
    const script = AI_SCRIPT_LIBRARY[id as keyof typeof AI_SCRIPT_LIBRARY];
    if (!script) throw new Error(`Unknown AI script id ${id}`);
    return script;
  });
}

function cloneScriptIdsByPlayer(value: Partial<Record<PlayerId, string[]>>) {
  return Object.fromEntries(Object.entries(value).map(([owner, scriptIds]) => [owner, scriptIds ? [...scriptIds] : scriptIds])) as Partial<Record<PlayerId, string[]>>;
}
