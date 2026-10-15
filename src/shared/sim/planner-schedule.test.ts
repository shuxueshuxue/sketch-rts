import { describe, expect, it } from "vitest";
import { createGame } from "../sim";
import { partitionDeliveredPlannerCommands, plannerPhase, plannerThinksAt } from "./planner-schedule";
import type { CommandEnvelope } from "../net/types";

describe("planner schedule", () => {
  it("spreads planners evenly over one think interval", () => {
    expect([0, 1, 2, 3, 4].map((index) => plannerPhase(index, 5, 15))).toEqual([0, 3, 6, 9, 12]);
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => plannerPhase(index, 7, 15))).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(plannerPhase(0, 1, 15)).toBe(0);
    expect([0, 1, 2].map((index) => plannerPhase(index, 3, 1))).toEqual([0, 0, 0]);
  });

  it("thinks on its phase and every interval after it", () => {
    const ticks = Array.from({ length: 40 }, (_, tick) => tick).filter((tick) => plannerThinksAt(tick, 6, 15));
    expect(ticks).toEqual([6, 21, 36]);
  });

  it("drops a delivered command the world outgrew and keeps the rest for apply", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.mercenaryCamps = [{ id: "camp-gone-later", x: worker.x, y: worker.y, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 90, cooldownRemaining: 0 }];
    const hire: CommandEnvelope = { playerId: "player", command: { type: "hire", campId: "camp-gone-later" } };
    const move: CommandEnvelope = { playerId: "player", command: { type: "move", unitIds: [worker.id], x: worker.x + 40, y: worker.y } };
    const goneIssuer: CommandEnvelope = { playerId: "player", command: { type: "move", unitIds: ["unit-died-during-delay"], x: 0, y: 0 } };
    expect(partitionDeliveredPlannerCommands(game, [hire, move])).toEqual({ deliverable: [hire, move], stale: [] });

    game.mercenaryCamps = [];

    expect(partitionDeliveredPlannerCommands(game, [hire, move, goneIssuer])).toEqual({ deliverable: [move, goneIssuer], stale: [hire] });
  });
});
