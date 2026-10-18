import { describe, expect, it } from "vitest";
import { createGame, issueCommand, snapshotGame, stepGame } from "../../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import { createMetricTrackers } from "./metrics";

// See @@@bench-metrics: stall@N counts the unit-minutes a land fighter under a move stood still N seconds in a row.
describe("bench metric stall@N", () => {
  function measure(setup: (game: ReturnType<typeof createGame>) => void, seconds: number) {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
    game.units = [];
    game.scriptedVictory = true;
    setup(game);
    const [tracker] = createMetricTrackers(["stall@10"]);
    const context = { game, match: {} as never, players: ["player", "enemy"] as const };
    const state = tracker!.create!(context as never);
    for (let tick = 0; tick < seconds * SIM_TICKS_PER_SECOND; tick++) {
      stepGame(game);
      tracker!.afterStep!(state, { ...context, after: snapshotGame(game) } as never);
    }
    return tracker!.finish(state, context as never);
  }

  it("counts a fighter held in place under a move past the first ten seconds", () => {
    const values = measure((game) => {
      const footman = game.spawnUnit("player", "footman", 400, 400);
      issueCommand(game, { type: "move", unitIds: [footman.id], x: 1400, y: 400 });
      footman.speed = 0;
    }, 70);
    expect(values.player).toBeCloseTo(1, 1);
    expect(values.enemy).toBe(0);
  });

  it("counts nothing for a fighter that walks, or one standing to fight", () => {
    const walking = measure((game) => {
      const footman = game.spawnUnit("player", "footman", 200, 400);
      issueCommand(game, { type: "move", unitIds: [footman.id], x: 1800, y: 400 });
    }, 20);
    expect(walking.player).toBe(0);
    const fighting = measure((game) => {
      const archer = game.spawnUnit("player", "archer", 400, 400);
      game.spawnUnit("enemy", "golem", 600, 400).speed = 0;
      issueCommand(game, { type: "attackMove", unitIds: [archer.id], x: 1400, y: 400 });
    }, 40);
    expect(fighting.player).toBe(0);
  });
});
