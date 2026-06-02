import { snapshotGame, stepGame, type Game } from "../sim";
import type { CommandFrame } from "../net/types";
import type { GameSnapshot } from "../types";
import { checksumGame } from "./checksum";
import { applyCommandFrame } from "./frame";

export class SimulationEngine {
  constructor(public game: Game) {}

  applyFrame(frame: CommandFrame): void {
    applyCommandFrame(this.game, frame);
  }

  step(): void {
    stepGame(this.game);
  }

  snapshot(): GameSnapshot {
    return snapshotGame(this.game);
  }

  checksum(): string {
    return checksumGame(this.game);
  }
}
