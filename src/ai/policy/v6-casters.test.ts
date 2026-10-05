import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { planAbilityCommands } from "./spell-tactics";

const V6 = { version: "v2", requestedVersion: "v6" } as const;
const V5 = { version: "v2", requestedVersion: "v5" } as const;

function scene(name: string) {
  return sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v6", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v5", { team: "south", race: "grove" })
    .townHall("v6", 500, 500)
    .townHall("v3", 3_300, 3_300)
    .townHall("v5", 3_300, 3_800);
}

describe("v6 casters", () => {
  it("keeps summoning whenever the spell is ready, with a spirit already up and no enemy near", () => {
    const game = scene("v6-standing-spirits").unit("v6", "summoner", 900, 900, { id: "summoner" }).unit("v6", "spirit", 940, 910).build().createGame();
    const snapshot = snapshotGame(game);
    expect(planAbilityCommands(snapshot, "v6", { ...V6, teams: game.teams })).toMatchObject([{ type: "cast", unitId: "summoner", ability: "summon" }]);
    expect(planAbilityCommands(snapshot, "v6", { ...V5, teams: game.teams })).toEqual([]);
  });

  it("curses the hardest hitter in reach instead of the nearest enemy", () => {
    const game = scene("v6-curse-hardest-hitter")
      .unit("v6", "witch", 900, 900, { id: "witch" })
      .unit("v3", "footman", 1_000, 900, { id: "near-footman" })
      .unit("v5", "mercenary", 1_130, 900, { id: "far-mercenary" })
      .build()
      .createGame();
    const snapshot = snapshotGame(game);
    expect(planAbilityCommands(snapshot, "v6", { ...V6, teams: game.teams })).toMatchObject([{ type: "cast", unitId: "witch", ability: "curse", targetId: "far-mercenary" }]);
    expect(planAbilityCommands(snapshot, "v6", { ...V5, teams: game.teams })).toMatchObject([{ type: "cast", unitId: "witch", ability: "curse", targetId: "near-footman" }]);
  });
});
