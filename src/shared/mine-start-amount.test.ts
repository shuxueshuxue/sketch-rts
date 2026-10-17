import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "./sim";
import { MAP_POOL } from "./map-pool";

// A view draws a mine as full, worked down or worked out against the gold it was laid with.
describe("a mine's start amount", () => {
  it.each(MAP_POOL.map(spec => [spec.id, spec.players] as const))("is what each mine on %s holds when the game starts", (map, seats) => {
    const game = createGame(map, { players: Array.from({ length: seats }, (_, i) => `p${i + 1}`), aiPlayers: [] });
    expect(game.resources.length).toBeGreaterThan(0);
    for (const mine of game.resources) expect(mine.startAmount, mine.id).toBe(mine.amount);
  });

  it("stays put while workers carry the mine's gold away", () => {
    const game = createGame("bareDuel", { players: ["p1", "p2"], aiPlayers: [] });
    game.scriptedVictory = true;
    const mine = game.resources.find(resource => resource.id === "gold-p1-main")!;
    const laid = mine.amount;
    issuePlayerCommand(game, "p1", { type: "mine", resourceId: mine.id, unitIds: game.units.filter(unit => unit.owner === "p1" && unit.kind === "worker").map(unit => unit.id) });
    for (let tick = 0; tick < 600; tick++) stepGame(game);
    expect(mine.amount).toBeLessThan(laid);
    expect(snapshotGame(game).resources.find(resource => resource.id === mine.id)).toMatchObject({ amount: mine.amount, startAmount: laid });
  });

  it("is what a scenario's own mine holds when laid", () => {
    const game = createGame("bareDuel", { players: ["p1", "p2"], aiPlayers: [], scenario: { addResources: [{ id: "laid", kind: "goldMine", x: 900, y: 900, amount: 1234 }] } });
    expect(game.resources.find(resource => resource.id === "laid")).toMatchObject({ amount: 1234, startAmount: 1234 });
  });
});
