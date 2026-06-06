import { CommandFrameBuffer } from "../../shared/net/frame-buffer";
import type { CheckpointFrame, CheckpointRequestReason, CommandFrame, RoomSyncEvent, ServerNetMessage } from "../../shared/net/types";
import type { Game } from "../../shared/sim";
import type { GameCommand, PlayerId } from "../../shared/types";
import type { SimulationEngine } from "../../shared/sim/engine";
import type { NetTransport } from "./transport";

export type LockstepClientOptions = {
  roomId: string;
  playerId: PlayerId;
  engine: SimulationEngine;
  transport: NetTransport;
  checksumEveryTicks?: number;
  onError?: (message: string) => void;
};

export class LockstepClient {
  private readonly frameBuffer = new CommandFrameBuffer();
  private localInputSeq = 0;
  private lastChecksumTick = -1;

  constructor(private readonly options: LockstepClientOptions) {
    this.options.transport.onMessage((message) => this.handleServerMessage(message));
  }

  join(): void {
    this.options.transport.send({ type: "join", roomId: this.options.roomId, playerId: this.options.playerId });
  }

  requestCheckpoint(reason: CheckpointRequestReason = "manual", tick?: number): void {
    this.options.transport.send({
      type: "requestCheckpoint",
      roomId: this.options.roomId,
      playerId: this.options.playerId,
      ...(tick !== undefined ? { tick } : {}),
      reason,
      clientTick: this.options.engine.game.tick,
      clientChecksum: this.currentChecksum(),
    });
  }

  currentSnapshot() {
    return this.options.engine.snapshot();
  }

  currentChecksum(): string {
    return this.options.engine.checksum();
  }

  close(): void {
    this.options.transport.close();
  }

  sendCommand(command: GameCommand): void {
    const clientSeq = this.localInputSeq;
    this.localInputSeq += 1;
    this.options.transport.send({
      type: "command",
      roomId: this.options.roomId,
      playerId: this.options.playerId,
      clientSeq,
      command,
    });
  }

  receiveFrame(frame: CommandFrame): void {
    if (frame.roomId !== this.options.roomId) throw new Error(`Received frame for ${frame.roomId} while joined to ${this.options.roomId}`);
    this.frameBuffer.push(frame);
  }

  updateToRenderTime(): boolean {
    let changed = false;
    while (this.frameBuffer.has(this.options.engine.game.tick)) {
      const frame = this.frameBuffer.take(this.options.engine.game.tick);
      if (!frame) return changed;
      try {
        this.options.engine.advanceFrame(frame);
      } catch (error) {
        // @@@lockstep-resync - A bad or stale frame is a visible sync failure; report it, then recover from server truth instead of crashing the render loop.
        const message = errorMessage(error);
        this.options.onError?.(message);
        this.emitSyncEvent({ kind: "frame-apply-error", localTick: this.options.engine.game.tick, message, frameTick: frame.tick, frameSequence: frame.sequence });
        this.requestCheckpoint("frame-apply-error");
        return changed;
      }
      changed = true;
      this.emitChecksumIfDue();
    }
    return changed;
  }

  private receiveMessage(message: ServerNetMessage): void {
    if (message.type === "frame") this.receiveFrame(message.frame);
    if (message.type === "checkpoint") this.restoreCheckpoint(message.checkpoint);
    if (message.type === "desync") {
      // @@@lockstep-desync-recovery - Desync is a synchronization failure, not a page-fatal exception; the server checkpoint is the recovery boundary.
      const error = `Lockstep desync at tick ${message.tick}`;
      this.options.onError?.(error);
      this.emitSyncEvent({ kind: "server-desync", localTick: this.options.engine.game.tick, serverTick: message.tick, message: error, checksums: message.checksums });
      this.requestCheckpoint("server-desync");
    }
    if (message.type === "error" && message.roomId === this.options.roomId) this.options.onError?.(message.message);
  }

  private handleServerMessage(message: ServerNetMessage): void {
    try {
      this.receiveMessage(message);
    } catch (error) {
      // @@@lockstep-message-boundary - Transport callbacks run on the browser event loop; report sync faults visibly instead of letting one bad packet become a page-fatal exception.
      const message = errorMessage(error);
      this.options.onError?.(message);
      this.emitSyncEvent({ kind: "message-error", localTick: this.options.engine.game.tick, message });
      this.requestCheckpoint("message-error");
    }
  }

  private restoreCheckpoint(checkpoint: CheckpointFrame): void {
    if (checkpoint.roomId !== this.options.roomId) throw new Error(`Received checkpoint for ${checkpoint.roomId} while joined to ${this.options.roomId}`);
    restoreGameSnapshot(this.options.engine.game, checkpoint);
    this.frameBuffer.discardBefore(checkpoint.tick);
    this.emitSyncEvent({
      kind: "checkpoint-restore",
      localTick: this.options.engine.game.tick,
      serverTick: checkpoint.tick,
      ...(checkpoint.reason ? { reason: checkpoint.reason } : {}),
      ...(checkpoint.checkpointClass ? { checkpointClass: checkpoint.checkpointClass } : {}),
    });
  }

  private emitChecksumIfDue(): void {
    const cadence = Math.max(1, this.options.checksumEveryTicks ?? 20);
    const tick = this.options.engine.game.tick;
    if (tick === this.lastChecksumTick || tick % cadence !== 0) return;
    this.options.transport.send({ type: "checksum", roomId: this.options.roomId, playerId: this.options.playerId, tick, hash: this.currentChecksum() });
    this.lastChecksumTick = tick;
  }

  private emitSyncEvent(event: Omit<RoomSyncEvent, "roomId" | "playerId">): void {
    this.options.transport.send({ type: "syncEvent", roomId: this.options.roomId, event: { roomId: this.options.roomId, playerId: this.options.playerId, ...event } });
  }
}

function restoreGameSnapshot(game: Game, checkpoint: CheckpointFrame): void {
  game.tick = checkpoint.snapshot.tick;
  game.match = clone(checkpoint.snapshot.match);
  game.map = clone(checkpoint.snapshot.map);
  game.players = clone(checkpoint.snapshot.players);
  game.units = clone(checkpoint.snapshot.units);
  game.buildings = clone(checkpoint.snapshot.buildings);
  game.resources = clone(checkpoint.snapshot.resources);
  game.mercenaryCamps = clone(checkpoint.snapshot.mercenaryCamps);
  game.items = clone(checkpoint.snapshot.items);
  game.projectiles = clone(checkpoint.snapshot.projectiles);
  game.effects = clone(checkpoint.snapshot.effects);
  game.nextId = checkpoint.nextId;
  delete game.unitSpatial;
  delete game.unitSpatialByTeam;
  delete game.buildingSpatial;
  delete game.buildingSpatialByTeam;
  delete game.buildingSpatialCount;
  delete game.entityById;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
