import { createInteractivePlaytestSession, serializeInteractivePlaytestSession, type SerializedInteractivePlaytestSession } from "../sdk/playtest";
import type { AiScriptVersion, PlayerId } from "../shared/types";
import { AI_SCRIPT_LIBRARY } from "./policy";
import { createAiInteractivePlaytestRuntime } from "./playtest";
import { createAiPlaytestSetupFromArgs } from "./playtest-session-setup";
import { DEFAULT_AI_THINK_INTERVAL, type AiRuntimeState } from "./runtime";

export type AiPlaytestFile = {
  session: SerializedInteractivePlaytestSession;
  runtime: AiRuntimeState;
};

export function createAiPlaytestFileFromArgs(args: string[]): AiPlaytestFile {
  const controlledPlayer = flag(args, "you") ?? "v2";
  const enemy = flag(args, "enemy") ?? "v1a";
  const setup = createAiPlaytestSetupFromArgs(args, controlledPlayer, enemy);
  const controlledVersion = setup.versions?.[controlledPlayer] ?? ((flag(args, "you-version") ?? "v2") as AiScriptVersion);
  const enemyVersion = setup.versions?.[enemy] ?? ((flag(args, "enemy-version") ?? "v1") as AiScriptVersion);
  const thinkInterval = numberFlag(args, "think-interval", DEFAULT_AI_THINK_INTERVAL);
  const assistControlled = boolFlag(args, "assist-you");
  const scriptedPlayers = setup.scriptedPlayers ?? [enemy];
  const versions = { ...Object.fromEntries(scriptedPlayers.map((owner) => [owner, setup.versions?.[owner] ?? enemyVersion])), [controlledPlayer]: controlledVersion } as Partial<Record<PlayerId, AiScriptVersion>>;
  const scriptIdsByPlayer = scriptIdsByPlayerFromArgs(args, controlledPlayer, scriptedPlayers, assistControlled);
  const session = createInteractivePlaytestSession({
    id: flag(args, "id") ?? setup.id ?? `interactive-${setup.mapId}-${Date.now()}`,
    mapId: setup.mapId,
    controlledPlayer,
    scriptedPlayers,
    ...(setup.winnerMode ? { winnerMode: setup.winnerMode } : {}),
    options: setup.options,
  });
  const runtime = createAiInteractivePlaytestRuntime(session, {
    assistControlled,
    thinkInterval,
    versions,
    ...(Object.keys(scriptIdsByPlayer).length > 0 ? { scriptIdsByPlayer } : {}),
    ...(setup.policyMode ? { policyMode: setup.policyMode } : {}),
    ...(setup.disabledBehaviorsByPlayer ? { disabledBehaviorsByPlayer: setup.disabledBehaviorsByPlayer } : {}),
  });
  return { session: serializeInteractivePlaytestSession(session), runtime };
}

function scriptIdsByPlayerFromArgs(args: string[], controlledPlayer: PlayerId, scriptedPlayers: PlayerId[], assistControlled: boolean): Partial<Record<PlayerId, string[]>> {
  const youScripts = scriptIdsFlag(args, "you-scripts");
  const enemyScripts = scriptIdsFlag(args, "enemy-scripts");
  if (youScripts && !assistControlled) throw new Error("--you-scripts requires --assist-you");
  return {
    ...(youScripts ? { [controlledPlayer]: youScripts } : {}),
    ...(enemyScripts ? Object.fromEntries(scriptedPlayers.map((owner) => [owner, enemyScripts])) : {}),
  };
}

function scriptIdsFlag(args: string[], name: string): string[] | undefined {
  const raw = flag(args, name);
  if (raw === undefined) return undefined;
  const scriptIds = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (scriptIds.length === 0) throw new Error(`--${name} must include at least one script id`);
  for (const scriptId of scriptIds) {
    if (!(scriptId in AI_SCRIPT_LIBRARY)) throw new Error(`Unknown AI script id ${scriptId}`);
  }
  return scriptIds;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function numberFlag(args: string[], name: string, value: number): number {
  const raw = flag(args, name);
  if (raw === undefined) return value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a finite number`);
  return parsed;
}
