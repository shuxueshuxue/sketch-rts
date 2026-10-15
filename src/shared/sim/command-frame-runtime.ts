import type { CommandEnvelope, CommandFrame } from "../net/types";
import { stepGame, type Game } from "../sim";
import { checkCommandLegality, narrowFrameCommandToLiveOperands } from "./command-validation";
import { applyCommandFrame, type CommandFrameApplyHooks } from "./frame";
import { partitionDeliveredPlannerCommands } from "./planner-schedule";
import type { GameCommand } from "../types";

export type CommandFrameRuntimeAiPlanner<State = unknown> = {
  checkpoint: () => State;
  restore: (state: State) => void;
  // Whether the commands due on the current tick are planned: a think may still run beside the simulation (see
  // @@@planner-schedule). A runtime is ticked only when it is ready.
  ready?: () => boolean;
  // Plans the owners due on this tick, checking each fresh plan with `check`, and returns the commands due on it.
  plan: (check: (commands: CommandEnvelope[]) => void) => CommandEnvelope[];
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

export function normalizeCommandFrameEntries<Entry extends { command: GameCommand }>(entries: Entry[]): Entry[] {
  const normalized: Entry[] = [];
  let hiredCampIds: Set<string> | undefined;
  let pickedItemIds: Set<string> | undefined;
  for (const entry of entries) {
    if (entry.command.type === "hire") {
      hiredCampIds ??= new Set<string>();
      if (hiredCampIds.has(entry.command.campId)) continue;
      hiredCampIds.add(entry.command.campId);
    }
    if (entry.command.type === "pickupItem") {
      pickedItemIds ??= new Set<string>();
      if (pickedItemIds.has(entry.command.itemId)) continue;
      pickedItemIds.add(entry.command.itemId);
    }
    normalized.push(entry);
  }
  return normalized;
}

// @@@frame-cadence - Product paths may choose transport delay, but a simulation tick means: apply all frames for this tick, then step once.
export function advanceCommandFrameTick(game: Game, frames?: CommandFrame | CommandFrame[], options: Pick<RuntimeFrameOptions, "applyHooks"> = {}): void {
  const frameList = Array.isArray(frames) ? frames : frames ? [frames] : [];
  for (const frame of frameList) applyCommandFrame(game, frame, options.applyHooks);
  stepGame(game);
}

export class CommandFrameRuntime<State = unknown> {
  private nextSequence = 0;
  // Planned AI commands the world outgrew during their delay (see partitionDeliveredPlannerCommands).
  staleAiCommands = 0;

  constructor(private readonly options: CommandFrameRuntimeOptions<State>) {}

  ready(): boolean {
    return this.options.aiPlanner?.ready?.() ?? true;
  }

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
    this.validate(normalizeCommandFrameEntries(commands), { purpose: "admission", rejectionLabel: options.rejectionLabel });
  }

  // A planner's fresh commands, checked as a frame would apply them now (transient rejections pass).
  check(commands: CommandEnvelope[], options: RuntimeAdmissionOptions = {}): void {
    this.validate(normalizeCommandFrameEntries(commands), { purpose: "apply", rejectionLabel: options.rejectionLabel });
  }

  private completeFrame(commands: CommandEnvelope[], options: RuntimeFrameOptions): CommandFrame | undefined {
    const normalizedCommands = normalizeCommandFrameEntries(commands);
    this.validate(normalizedCommands, { purpose: "apply", rejectionLabel: options.rejectionLabel });
    const aiCommands = options.includeAi === false ? [] : this.planAiCommands();
    const completedCommands = normalizeCommandFrameEntries([...normalizedCommands, ...aiCommands]);
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
      const delivered = this.options.aiPlanner.plan((commands) => this.validate(commands, { purpose: "apply" }));
      const { deliverable, stale } = partitionDeliveredPlannerCommands(this.options.game, delivered);
      this.staleAiCommands += stale.length;
      return deliverable;
    } catch (error) {
      this.options.aiPlanner.restore(checkpoint);
      throw error;
    }
  }

  private validate(commands: CommandEnvelope[], options: { purpose: ValidationPurpose; rejectionLabel?: RuntimeFrameOptions["rejectionLabel"] }): void {
    if (commands.length === 0) return;
    // Validation changes nothing, so every command reads the game itself (see @@@legality-reads-live-game in frame.ts).
    const game = this.options.game;
    for (const [index, entry] of commands.entries()) {
      const currentCommand = narrowFrameCommandToLiveOperands(game, entry.playerId, entry.command);
      if (!currentCommand) continue;
      const legality = checkCommandLegality(game, entry.playerId, currentCommand);
      if (legality && (options.purpose === "admission" || !legality.transient)) throw new Error(`${options.rejectionLabel?.(entry, index) ?? this.options.rejectionLabel}: ${legality.message}`);
    }
  }
}
