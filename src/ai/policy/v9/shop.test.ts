import { describe, expect, it } from "vitest";
import { createShop } from "../../../shared/shop";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../../../shared/sim";
import type { ScenarioUnitSeed } from "../../../shared/types";
import { createAiPolicyMemory } from "../../memory";
import { planArmyShopping } from "./shop";

// V9 ("v9") at home with an army and gold, a shop 600 off; its enemy far away.
function shopGame(extra: ScenarioUnitSeed[] = []) {
  const army: ScenarioUnitSeed[] = Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, owner: "v9", kind: "footman", x: 900 + index * 30, y: 900 }));
  return createGame("bareDuel", {
    players: ["v9", "rival"],
    teams: { v9: "a", rival: "b" },
    scenario: {
      players: { v9: { gold: 1_000 } },
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      replaceDefaultMercenaryCamps: true,
      addBuildings: [{ id: "hall", owner: "v9", kind: "townHall", x: 600, y: 600 }, { id: "rival-hall", owner: "rival", kind: "townHall", x: 3_400, y: 3_400 }],
      addShops: [createShop("shop", 1_400, 1_100)],
      addUnits: [...army, ...extra],
    },
  });
}

const V9 = (memory = createAiPolicyMemory()) => ({ version: "v2" as const, requestedVersion: "v9" as const, teams: { v9: "a", rival: "b" }, memory });

describe("V9 at a shop (see @@@v9-shop)", () => {
  it("sends one fighter to a safe shop in a lull and buys it a guardian scroll there", () => {
    const game = shopGame();
    const options = V9();
    const [move] = planArmyShopping(snapshotGame(game), "v9", options);
    expect(move).toMatchObject({ type: "move", x: 1_400, y: 1_100 });
    if (move?.type !== "move") throw new Error("no errand");
    const shopper = move.unitIds[0]!;
    expect(options.memory.v6?.shop).toMatchObject({ shopId: "shop", kind: "guardianScroll", unitId: shopper });
    issuePlayerCommand(game, "v9", move);
    let bought = false;
    for (let tick = 0; tick < 600 && !bought; tick += 1) {
      stepGame(game);
      if (tick % 15 !== 0) continue;
      for (const command of planArmyShopping(snapshotGame(game), "v9", options)) {
        if (command.type === "buy") bought = true;
        issuePlayerCommand(game, "v9", command);
      }
    }
    expect(game.items.find((item) => item.kind === "guardianScroll")?.carrierId).toBe(shopper);
    expect(game.players.v9!.gold).toBe(1_000 - 200);
  });

  it.each(["v5", "v7", "v8"] as const)("shares safe shopping with %s and cancels an errand when danger approaches", version => {
    const game = shopGame();
    const options = { ...V9(), requestedVersion: version };
    expect(planArmyShopping(snapshotGame(game), "v9", options)[0]?.type).toBe("move");
    game.spawnUnit("rival", "footman", 1_400, 1_150);
    expect(planArmyShopping(snapshotGame(game), "v9", options)).toEqual([]);
    expect(options.memory.v6?.shop).toBeUndefined();
  });

  it("shuns a shop an enemy army stands by", () => {
    const guarded = shopGame(Array.from({ length: 4 }, (_, index) => ({ id: `r${index}`, owner: "rival", kind: "footman", x: 1_500 + index * 30, y: 1_200 })));
    expect(planArmyShopping(snapshotGame(guarded), "v9", V9())).toEqual([]);
  });
});
