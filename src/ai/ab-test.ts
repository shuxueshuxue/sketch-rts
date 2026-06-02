import { createAiTelemetry, planAiCommandsFromScripts, planPresetAiCommands, type AiBehaviorId, type AiScript, type AiScriptVersion, type AiTelemetry } from "./policy";
import type { BuiltScene } from "../sdk/scene";
import { restoreGameFromSave, type SaveGameRecord } from "../shared/savegame";
import { issuePlayerCommand, snapshotGame, stepGame, type Game } from "../shared/sim";
import type { GameCommand, GameSnapshot, PlayerId } from "../shared/types";

type BehaviorAbSource = { scene: BuiltScene; save?: never } | { save: SaveGameRecord; scene?: never };

export type BehaviorAbTestInput = BehaviorAbSource & {
  name: string;
  owner: PlayerId;
  behavior: AiBehaviorId;
  maxTicks: number;
  thinkInterval: number;
  version?: AiScriptVersion;
  scripts?: AiScript[];
  prepare?: (game: Game) => void;
  score: (snapshot: GameSnapshot, telemetry: AiTelemetry) => number;
};

export type BehaviorAbCaseReport = {
  label: "enabled" | "disabled";
  snapshot: GameSnapshot;
  telemetry: AiTelemetry;
  commandCounts: Partial<Record<GameCommand["type"], number>>;
  ticks: number;
  score: number;
  winner: PlayerId | null;
};

export type BehaviorAbTestReport = {
  name: string;
  behavior: AiBehaviorId;
  enabled: BehaviorAbCaseReport;
  disabled: BehaviorAbCaseReport;
  scoreDelta: number;
  improved: boolean;
};

export function runBehaviorAbTest(input: BehaviorAbTestInput): BehaviorAbTestReport {
  const enabled = runCase(input, "enabled", []);
  const disabled = runCase(input, "disabled", [input.behavior]);
  const scoreDelta = enabled.score - disabled.score;
  return {
    name: input.name,
    behavior: input.behavior,
    enabled,
    disabled,
    scoreDelta,
    improved: scoreDelta > 0,
  };
}

function runCase(input: BehaviorAbTestInput, label: BehaviorAbCaseReport["label"], disabledBehaviors: AiBehaviorId[]): BehaviorAbCaseReport {
  const game = createCaseGame(input);
  input.prepare?.(game);
  const telemetry = createAiTelemetry();
  const commandCounts: BehaviorAbCaseReport["commandCounts"] = {};

  while (game.tick < input.maxTicks && !game.match.winner) {
    if (game.tick % input.thinkInterval === 0) {
      const snapshot = snapshotGame(game);
      const options = {
        version: input.version ?? "v2",
        teams: game.teams,
        telemetry,
        disabledBehaviors,
      };
      const commands = input.scripts ? planAiCommandsFromScripts(snapshot, input.owner, input.scripts, options) : planPresetAiCommands(snapshot, input.owner, options);
      for (const command of commands) {
        issuePlayerCommand(game, input.owner, command);
        commandCounts[command.type] = (commandCounts[command.type] ?? 0) + 1;
      }
    }
    stepGame(game);
  }

  const snapshot = snapshotGame(game);
  return {
    label,
    snapshot,
    telemetry,
    commandCounts,
    ticks: game.tick,
    score: input.score(snapshot, telemetry),
    winner: snapshot.match.winner,
  };
}

function createCaseGame(input: BehaviorAbTestInput): Game {
  if (input.save) return restoreGameFromSave(input.save);
  return input.scene.createGame();
}
