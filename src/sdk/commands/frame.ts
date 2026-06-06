import type { Game } from "../../shared/sim";
import { checksumGame } from "../../shared/sim/checksum";
import { CommandFrameRuntime, normalizeCommandFrameEntries } from "../../shared/sim/command-frame-runtime";
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
  return new SdkCommandFrameRuntime(game).issue(planned, hooks);
}

export function createSdkCommandFrameRuntime(game: Game, options: { roomId?: string } = {}) {
  return new SdkCommandFrameRuntime(game, options);
}

export class SdkCommandFrameRuntime {
  private readonly runtime: CommandFrameRuntime;

  constructor(
    private readonly game: Game,
    options: { roomId?: string } = {},
  ) {
    this.runtime = new CommandFrameRuntime({ game, roomId: options.roomId ?? "sdk", rejectionLabel: "SDK command frame rejected" });
  }

  issue<Source extends string = string>(planned: CommandFrameEntry<Source>[], hooks: CommandFrameHooks<Source> = {}): CommandFrameResult<Source> {
    if (this.game.match.winner) return { commands: [] };
    const issued = normalizeCommandFrameEntries(planned);

    if (issued.length === 0) return { commands: issued };
    let entryIndex = 0;
    const appliedFrame = this.runtime.completeAndApply(
      issued.map((entry) => ({ playerId: entry.playerId, command: entry.command })),
      {
        rejectionLabel(entry, index) {
          const issuedEntry = issued[index];
          return `SDK command frame rejected ${issuedEntry?.playerId ?? entry.playerId} ${issuedEntry?.scriptId ?? "unknown"} command`;
        },
        applyHooks: {
          beforeApply() {
            hooks.beforeIssue?.(issued[entryIndex]!);
          },
          afterApply() {
            hooks.afterIssue?.(issued[entryIndex]!);
            entryIndex += 1;
          },
        },
      },
    );

    return { commands: issued, ...(appliedFrame ? { frame: appliedFrame } : {}), checksum: checksumGame(this.game) };
  }

  tick(): void {
    this.runtime.tick([]);
  }
}
