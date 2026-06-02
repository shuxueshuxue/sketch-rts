import { describe, expect, it } from "vitest";
import { BUILDING_DEFS } from "../../shared/catalog";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { needsMainGuardTower, shouldGuardFreshMiningExpansion, shouldReserveForCoreProductionRecovery, shouldReserveForHealingWell } from "./base-defense-model";

describe("AI base defense model", () => {
  it("reserves cheap spending when core production must be rebuilt", () => {
    const game = sketchScene("base-defense-core-recovery")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .worker("v2", 540, 520)
      .build()
      .createGame();
    const player = game.players.v2;
    if (!player) throw new Error("missing v2 player");
    player.gold = BUILDING_DEFS.barracks.cost + BUILDING_DEFS.farm.cost - 1;

    expect(shouldReserveForCoreProductionRecovery(snapshotGame(game), "v2", { version: "v2" }, BUILDING_DEFS.farm.cost)).toBe(true);
  });

  it("asks for a main guard tower under two-sided 1v2 pressure", () => {
    const game = sketchScene("base-defense-main-guard")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .player("v1b", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .unit("v2", "footman", 620, 540)
      .unit("v2", "footman", 650, 540)
      .unit("v1a", "footman", 900, 520)
      .unit("v1b", "footman", 940, 560)
      .build()
      .createGame();

    expect(needsMainGuardTower(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe(true);
  });

  it("asks for a main guard tower under single-opponent main pressure", () => {
    const game = sketchScene("base-defense-single-opponent-main-guard")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .unit("v2", "footman", 620, 540)
      .unit("v2", "archer", 650, 540)
      .unit("v1", "footman", 900, 520)
      .unit("v1", "lancer", 940, 560)
      .unit("v1", "archer", 980, 600)
      .build()
      .createGame();

    expect(needsMainGuardTower(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe(true);
  });

  it("guards a fresh mining expansion once workers are actually mining there", () => {
    const game = sketchScene("base-defense-fresh-expansion")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .player("v1b", { team: "south" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1450, 640, { id: "v2-natural" })
      .goldMine("natural-mine", 1500, 650, 6000)
      .worker("v2", 1480, 650, { order: { type: "mine", resourceId: "natural-mine", phase: "gather", timer: 0 } })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .build()
      .createGame();
    const snapshot = snapshotGame(game);
    const base = snapshot.buildings.find((building) => building.id === "v2-natural");
    if (!base) throw new Error("missing natural base");

    expect(shouldGuardFreshMiningExpansion(snapshot, "v2", base, { version: "v2", teams: game.teams })).toBe(true);
  });

  it("reserves moon well gold when wounded defenders are pressured near main", () => {
    const game = sketchScene("base-defense-moon-well-reserve")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .unit("v2", "archer", 620, 540, { hp: 20 })
      .unit("v1a", "footman", 900, 520)
      .build()
      .createGame();
    const player = game.players.v2;
    if (!player) throw new Error("missing v2 player");
    player.gold = BUILDING_DEFS.moonWell.cost - 10;

    expect(shouldReserveForHealingWell(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe(true);
  });
});
