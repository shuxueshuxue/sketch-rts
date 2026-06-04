import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import type { GameCommand, PlayerId } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";

export type AiCommandStats = {
  owners: Record<PlayerId, AiOwnerCommandStats>;
};

export type AiOwnerCommandStats = {
  scripts: Record<string, AiScriptCommandStats>;
};

export type AiScriptCommandStats = {
  commands: number;
  byType: Partial<Record<GameCommand["type"], number>>;
  singleUnitCommands: number;
  singleUnitByType: Partial<Record<GameCommand["type"], number>>;
  firstSecond: number;
  lastSecond: number;
  timingByType: Partial<Record<GameCommand["type"], AiCommandTypeTiming>>;
};

export type AiCommandTypeTiming = {
  firstSecond: number;
  lastSecond: number;
};

export function createAiCommandStatsTracker(): BenchmarkTracker<AiGameAgent, AiCommandStats, AiCommandStats> {
  return {
    id: "aiCommandStats",
    create: () => ({ owners: {} }),
    onCommand(state, context) {
      const owner = (state.owners[context.owner] ??= { scripts: {} });
      const second = context.tick / SIM_TICKS_PER_SECOND;
      const script = (owner.scripts[context.scriptId] ??= { commands: 0, byType: {}, singleUnitCommands: 0, singleUnitByType: {}, firstSecond: second, lastSecond: second, timingByType: {} });
      script.commands += 1;
      script.firstSecond = Math.min(script.firstSecond, second);
      script.lastSecond = Math.max(script.lastSecond, second);
      script.byType[context.command.type] = (script.byType[context.command.type] ?? 0) + 1;
      if (commandUnitCount(context.command) === 1) {
        script.singleUnitCommands += 1;
        script.singleUnitByType[context.command.type] = (script.singleUnitByType[context.command.type] ?? 0) + 1;
      }
      const timing = (script.timingByType[context.command.type] ??= { firstSecond: second, lastSecond: second });
      timing.firstSecond = Math.min(timing.firstSecond, second);
      timing.lastSecond = Math.max(timing.lastSecond, second);
    },
    finish: (state) => state,
  };
}

function commandUnitCount(command: GameCommand) {
  if ("unitIds" in command) return command.unitIds.length;
  return 0;
}
