import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { isEnemyOwner, isOpponentOwner, opponentPlayerIds, teamFor } from "./ownership";

describe("AI policy ownership helpers", () => {
  it("uses SDK team semantics for ally, opponent, and neutral owners", () => {
    const scene = sketchScene("ai-policy-ownership")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("ally", { team: "north", race: "ember" })
      .player("enemy", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("ally", 700, 500)
      .townHall("enemy", 3300, 3300)
      .build();
    const game = scene.createGame();
    const snapshot = snapshotGame(game);
    const options = { teams: game.teams };

    expect(teamFor(snapshot, "v2", options)).toBe("north");
    expect(teamFor(snapshot, "neutral", options)).toBe("neutral");
    expect(opponentPlayerIds(snapshot, "v2", options)).toEqual(["enemy"]);
    expect(isOpponentOwner(snapshot, "v2", "ally", options)).toBe(false);
    expect(isOpponentOwner(snapshot, "v2", "enemy", options)).toBe(true);
    expect(isEnemyOwner(snapshot, "v2", "neutral", options)).toBe(true);
  });
});
