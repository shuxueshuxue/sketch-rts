import { issuePlayerCommand, type Game } from "../../shared/sim";
import type { GameCommand, PlayerId } from "../../shared/types";

export type CommandFrameEntry<Source extends string = string> = {
  playerId: PlayerId;
  source?: Source;
  scriptId: string;
  command: GameCommand;
};

export type CommandFrameHooks<Source extends string = string> = {
  beforeIssue?: (entry: CommandFrameEntry<Source>) => void;
  afterIssue?: (entry: CommandFrameEntry<Source>) => void;
};

export type CommandFrameResult<Source extends string = string> = {
  commands: CommandFrameEntry<Source>[];
};

export function issueCommandFrame<Source extends string = string>(game: Game, planned: CommandFrameEntry<Source>[], hooks: CommandFrameHooks<Source> = {}): CommandFrameResult<Source> {
  const issued: CommandFrameEntry<Source>[] = [];
  if (game.match.winner) return { commands: issued };

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
    hooks.beforeIssue?.(entry);
    issuePlayerCommand(game, entry.playerId, entry.command);
    hooks.afterIssue?.(entry);
    issued.push(entry);
  }

  return { commands: issued };
}
