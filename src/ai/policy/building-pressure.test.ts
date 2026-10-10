import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { snapshotGame } from "../../shared/sim";
import type { GameSnapshot } from "../../shared/types";
import { AI_SCRIPT_LIBRARY, planAiCommandsFromScripts } from "../policy";

const defenderIds = ["defender-a", "defender-b", "defender-c"];

function defenseScene(name: string) {
  return sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("defender", { team: "north", race: "grove" })
    .player("invader", { team: "south", race: "ember" })
    .townHall("defender", 400, 400)
    .worker("defender", 500, 500)
    .unit("defender", "footman", 1500, 900, { id: defenderIds[0]! })
    .unit("defender", "footman", 1530, 940, { id: defenderIds[1]! })
    .unit("defender", "footman", 1560, 980, { id: defenderIds[2]! })
    .townHall("invader", 3500, 3500);
}

function defenseCommands(snapshot: GameSnapshot) {
  return planAiCommandsFromScripts(snapshot, "defender", [AI_SCRIPT_LIBRARY.attackWave], {
    version: "v2", ...(snapshot.teams ? { teams: snapshot.teams } : {}),
  });
}

function defendAt(x: number, y: number) {
  return [{ type: "attackMove", unitIds: defenderIds, x, y }];
}

describe("building pressure defense", () => {
  it.each([
    { reach: 788, threatened: true },
    { reach: 788.01, threatened: false },
  ])("counts a distant siege target only within its reach allowance ($reach)", ({ reach, threatened }) => {
    const game = defenseScene(`target-only-building-pressure-${reach}`)
      .building("defender", "farm", 1600, 1000, { id: "protected-farm", hp: 100 })
      .unit("invader", "catapult", 1600 + reach, 1000, {
        id: "siege", order: { type: "attack", targetId: "protected-farm" },
      })
      .build().createGame();
    const snapshot = snapshotGame(game);
    const before = structuredClone(snapshot);

    expect(defenseCommands(snapshot)).toEqual(threatened ? defendAt(1600, 1000) : []);
    expect(snapshot).toEqual(before);
  });

  it.each(["farm", "townHall"] as const)("keeps stable ties while preferring a pressured %s", secondKind => {
    const game = defenseScene(`building-pressure-tie-${secondKind}`)
      .building("defender", "farm", 1600, 1000, { id: "protected-a", hp: 100 })
      .building("defender", secondKind, 1600, 2000, { id: "protected-b", hp: 100 })
      .unit("invader", "catapult", 2350, 1000, { order: { type: "attack", targetId: "protected-a" } })
      .unit("invader", "catapult", 2350, 2000, { order: { type: "attackMove", x: 1600, y: 2000, targetId: "protected-b" } })
      .build().createGame();

    expect(defenseCommands(snapshotGame(game))).toEqual(defendAt(1600, secondKind === "townHall" ? 2000 : 1000));
  });

  it("keeps pressure accumulated by duplicate building ids", () => {
    const game = defenseScene("building-pressure-duplicate-id")
      .building("defender", "farm", 1600, 1000, { id: "protected-a" })
      .building("defender", "farm", 1600, 2000, { id: "protected-b" })
      .unit("invader", "catapult", 2350, 1000, { order: { type: "attack", targetId: "shared-protected" } })
      .unit("invader", "catapult", 2350, 2000, { order: { type: "attack", targetId: "shared-protected" } })
      .unit("invader", "footman", 1900, 1000)
      .build().createGame();
    game.buildings.find(building => building.id === "protected-a")!.id = "shared-protected";
    game.buildings.find(building => building.id === "protected-b")!.id = "shared-protected";
    const snapshot = snapshotGame(game);
    const before = structuredClone(snapshot);

    expect(snapshot.buildings.filter(building => building.id === "shared-protected")).toHaveLength(2);
    expect(defenseCommands(snapshot)).toEqual(defendAt(1600, 1000));
    expect(snapshot).toEqual(before);
  });

  it("rechecks teams and siege movement on the next planning frame", () => {
    const game = defenseScene("building-pressure-fresh-frame")
      .player("ally", { team: "north", race: "grove" })
      .townHall("ally", 3100, 400)
      .building("defender", "farm", 1600, 1000, { id: "own-farm", hp: 100 })
      .building("ally", "farm", 1600, 2000, { id: "allied-farm", hp: 100 })
      .unit("invader", "catapult", 2350, 2000, { id: "allied-siege", order: { type: "attack", targetId: "allied-farm" } })
      .unit("invader", "catapult", 2500, 1000, { id: "own-siege", order: { type: "attack", targetId: "own-farm" } })
      .build().createGame();
    const original = snapshotGame(game);
    const changedTeams = structuredClone(original);
    changedTeams.teams = { ...original.teams, ally: "south" };
    const approachingSiege = structuredClone(changedTeams);
    approachingSiege.units.find(unit => unit.id === "own-siege")!.x = 2350;

    expect(defenseCommands(original)).toEqual(defendAt(1600, 2000));
    expect(defenseCommands(changedTeams)).toEqual([]);
    expect(defenseCommands(approachingSiege)).toEqual(defendAt(1600, 1000));
    expect(defenseCommands(original)).toEqual(defendAt(1600, 2000));
  });
});
