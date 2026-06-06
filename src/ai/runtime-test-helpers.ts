import { issueCommandFrame, type CommandFrameHooks } from "../sdk/commands/frame";
import type { Game } from "../shared/sim";
import type { PresetAiPolicyOptions } from "./policy";
import { planAiCommandFrame, planPresetAiRuntimeCommands, type AiCommandFrameRequest, type AiRuntimeState } from "./runtime";
import type { AiMemoryProvider } from "./planner-context";

export function runPresetAiRuntimeForTest(game: Game, runtime: AiRuntimeState, options: PresetAiPolicyOptions = {}) {
  const planned = planPresetAiRuntimeCommands(game, runtime, options);
  return issueCommandFrame(game, planned.commands);
}

export function issueAiCommandFrameForTest<Source extends string = string>(game: Game, requests: AiCommandFrameRequest<Source>[], options: PresetAiPolicyOptions & { memoryProvider?: AiMemoryProvider } = {}, hooks: CommandFrameHooks<Source> = {}) {
  if (game.match.winner) return { commands: [] };
  const planned = planAiCommandFrame(game, requests, options);
  return issueCommandFrame(game, planned.commands, hooks);
}
