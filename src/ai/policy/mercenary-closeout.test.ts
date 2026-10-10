import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { snapshotGame } from "../../shared/sim";
import { AI_SCRIPT_LIBRARY, createAiPolicyMemory, createAiTelemetry, planAiCommandsFromScripts } from "../policy";

function campCloseoutScene(defenders = 4) {
  const scene = sketchScene("mercenary-team-closeout")
    .map("openClaims")
    .replaceDefaults()
    .player("winner", { team: "north", race: "grove" })
    .player("loser", { team: "south", race: "grove" })
    .player("support", { team: "south", race: "grove" })
    .townHall("winner", 500, 500)
    .farms("winner", 5, 650, 500)
    .townHall("loser", 3400, 1450)
    .building("loser", "farm", 3300, 1340)
    .building("loser", "barracks", 3300, 1540)
    .townHall("support", 3400, 2800)
    .building("support", "farm", 3300, 2690)
    .building("support", "barracks", 3300, 2890)
    .mercenaryCamp("cleared-contract-post", 1860, 1760, {
      hireKind: "contractArcher", cost: 140, stock: 2, cooldownRemaining: 0,
    });
  for (let index = 0; index < 7; index++) scene.unit("winner", "footman", 1800 + index * 20, 1700 + index * 10);
  for (let index = 0; index < defenders; index++) {
    const owner = index < 2 ? "loser" : "support";
    scene.unit(owner, "footman", 3100 + index * 20, owner === "loser" ? 1450 : 2800);
  }
  return scene.build().createGame();
}

function mercenaryCommands(game: ReturnType<typeof campCloseoutScene>) {
  return planAiCommandsFromScripts(snapshotGame(game), "winner", [AI_SCRIPT_LIBRARY.mercenary], {
    version: "v2", teams: game.teams,
  });
}

describe("mercenary and team closeout objectives", () => {
  it("leaves orders, army claims and telemetry unchanged when the map has no camps", () => {
    const game = campCloseoutScene();
    game.mercenaryCamps = [];
    const snapshot = snapshotGame(game);
    const originalSnapshot = structuredClone(snapshot);
    const memory = createAiPolicyMemory();
    const originalMemory = structuredClone(memory);
    const telemetry = createAiTelemetry();
    const originalTelemetry = structuredClone(telemetry);

    expect(AI_SCRIPT_LIBRARY.mercenary.run(snapshot, "winner", {
      version: "v2", teams: game.teams, memory, telemetry,
    })).toBeUndefined();
    expect(snapshot).toEqual(originalSnapshot);
    expect(memory).toEqual(originalMemory);
    expect(telemetry).toEqual(originalTelemetry);
  });

  it("keeps a seven-unit army on closeout when two allied opponents have four defenders combined", () => {
    const game = campCloseoutScene(4);
    expect(game.units.filter(unit => unit.owner === "loser")).toHaveLength(2);
    expect(game.units.filter(unit => unit.owner === "support")).toHaveLength(2);
    expect(mercenaryCommands(game)).toEqual([]);
  });

  it("allows a controlled camp hire when allied opponents have five defenders combined", () => {
    const game = campCloseoutScene(5);
    expect(game.units.filter(unit => unit.owner === "loser")).toHaveLength(2);
    expect(game.units.filter(unit => unit.owner === "support")).toHaveLength(3);
    expect(mercenaryCommands(game)).toEqual([{ type: "hire", campId: "cleared-contract-post" }]);
  });

  it("rechecks team strength on the next snapshot after an opponent receives reinforcements", () => {
    const game = campCloseoutScene(4);
    expect(mercenaryCommands(game)).toEqual([]);
    game.spawnUnit("support", "footman", 3220, 2800);
    expect(mercenaryCommands(game)).toEqual([{ type: "hire", campId: "cleared-contract-post" }]);
  });
});
