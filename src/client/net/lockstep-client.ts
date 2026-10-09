import { CommandFrameBuffer } from "../../shared/net/frame-buffer";
import type { CheckpointFrame, CheckpointRequestReason, CommandFrame, RoomSyncEvent, ServerNetMessage } from "../../shared/net/types";
import { restoreSnapshotIntoGame } from "../../shared/sim";
import { prepareShipPlanningJobs } from "../../shared/ship-planning-job";
import type { GameCommand, PlayerId } from "../../shared/types";
import type { SimulationEngine } from "../../shared/sim/engine";
import type { NetTransport } from "./transport";

const MAX_FRAMES_PER_RENDER = 4;
const RENDER_UPDATE_BUDGET_MS = 8;

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
  private epoch = 0;
  private closed = false;
  private readonly castsAwaitingFrame = new Map<number, Extract<GameCommand, { type: "cast" }>>();

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
      epoch: this.epoch,
    });
  }

  currentSnapshot() {
    return this.options.engine.snapshot();
  }

  currentChecksum(): string {
    return this.options.engine.checksum();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.frameBuffer.clear();
    this.castsAwaitingFrame.clear();
    this.options.transport.close();
  }

  sendCommand(command: GameCommand): void {
    const clientSeq = this.localInputSeq;
    this.localInputSeq += 1;
    if (command.type === "cast") this.castsAwaitingFrame.set(clientSeq, command);
    try {
      this.options.transport.send({
        type: "command",
        roomId: this.options.roomId,
        playerId: this.options.playerId,
        clientSeq,
        command,
        epoch: this.epoch,
      });
    } catch (error) {
      this.castsAwaitingFrame.delete(clientSeq);
      throw error;
    }
  }

  pendingCasts() {
    return [...this.castsAwaitingFrame.values()];
  }

  receiveFrame(frame: CommandFrame): void {
    if (this.closed) return;
    if (frame.roomId !== this.options.roomId) throw new Error(`Received frame for ${frame.roomId} while joined to ${this.options.roomId}`);
    this.frameBuffer.push(frame);
  }

  updateToRenderTime(): boolean {
    if (this.closed) return false;
    const started = performance.now();
    // Restored navigation graphs are disposable derived state. Rebuild at
    // most one prior search slice per render, leaving authoritative frames
    // buffered until their exact simulation inputs are ready.
    if (!prepareShipPlanningJobs(this.options.engine.game, 1)) return false;
    if (performance.now() - started >= RENDER_UPDATE_BUDGET_MS) return false;
    let changed = false;
    let appliedFrames = 0;
    while (appliedFrames < MAX_FRAMES_PER_RENDER && this.frameBuffer.has(this.options.engine.game.tick)) {
      const frame = this.frameBuffer.take(this.options.engine.game.tick);
      if (!frame) return changed;
      try {
        this.options.engine.advanceFrame(frame);
        for (const entry of frame.commands) if (entry.playerId === this.options.playerId && entry.clientSeq !== undefined) this.castsAwaitingFrame.delete(entry.clientSeq);
      } catch (error) {
        // @@@lockstep-resync - A bad or stale frame is a visible sync failure; report it, then recover from server truth instead of crashing the render loop.
        const message = errorMessage(error);
        this.options.onError?.(message);
        this.emitSyncEvent({ kind: "frame-apply-error", localTick: this.options.engine.game.tick, message, frameTick: frame.tick, frameSequence: frame.sequence });
        this.requestCheckpoint("frame-apply-error");
        return changed;
      }
      changed = true;
      appliedFrames += 1;
      this.emitChecksumIfDue();
      // Catch up in FIFO order while still giving input and paint a turn.
      if (performance.now() - started >= RENDER_UPDATE_BUDGET_MS) break;
    }
    return changed;
  }

  private receiveMessage(message: ServerNetMessage): void {
    if (message.type === "hello") {
      if (message.roomId !== this.options.roomId || message.playerId !== this.options.playerId) return;
      this.epoch = message.epoch;
      // A resumed or replaced match may already have a newer epoch; request truth only after the server handshake.
      this.requestCheckpoint("initial-sync");
      return;
    }
    if (message.type === "frame") {
      if (!this.acceptsServerEpoch(message)) return;
      this.receiveFrame(message.frame);
    }
    if (message.type === "checkpoint") {
      this.epoch = message.epoch;
      this.restoreCheckpoint(message.checkpoint);
    }
    if (message.type === "desync") {
      if (!this.acceptsServerEpoch(message)) return;
      // @@@lockstep-desync-recovery - Desync is a synchronization failure, not a page-fatal exception; the server checkpoint is the recovery boundary.
      const error = `Lockstep desync at tick ${message.tick}`;
      this.options.onError?.(error);
      this.emitSyncEvent({ kind: "server-desync", localTick: this.options.engine.game.tick, serverTick: message.tick, message: error, checksums: message.checksums });
      this.requestCheckpoint("server-desync");
    }
    if (message.type === "error" && message.roomId === this.options.roomId) {
      if (message.clientSeq !== undefined) this.castsAwaitingFrame.delete(message.clientSeq);
      this.options.onError?.(message.message);
    }
  }

  private handleServerMessage(message: ServerNetMessage): void {
    if (this.closed) return;
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
    restoreSnapshotIntoGame(this.options.engine.game, checkpoint.snapshot, checkpoint.nextId);
    this.frameBuffer.clear();
    this.castsAwaitingFrame.clear();
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
    this.options.transport.send({ type: "checksum", roomId: this.options.roomId, playerId: this.options.playerId, tick, hash: this.currentChecksum(), epoch: this.epoch });
    this.lastChecksumTick = tick;
  }

  private emitSyncEvent(event: Omit<RoomSyncEvent, "roomId" | "playerId">): void {
    this.options.transport.send({ type: "syncEvent", roomId: this.options.roomId, epoch: this.epoch, event: { roomId: this.options.roomId, playerId: this.options.playerId, ...event } });
  }

  private acceptsServerEpoch(message: { epoch: number }): boolean {
    return message.epoch === this.epoch;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
