import { describe, expect, it } from "vitest";
import { issuePlayerCommand, snapshotGame, stepGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { canClearGuardedExpansion, depletedEconomyExpansion, desiredExpansionMine, desiredForwardExpansionMine, opponentEconomyAhead, shouldReserveForClearedExpansion, shouldReserveForExpansion } from "./expansion-model";
import { AI_SCRIPT_LIBRARY } from "./core";
import { BUILDING_DEFS } from "../../shared/catalog";
import { createUnit } from "../../shared/map";
import { createAiPolicyMemory } from "../memory";

function depletedMiningGame() {
  const scene = sketchScene("depleted-two-base-economy").map("bareDuel").replaceDefaults()
    .player("v2", { team: "north", race: "grove" }).player("v1", { team: "south", race: "ember" })
    .playerState("v2", { gold: BUILDING_DEFS.townHall.cost - 1 })
    .townHall("v2", 500, 500).townHall("v2", 1400, 500).townHall("v1", 3400, 3400)
    .building("v2", "barracks", 700, 500)
    .goldMine("empty-main", 716, 500, 0).goldMine("empty-natural", 1616, 500, 0)
    .goldMine("remote", 2300, 1000, 6000);
  for (let i = 0; i < 5; i++) scene.worker("v2", 2240, 980 + i * 10, { id: `hauler-${i}`,
    order: { type: "mine", resourceId: "remote", phase: "toMine", timer: 0 } });
  for (let i = 0; i < 4; i++) scene.unit("v2", "footman", 1700 + i * 30, 1400);
  return scene.build().createGame();
}

describe("AI expansion model", () => {
  it("banks a legal replacement mining base after both old mines are exhausted", () => {
    const game = depletedMiningGame(), options = { version: "v2" as const, teams: game.teams, memory: createAiPolicyMemory() };
    const snapshot = snapshotGame(game);
    expect(opponentEconomyAhead(snapshot, "v2", options)).toBe(false);
    const recovery = depletedEconomyExpansion(snapshot, "v2", options)!;
    expect(recovery.mine.id).toBe("remote");
    expect(shouldReserveForExpansion(snapshot, "v2", options)).toBe(true);
    expect(AI_SCRIPT_LIBRARY.training.run(snapshot, "v2", options)).toEqual([]);
    expect(AI_SCRIPT_LIBRARY.expansion.run(snapshot, "v2", options)).toBeUndefined();
    game.players.v2!.gold += 1;
    const command = AI_SCRIPT_LIBRARY.expansion.run(snapshotGame(game), "v2", options)!;
    expect(command).toMatchObject({ type: "build", buildingKind: "townHall", unitId: recovery.builder.id, ...recovery.point });
    if (Array.isArray(command)) throw new Error("expected one foundation");
    issuePlayerCommand(game, "v2", command);
    for (let i = 0; i < 1000 && game.buildings.filter(building => building.owner === "v2" && building.kind === "townHall").length < 3; i++) stepGame(game);
    expect(game.buildings.filter(building => building.owner === "v2" && building.kind === "townHall")).toHaveLength(3);
    expect(game.match.stats.goldSpent.v2).toBe(BUILDING_DEFS.townHall.cost);
  });

  it.each(["live-near-mine", "enemy-at-remote", "neutral-at-remote", "no-miner", "insufficient-mine", "blocked-foundation"])("releases the replacement bank for %s", condition => {
    const game = depletedMiningGame();
    const remote = game.resources.find(resource => resource.id === "remote")!;
    if (condition === "live-near-mine") game.resources[0]!.amount = 10;
    if (condition === "enemy-at-remote") game.units.push(createUnit("raider", "v1", "footman", remote.x, remote.y));
    if (condition === "neutral-at-remote") game.units.push(createUnit("guard", "neutral", "wildling", remote.x, remote.y));
    if (condition === "no-miner") game.units = game.units.filter(unit => unit.kind !== "worker");
    if (condition === "insufficient-mine") { remote.amount = 1; game.players.v2!.gold = 0; }
    if (condition === "blocked-foundation") {
      const cell = 64, cols = 64, rows = 64;
      const cells = Array.from({ length: cols * rows }, (_, at) => {
        const x = (at % cols + .5) * cell, y = (Math.floor(at / cols) + .5) * cell;
        return Math.hypot(x - remote.x, y - remote.y) < 400 ? "#" : ".";
      });
      cells[Math.floor(remote.y / cell) * cols + Math.floor(remote.x / cell)] = ".";
      game.map = { ...game.map, terrain: { cell, cols, rows, cells: cells.join("") } };
    }
    const snapshot = snapshotGame(game), options = { version: "v2" as const, teams: game.teams };
    expect(depletedEconomyExpansion(snapshot, "v2", options)).toBeUndefined();
    expect(shouldReserveForExpansion(snapshot, "v2", options)).toBe(false);
  });

  it("reuses a frame's legal foundation while releasing a newly claimed builder", () => {
    const game = depletedMiningGame(), snapshot = snapshotGame(game);
    const memory = createAiPolicyMemory(), options = { version: "v2" as const, teams: game.teams, memory };
    const first = depletedEconomyExpansion(snapshot, "v2", options)!;
    first.point.x = -1;
    memory.unitClaims[first.builder.id] = { kind: "retreat", targetId: "retreat", x: 500, y: 500, sinceTick: snapshot.tick, expiresTick: snapshot.tick + 900 };
    const second = depletedEconomyExpansion(snapshot, "v2", options)!;
    expect(second.builder.id).not.toBe(first.builder.id);
    expect(second.point.x).toBeGreaterThan(0);
    for (const worker of snapshot.units.filter(unit => unit.kind === "worker")) memory.unitClaims[worker.id] = { kind: "retreat", targetId: "retreat", x: 500, y: 500, sinceTick: snapshot.tick, expiresTick: snapshot.tick + 900 };
    expect(depletedEconomyExpansion(snapshot, "v2", options)).toBeUndefined();
  });

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

  it("does not choose an occupied town-hall mine as a forward expansion", () => {
    const scene = sketchScene("expansion-model-forward-occupied-mine")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .player("v1b", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .goldMine("ordinary-natural", 1300, 620, 6000)
      .goldMine("occupied-forward", 2500, 2500, 6000)
      .townHall("v1a", 2520, 2500)
      .townHall("v1b", 3300, 3800);
    for (let index = 0; index < 6; index += 1) scene.unit("v2", index % 2 === 0 ? "footman" : "lancer", 2470 + index * 16, 2500);
    const game = scene.build().createGame();

    expect(desiredForwardExpansionMine(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBeUndefined();
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
