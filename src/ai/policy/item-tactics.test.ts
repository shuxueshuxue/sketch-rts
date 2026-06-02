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
});
