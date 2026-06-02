import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { canClearGuardedExpansion, desiredExpansionMine, opponentEconomyAhead, shouldReserveForClearedExpansion } from "./expansion-model";

describe("AI expansion model", () => {
  it("chooses an unclaimed natural mine away from existing town halls", () => {
    const game = sketchScene("expansion-model-natural")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .goldMine("main-mine", 620, 500, 6000)
      .goldMine("natural-mine", 1300, 620, 6000)
      .build()
      .createGame();

    expect(desiredExpansionMine(snapshotGame(game), "v2")).toMatchObject({ id: "natural-mine" });
  });

  it("treats combined 1v2 economy as ahead when enemy workers materially outnumber ours", () => {
    const scene = sketchScene("expansion-model-enemy-economy-ahead")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .player("v1b", { team: "south" })
      .townHall("v2", 500, 500)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 10, 540);
    for (let i = 0; i < 10; i += 1) scene.worker(i % 2 === 0 ? "v1a" : "v1b", 3200 + i * 10, 3300);
    const game = scene.build().createGame();

    expect(opponentEconomyAhead(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe(true);
  });

  it("reserves first cleared expansion gold once a core army can claim it", () => {
    const scene = sketchScene("expansion-model-cleared-reserve")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .player("v1b", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .goldMine("natural-mine", 1300, 620, 6000)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 10, 540);
    for (let i = 0; i < 10; i += 1) scene.worker(i % 2 === 0 ? "v1a" : "v1b", 3200 + i * 10, 3300);
    for (let i = 0; i < 3; i += 1) scene.unit("v2", "footman", 700 + i * 24, 760);
    const game = scene.build().createGame();

    expect(shouldReserveForClearedExpansion(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe(true);
  });

  it("compares the assigned squad against guarded natural strength", () => {
    const game = sketchScene("expansion-model-guarded-natural")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .goldMine("natural-mine", 1300, 620, 6000)
      .unit("neutral", "wildling", 1320, 640, { id: "guard" })
      .unit("v2", "footman", 700, 760)
      .unit("v2", "footman", 730, 760)
      .unit("v2", "footman", 760, 760)
      .unit("v2", "footman", 790, 760)
      .build()
      .createGame();
    const snapshot = snapshotGame(game);
    const mine = snapshot.resources.find((resource) => resource.id === "natural-mine");
    const soldiers = snapshot.units.filter((unit) => unit.owner === "v2" && unit.kind === "footman");
    if (!mine) throw new Error("missing natural mine");

    expect(canClearGuardedExpansion(snapshot, mine, soldiers, { version: "v2" })).toBe(true);
  });
});
