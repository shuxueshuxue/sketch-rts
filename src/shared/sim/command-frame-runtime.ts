import type { CommandEnvelope, CommandFrame } from "../net/types";
import { snapshotGame, stepGame, type Game } from "../sim";
import { checkCommandLegality, narrowFrameCommandToLiveOperands } from "./command-validation";
import { applyCommandFrame, type CommandFrameApplyHooks } from "./frame";

export type CommandFrameRuntimeAiPlanner<State = unknown> = {
  checkpoint: () => State;
  restore: (state: State) => void;
  plan: () => CommandEnvelope[];
};

export type CommandFrameRuntimeOptions<State = unknown> = {
  game: Game;
  roomId: string;
  rejectionLabel: string;
  aiPlanner?: CommandFrameRuntimeAiPlanner<State>;
};

export type RuntimeFrameOptions = {
  includeAi?: boolean;
  frame?: CommandFrame;
  onFrame?: (frame: CommandFrame) => void;
  applyHooks?: CommandFrameApplyHooks;
  rejectionLabel?: (entry: CommandEnvelope, index: number) => string;
};

export type RuntimeAdmissionOptions = {
  rejectionLabel?: RuntimeFrameOptions["rejectionLabel"];
};

type ValidationPurpose = "admission" | "apply";

// @@@frame-cadence - Product paths may choose transport delay, but a simulation tick means: apply all frames for this tick, then step once.
export function advanceCommandFrameTick(game: Game, frames?: CommandFrame | CommandFrame[], options: Pick<RuntimeFrameOptions, "applyHooks"> = {}): void {
  const frameList = Array.isArray(frames) ? frames : frames ? [frames] : [];
  for (const frame of frameList) applyCommandFrame(game, frame, options.applyHooks);
  stepGame(game);
}

export class CommandFrameRuntime<State = unknown> {
  private nextSequence = 0;

  constructor(private readonly options: CommandFrameRuntimeOptions<State>) {}

  completeAndApply(commands: CommandEnvelope[], options: RuntimeFrameOptions = {}): CommandFrame | undefined {
    const frame = this.completeFrame(commands, options);
    if (!frame) return undefined;
    options.onFrame?.(frame);
    applyCommandFrame(this.options.game, frame, options.applyHooks);
    return frame;
  }

  tick(commands: CommandEnvelope[] = [], options: RuntimeFrameOptions = {}): CommandFrame | undefined {
    const frame = this.completeFrame(commands, options);
    if (frame) options.onFrame?.(frame);
    advanceCommandFrameTick(this.options.game, frame, options.applyHooks ? { applyHooks: options.applyHooks } : {});
    return frame;
  }

  admit(commands: CommandEnvelope[], options: RuntimeAdmissionOptions = {}): void {
    this.validate(commands, { purpose: "admission", rejectionLabel: options.rejectionLabel });
  }

  private completeFrame(commands: CommandEnvelope[], options: RuntimeFrameOptions): CommandFrame | undefined {
    this.validate(commands, { purpose: "apply", rejectionLabel: options.rejectionLabel });
    const aiCommands = options.includeAi === false ? [] : this.planAiCommands();
    const completedCommands = [...commands, ...aiCommands];
    if (options.frame) return { ...options.frame, commands: completedCommands };
    if (completedCommands.length === 0) return undefined;
    const frame = {
      roomId: this.options.roomId,
      tick: this.options.game.tick,
      sequence: this.nextSequence,
      commands: completedCommands,
    };
    this.nextSequence += 1;
    return frame;
  }

  private planAiCommands(): CommandEnvelope[] {
    if (!this.options.aiPlanner) return [];
    const checkpoint = this.options.aiPlanner.checkpoint();
    try {
      const commands = this.options.aiPlanner.plan();
      this.validate(commands, { purpose: "apply" });
      return commands;
    } catch (error) {
      this.options.aiPlanner.restore(checkpoint);
      throw error;
    }
  }

  private validate(commands: CommandEnvelope[], options: { purpose: ValidationPurpose; rejectionLabel?: RuntimeFrameOptions["rejectionLabel"] }): void {
    if (commands.length === 0) return;
    const snapshot = snapshotGame(this.options.game);
    for (const [index, entry] of commands.entries()) {
      const currentCommand = narrowFrameCommandToLiveOperands(this.options.game, entry.playerId, entry.command);
      if (!currentCommand) continue;
      const legality = checkCommandLegality(snapshot, entry.playerId, currentCommand);
      if (legality && (options.purpose === "admission" || !legality.transient)) throw new Error(`${options.rejectionLabel?.(entry, index) ?? this.options.rejectionLabel}: ${legality.message}`);
    }
  }
}
