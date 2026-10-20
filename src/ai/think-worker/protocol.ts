import type { AiScriptVersion, PresetAiPolicyOptions } from "../policy";
import type { CommandEnvelope } from "../../shared/net/types";
import type { GameCommand, GameMap, GameSnapshot, PlayerId } from "../../shared/types";

// @@@think-thread - Messages between a match and the thread its AI thinks on (a Web Worker in a browser, a worker
// thread on the server). The thread keeps what a think needs between thinks: the map's terrain, whose navigation caches
// are keyed by its object, and each player's policy memory. A think then carries only the world copy and the requests.

// A request as it crosses: its memory lives on the thinking thread, and scripts given as functions cannot cross.
export type AiThinkWireRequest = {
  playerId: PlayerId;
  version?: AiScriptVersion;
  scriptIds?: string[];
  disabledBehaviors?: PresetAiPolicyOptions["disabledBehaviors"];
  overridingCommands?: GameCommand[];
};

// The world copy without the map's fixed ground (terrain, scenery), which the thread was given when the match opened.
export type AiThinkWireSnapshot = Omit<GameSnapshot, "map"> & { map: Omit<GameMap, "terrain" | "landmarks"> };

export type AiThinkMessage =
  | { type: "open"; session: string; map: GameMap; policyMode?: PresetAiPolicyOptions["policyMode"] }
  | { type: "think"; session: string; tick: number; deliveryTick: number; snapshot: AiThinkWireSnapshot; requests: AiThinkWireRequest[] }
  | { type: "close"; session: string };

export type AiThinkReply =
  | { session: string; deliveryTick: number; commands: CommandEnvelope[]; thinkMs: number }
  | { session: string; deliveryTick: number; error: string };
