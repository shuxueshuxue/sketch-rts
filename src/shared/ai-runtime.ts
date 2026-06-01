import { AI_SCRIPT_VERSIONS, planAiCommandEntriesFromScripts, SKETCH_RTS_PRESET_AI_STACK, type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./ai-policy";
import { issuePlayerCommand, snapshotGame, type Game } from "./sim";
import type { GameCommand, PlayerId } from "./types";

export type AiRuntimeState = {
  controlledPlayers: PlayerId[];
  lastThink: Partial<Record<PlayerId, number>>;
  thinkInterval: number;
  scripts?: AiScript[];
  version: AiScriptVersion;
  versions: Partial<Record<PlayerId, AiScriptVersion>>;
};

export type AiRuntimeResult = {
  commands: { playerId: PlayerId; scriptId: string; command: GameCommand }[];
};

export function createAiRuntime(players: PlayerId[], options: { thinkInterval?: number; scripts?: AiScript[]; version?: AiScriptVersion; versions?: Partial<Record<PlayerId, AiScriptVersion>> } = {}): AiRuntimeState {
  const thinkInterval = options.thinkInterval ?? 45;
  return {
    controlledPlayers: [...new Set(players)],
    lastThink: Object.fromEntries(players.map((owner) => [owner, -thinkInterval])),
    thinkInterval,
    ...(options.scripts ? { scripts: options.scripts } : {}),
    version: options.version ?? "v1",
    versions: options.versions ?? {},
  };
}

export function runPresetAiRuntime(game: Game, runtime: AiRuntimeState, options: PresetAiPolicyOptions = {}): AiRuntimeResult {
  const issued: AiRuntimeResult["commands"] = [];
  if (game.match.winner) return { commands: issued };

  const dueOwners = runtime.controlledPlayers.filter((owner) => {
    if (!game.players[owner]) return false;
    return game.tick - (runtime.lastThink[owner] ?? -runtime.thinkInterval) >= runtime.thinkInterval;
  });
  if (dueOwners.length === 0) return { commands: issued };

  const snapshot = snapshotGame(game);
  const planned: AiRuntimeResult["commands"] = [];
  // @@@shared-ai-frame - All controlled slots reason over one world frame; replay/SDK equivalence depends on this.
  for (const owner of dueOwners) {
    runtime.lastThink[owner] = game.tick;
    const version = runtime.versions[owner] ?? runtime.version;
    const scripts = runtime.scripts ?? AI_SCRIPT_VERSIONS[version] ?? SKETCH_RTS_PRESET_AI_STACK;
    for (const entry of planAiCommandEntriesFromScripts(snapshot, owner, scripts, { teams: game.teams, version, ...options })) {
      planned.push({ playerId: owner, scriptId: entry.scriptId, command: entry.command });
    }
  }

  const hiredCampIds = new Set<string>();
  const pickedItemIds = new Set<string>();
  for (const entry of planned) {
    if (entry.command.type === "hire") {
      if (hiredCampIds.has(entry.command.campId)) continue;
      hiredCampIds.add(entry.command.campId);
    }
    if (entry.command.type === "pickupItem") {
      if (pickedItemIds.has(entry.command.itemId)) continue;
      pickedItemIds.add(entry.command.itemId);
    }
    issuePlayerCommand(game, entry.playerId, entry.command);
    issued.push(entry);
  }

  return { commands: issued };
}
