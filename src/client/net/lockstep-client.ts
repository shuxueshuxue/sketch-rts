import { CommandFrameBuffer } from "../../shared/net/frame-buffer";
import type { CheckpointFrame, CommandFrame, ServerNetMessage } from "../../shared/net/types";
import type { Game } from "../../shared/sim";
import type { GameCommand, PlayerId } from "../../shared/types";
import type { SimulationEngine } from "../../shared/sim/engine";
import type { NetTransport } from "./transport";

export type LockstepClientOptions = {
  roomId: string;
  playerId: PlayerId;
  engine: SimulationEngine;
  transport: NetTransport;
};

export class LockstepClient {
  private readonly frameBuffer = new CommandFrameBuffer();
  private localInputSeq = 0;

  constructor(private readonly options: LockstepClientOptions) {
    this.options.transport.onMessage((message) => this.receiveMessage(message));
  }

  join(): void {
    this.options.transport.send({ type: "join", roomId: this.options.roomId, playerId: this.options.playerId });
  }

  requestCheckpoint(): void {
    this.options.transport.send({ type: "requestCheckpoint", roomId: this.options.roomId });
  }

  currentSnapshot() {
    return this.options.engine.snapshot();
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
      this.options.engine.applyFrame(frame);
      this.options.engine.step();
      changed = true;
    }
    return changed;
  }

  private receiveMessage(message: ServerNetMessage): void {
    if (message.type === "frame") this.receiveFrame(message.frame);
    if (message.type === "checkpoint") this.restoreCheckpoint(message.checkpoint);
    if (message.type === "desync") throw new Error(`Lockstep desync at tick ${message.tick}`);
  }

  private restoreCheckpoint(checkpoint: CheckpointFrame): void {
    if (checkpoint.roomId !== this.options.roomId) throw new Error(`Received checkpoint for ${checkpoint.roomId} while joined to ${this.options.roomId}`);
    restoreGameSnapshot(this.options.engine.game, checkpoint);
    this.frameBuffer.discardBefore(checkpoint.tick);
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
