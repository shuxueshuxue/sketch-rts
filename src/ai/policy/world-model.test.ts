import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { availableBuilder, mainBase, mineAssignmentCounts } from "./world-model";

describe("AI world model helpers", () => {
  it("selects the first completed town hall as the main base", () => {
    const game = sketchScene("world-model-main-base")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500, { id: "main-hall" })
      .townHall("v2", 900, 900, { id: "unfinished-hall", complete: false })
      .build()
      .createGame();

    expect(mainBase(snapshotGame(game), "v2")).toMatchObject({ id: "main-hall" });
  });

  it("does not reuse a worker already assigned to an unfinished building", () => {
    const game = sketchScene("world-model-builder-reservation")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 640, 520, { id: "unfinished-barracks", complete: false })
      .worker("v2", 610, 520, { id: "reserved-worker", order: { type: "move", x: 630, y: 520 } })
      .worker("v2", 700, 520, { id: "free-worker" })
      .build()
      .createGame();

    expect(availableBuilder(snapshotGame(game), "v2", { x: 640, y: 520 })).toMatchObject({ id: "free-worker" });
  });

  it("counts mine assignments by resource id", () => {
    const game = sketchScene("world-model-mine-counts")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .goldMine("mine-a", 700, 500, 6000)
      .worker("v2", 520, 500, { order: { type: "mine", resourceId: "mine-a", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 500, { order: { type: "mine", resourceId: "mine-a", phase: "gather", timer: 0 } })
      .build()
      .createGame();
    const workers = snapshotGame(game).units.filter((unit) => unit.owner === "v2");

    expect(mineAssignmentCounts(workers).get("mine-a")).toBe(2);
  });
});
