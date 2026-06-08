import { resolveSdkCommandIntent, type SdkCommandIntent } from "../../sdk/commands/intent";
import type { GameCommand, GameSnapshot, PlayerId } from "../../shared/types";
import type { PresetAiPolicyOptions } from "./types";

export type AiCommandIntent = SdkCommandIntent;

export function resolveAiCommandIntent(snapshot: GameSnapshot, owner: PlayerId, intent: AiCommandIntent, options: PresetAiPolicyOptions): GameCommand {
  return resolveSdkCommandIntent(snapshot, owner, intent, options.teams ? { teams: options.teams } : {});
}
