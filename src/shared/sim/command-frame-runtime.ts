import type { CommandEnvelope, CommandFrame } from "../net/types";
import { stepGame, type Game } from "../sim";
import { checkCommandLegality, type CommandLegalityError, narrowFrameCommandToLiveOperands } from "./command-validation";
import { applyCommandFrame, type CommandFrameApplyHooks } from "./frame";
import { partitionDeliveredPlannerCommands } from "./planner-schedule";
import type { GameCommand, GameSnapshot } from "../types";

export type CommandFrameRuntimeAiPlanner<State = unknown> = {
  checkpoint: () => State;
  restore: (state: State) => void;
  // Plans the owners due on this tick, checking each fresh plan with `check`, and returns the commands that land on it:
  // those due by now whose think has arrived, or, with `settle`, all those due by now (see @@@planner-schedule).
  plan: (check: (commands: CommandEnvelope[]) => void, settle: boolean) => CommandEnvelope[];
};

export type CommandFrameRuntimeOptions<State = unknown> = {
  game: Game;
  roomId: string;
  rejectionLabel: string;
  aiPlanner?: CommandFrameRuntimeAiPlanner<State>;
};

export type RuntimeFrameOptions = {
  includeAi?: boolean;
  // Wait for every AI think due by this tick (a match stepped synchronously; see @@@planner-schedule).
  settleAi?: boolean;
  frame?: CommandFrame;
  // A frame even for a tick with no commands: a hosted room's every tick is one its lockstep clients and history follow.
  everyTick?: boolean;
  onFrame?: (frame: CommandFrame) => void;
  applyHooks?: CommandFrameApplyHooks;
  rejectionLabel?: (entry: CommandEnvelope, index: number) => string;
};

export type RuntimeAdmissionOptions = {
  rejectionLabel?: RuntimeFrameOptions["rejectionLabel"];
};

export type ValidationPurpose = "admission" | "apply";

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
    const aiCommands = options.includeAi === false ? [] : this.planAiCommands(options.settleAi ?? false);
    const completedCommands = normalizeCommandFrameEntries([...normalizedCommands, ...aiCommands]);
    if (options.frame) return { ...options.frame, commands: completedCommands };
    if (completedCommands.length === 0 && !options.everyTick) return undefined;
    const frame = {
      roomId: this.options.roomId,
      tick: this.options.game.tick,
      sequence: this.nextSequence,
      commands: completedCommands,
    };
    this.nextSequence += 1;
    return frame;
  }

  private planAiCommands(settle: boolean): CommandEnvelope[] {
    if (!this.options.aiPlanner) return [];
    const checkpoint = this.options.aiPlanner.checkpoint();
    try {
      const delivered = this.options.aiPlanner.plan((commands) => this.validate(commands, { purpose: "apply" }), settle);
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
    // Validation changes nothing, so every command reads the game itself (see @@@legality-reads-live-game in sim.ts).
    for (const [index, entry] of commands.entries()) {
      const rejection = commandRejectionDetail(this.options.game, entry, options.purpose);
      if (rejection) throw new CommandAdmissionError(`${options.rejectionLabel?.(entry, index) ?? this.options.rejectionLabel}: ${rejection.message}`, rejection);
    }
  }
}

/**
 * Why the world would refuse this command now, if it would: on admission any refusal counts, on apply only one that
 * cannot pass later. The world may be a snapshot of the game, which carries every list these checks read (a page checks
 * a command against its latest snapshot before the match on its own thread checks it again).
 */
export function commandRejection(world: Game | GameSnapshot, entry: CommandEnvelope, purpose: ValidationPurpose): string | undefined {
  return commandRejectionDetail(world, entry, purpose)?.message;
}

export class CommandAdmissionError extends Error {
  readonly commandRefusal;
  constructor(message: string, legality: CommandLegalityError) {
    super(message);
    this.commandRefusal = legality.refusal;
  }
}

export function commandRejectionDetail(world: Game | GameSnapshot, entry: CommandEnvelope, purpose: ValidationPurpose): CommandLegalityError | undefined {
  const game = world as Game;
  const currentCommand = narrowFrameCommandToLiveOperands(game, entry.playerId, entry.command);
  if (!currentCommand) return undefined;
  const legality = checkCommandLegality(game, entry.playerId, currentCommand);
  return legality && (purpose === "admission" || !legality.transient) ? legality : undefined;
}
