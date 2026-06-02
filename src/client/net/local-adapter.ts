import { snapshotGame, type Game } from "../../shared/sim";
import { stepCommandFrame } from "../../shared/sim/frame";
import type { GameCommand, GameSnapshot, PlayerId } from "../../shared/types";
import type { GameAdapter } from "../game-adapter";

export class LocalGameAdapter implements GameAdapter {
  private sequence = 0;

  constructor(
    private readonly game: Game,
    private readonly playerId: PlayerId,
  ) {}

  sendCommand(command: GameCommand): void {
    stepCommandFrame(this.game, {
      roomId: "local",
      tick: this.game.tick,
      sequence: this.sequence,
      commands: [{ playerId: this.playerId, command }],
    });
    this.sequence += 1;
  }

  currentSnapshot(): GameSnapshot {
    return snapshotGame(this.game);
  }

  updateToRenderTime(): boolean {
    return false;
  }

  close(): void {}
}
