import { snapshotGame, type Game } from "../../shared/sim";
import { checksumGame } from "../../shared/sim/checksum";
import { commandValidationError } from "../../shared/sim/command-validation";
import { applyCommandFrame } from "../../shared/sim/frame";
import type { CommandFrame } from "../../shared/net/types";
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
  frame?: CommandFrame;
  checksum?: string;
};

export function issueCommandFrame<Source extends string = string>(game: Game, planned: CommandFrameEntry<Source>[], hooks: CommandFrameHooks<Source> = {}): CommandFrameResult<Source> {
  if (game.match.winner) return { commands: [] };
  const issued = selectIssueableCommandEntries(planned);

  if (issued.length === 0) return { commands: issued };
  const snapshot = snapshotGame(game);
  for (const entry of issued) {
    const error = commandValidationError(snapshot, entry.playerId, entry.command);
    if (error) throw new Error(`SDK command frame rejected ${entry.playerId} ${entry.scriptId} command: ${error}`);
  }
  const frame: CommandFrame = {
    roomId: "sdk",
    tick: game.tick,
    sequence: 0,
    commands: issued.map((entry) => ({ playerId: entry.playerId, command: entry.command })),
  };
  let entryIndex = 0;
  applyCommandFrame(game, frame, {
    beforeApply() {
      hooks.beforeIssue?.(issued[entryIndex]!);
    },
    afterApply() {
      hooks.afterIssue?.(issued[entryIndex]!);
      entryIndex += 1;
    },
  });

  return { commands: issued, frame, checksum: checksumGame(game) };
}

export function selectIssueableCommandEntries<Source extends string = string>(planned: CommandFrameEntry<Source>[]): CommandFrameEntry<Source>[] {
  const issued: CommandFrameEntry<Source>[] = [];
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
    issued.push(entry);
  }
  return issued;
}
