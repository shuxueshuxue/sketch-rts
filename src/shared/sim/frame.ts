import { emitCommandRefusal } from "./command-feedback";
import { snapshotGame, stepGame, tryPlayerCommand, type Game } from "../sim";
import type { CommandEnvelope, CommandFrame } from "../net/types";
import { checksumGame } from "./checksum";
import { checkCommandLegality, narrowFrameCommandToLiveOperands } from "./command-validation";
import type { GameCommand, GameSnapshot, PlayerId } from "../types";

export type FrameResult = {
  tick: number;
  checksum: string;
  snapshot?: GameSnapshot;
};

export type CommandFrameApplyHooks = {
  beforeApply?: (entry: CommandEnvelope) => void;
  afterApply?: (entry: CommandEnvelope) => void;
};

export function applyCommandFrame(game: Game, frame: CommandFrame, hooks: CommandFrameApplyHooks = {}): void {
  if (frame.tick !== game.tick) throw new Error(`Command frame ${frame.sequence} targets tick ${frame.tick} but game is at tick ${game.tick}`);
  for (const entry of frame.commands) {
    hooks.beforeApply?.(entry);
    issueFrameCommand(game, entry.playerId, entry.command);
    hooks.afterApply?.(entry);
  }
}

export function stepCommandFrame(game: Game, frame: CommandFrame, options: { includeSnapshot?: boolean } = {}): FrameResult {
  applyCommandFrame(game, frame);
  stepGame(game);
  return {
    tick: game.tick,
    checksum: checksumGame(game),
    ...(options.includeSnapshot ? { snapshot: snapshotGame(game) } : {}),
  };
}

function issueFrameCommand(game: Game, owner: PlayerId, command: GameCommand): void {
  // @@@frame-issuer-subset - Network frames carry accepted intent: units/buildings that died before this tick are no
  // longer issuers, not sim-corrupt ids, and a refusal a later tick could lift (transient) is skipped. Any other refusal
  // means the sender broke the rules.
  const currentCommand = narrowFrameCommandToLiveOperands(game, owner, command);
  if (currentCommand && "unitIds" in command && "unitIds" in currentCommand) {
    const currentIds = new Set(currentCommand.unitIds);
    for (const id of command.unitIds) if (!currentIds.has(id)) emitCommandRefusal(game, owner, command, { reason: "issuer-gone", detail: { entityId: id } });
  }
  if (!currentCommand) {
    const refusal = checkCommandLegality(game, owner, command)?.refusal;
    emitCommandRefusal(game, owner, command, refusal ?? { reason: "condition-unmet", detail: { category: "state" } });
    return;
  }
  const result = tryPlayerCommand(game, owner, currentCommand);
  if (!result.ok && !result.transient) throw new Error(result.message);
}
