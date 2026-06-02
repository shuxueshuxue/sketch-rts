import { AI_SCRIPT_VERSIONS, SKETCH_RTS_PRESET_AI_STACK, createAiPolicyMemory, planAiCommandEntriesFromScripts, type AiPolicyMemory, type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./policy";
import { issueCommandFrame, type CommandFrameEntry, type CommandFrameHooks } from "../sdk/commands/frame";
import { snapshotGame, type Game } from "../shared/sim";
import type { PlayerId } from "../shared/types";

export type AiRuntimeState = {
  controlledPlayers: PlayerId[];
  lastThink: Partial<Record<PlayerId, number>>;
  thinkInterval: number;
  scripts?: AiScript[];
  version: AiScriptVersion;
  versions: Partial<Record<PlayerId, AiScriptVersion>>;
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

export function createAiRuntime(players: PlayerId[], options: { thinkInterval?: number; scripts?: AiScript[]; version?: AiScriptVersion; versions?: Partial<Record<PlayerId, AiScriptVersion>> } = {}): AiRuntimeState {
  const thinkInterval = options.thinkInterval ?? 45;
  const controlledPlayers = [...new Set(players)];
  return {
    controlledPlayers,
    lastThink: Object.fromEntries(players.map((owner) => [owner, -thinkInterval])),
    thinkInterval,
    ...(options.scripts ? { scripts: options.scripts } : {}),
    version: options.version ?? "v1",
    versions: options.versions ?? {},
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
      scripts: runtime.scripts ?? AI_SCRIPT_VERSIONS[version] ?? SKETCH_RTS_PRESET_AI_STACK,
      memory: runtime.memories[owner] ?? (runtime.memories[owner] = createAiPolicyMemory()),
    };
  });
  return issueAiCommandFrame(game, requests, options);
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
