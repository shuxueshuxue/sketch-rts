import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { planItemCommands } from "./item-tactics";

describe("AI item tactics", () => {
  it("uses a carried experience book immediately", () => {
    const game = sketchScene("item-tactics-use-book")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 540, 520, { id: "book-carrier" })
      .item("book", "experienceBook", 540, 520, { carrierId: "book-carrier" })
      .build()
      .createGame();

    expect(planItemCommands(snapshotGame(game), "v2", { version: "v2" })[0]).toEqual({ type: "useItem", unitId: "book-carrier", itemId: "book" });
  });

  it("picks up ground items with nearby combat units", () => {
    const game = sketchScene("item-tactics-pickup")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .worker("v2", 520, 500, { id: "worker" })
      .unit("v2", "footman", 540, 500, { id: "carrier" })
      .item("scroll", "guardianScroll", 560, 500)
      .build()
      .createGame();

    expect(planItemCommands(snapshotGame(game), "v2", { version: "v2" })[0]).toEqual({ type: "pickupItem", unitId: "carrier", itemId: "scroll" });
  });

  it("feeds experience books to a near-level veteran before a fresh high-stat unit", () => {
    const game = sketchScene("item-tactics-veteran-book")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 540, 500, { id: "veteran", xp: 200 })
      .unit("v2", "knight", 550, 500, { id: "fresh-knight" })
      .item("book", "experienceBook", 545, 500)
      .build()
      .createGame();

    expect(planItemCommands(snapshotGame(game), "v2", { version: "v2" })[0]).toEqual({ type: "pickupItem", unitId: "veteran", itemId: "book" });
  });

  it("uses high-impact combat items on real units instead of temporary summons when both are in range", () => {
    const game = sketchScene("item-tactics-real-target-before-spirit")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .unit("v2", "fieldMedic", 500, 760, { id: "rod-carrier" })
      .item("rod", "lightningRod", 0, 0, { carrierId: "rod-carrier" })
      .townHall("v1", 1450, 800)
      .unit("v1", "spirit", 545, 760, { id: "nearest-spirit" })
      .unit("v1", "witch", 710, 760, { id: "real-caster", hp: 35 })
      .build()
      .createGame();

    expect(planItemCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0]).toEqual({
      type: "useItem",
      unitId: "rod-carrier",
      itemId: "rod",
      targetId: "real-caster",
    });
  });
});
