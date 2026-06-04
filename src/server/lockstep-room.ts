import type { ChecksumFrame, CommandEnvelope, CommandFrame } from "../shared/net/types";
import type { GameCommand, PlayerId } from "../shared/types";

export type LockstepRoomCoordinatorOptions = {
  roomId: string;
  commandDelayTicks?: number;
};

export type ClientCommandMessage = {
  currentTick: number;
  playerId: PlayerId;
  command: GameCommand;
  clientSeq?: number;
};

export type ServerCommandAck = {
  roomId: string;
  accepted: true;
  sequence: number;
  targetTick: number;
};

export type ClientChecksumFrame = ChecksumFrame & {
  playerId: PlayerId;
};

type PendingCommand = CommandEnvelope & {
  sequence: number;
};

export class LockstepRoomCoordinator {
  readonly roomId: string;
  readonly commandDelayTicks: number;
  private nextCommandSequence = 0;
  private nextFrameSequence = 0;
  private pending = new Map<number, PendingCommand[]>();
  private checksums = new Map<number, Map<PlayerId, string>>();

  constructor(options: LockstepRoomCoordinatorOptions) {
    this.roomId = options.roomId;
    this.commandDelayTicks = options.commandDelayTicks ?? 2;
  }

  acceptCommand(input: ClientCommandMessage): ServerCommandAck {
    const targetTick = input.currentTick + this.commandDelayTicks;
    const sequence = this.nextCommandSequence;
    this.nextCommandSequence += 1;
    const pending = this.pending.get(targetTick) ?? [];
    pending.push({
      sequence,
      playerId: input.playerId,
      command: input.command,
      ...(input.clientSeq !== undefined ? { clientSeq: input.clientSeq } : {}),
    });
    this.pending.set(targetTick, pending);
    return { roomId: this.roomId, accepted: true, sequence, targetTick };
  }

  buildFrame(serverTick: number): CommandFrame {
    const pending = this.pending.get(serverTick) ?? [];
    this.pending.delete(serverTick);
    const frame = {
      roomId: this.roomId,
      tick: serverTick,
      sequence: this.nextFrameSequence,
      commands: pending
        .sort((left, right) => left.sequence - right.sequence || left.playerId.localeCompare(right.playerId) || (left.clientSeq ?? 0) - (right.clientSeq ?? 0))
        .map(({ sequence: _sequence, ...entry }) => entry),
    };
    this.nextFrameSequence += 1;
    return frame;
  }

  recordChecksum(frame: ClientChecksumFrame): void {
    if (frame.roomId !== this.roomId) throw new Error(`Checksum room ${frame.roomId} does not match ${this.roomId}`);
    const byPlayer = this.checksums.get(frame.tick) ?? new Map<PlayerId, string>();
    byPlayer.set(frame.playerId, frame.hash);
    this.checksums.set(frame.tick, byPlayer);
  }

  checksumsForTick(tick: number): Record<PlayerId, string> {
    return Object.fromEntries(this.checksums.get(tick) ?? []) as Record<PlayerId, string>;
  }
}
