import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { snapshotGame } from "../../shared/sim";
import { AI_SCRIPT_LIBRARY, planAiCommandsFromScripts } from "../policy";

describe("main defense target priority", () => {
  it("keeps equal-score targets stable and rechecks wounded attackers on a fresh snapshot", () => {
    const game = sketchScene("main-defense-stable-priority")
      .map("openClaims")
      .replaceDefaults()
      .player("defender", { team: "north", race: "grove" })
      .player("invader", { team: "south", race: "grove" })
      .player("support", { team: "south", race: "grove" })
      .townHall("defender", 500, 500)
      .tower("defender", 650, 620)
      .unit("defender", "archer", 640, 590, { id: "defender-a" })
      .unit("defender", "archer", 670, 620, { id: "defender-b" })
      .unit("defender", "archer", 700, 650, { id: "defender-c" })
      .townHall("invader", 3300, 3300)
      .townHall("support", 3300, 3700)
      .unit("invader", "footman", 730, 650, { id: "first-attacker" })
      .unit("invader", "footman", 730, 650, { id: "second-attacker" })
      .unit("support", "footman", 730, 650, { id: "third-attacker" })
      .build().createGame();
    const snapshot = snapshotGame(game);
    const before = structuredClone(snapshot);
    const options = { version: "v2" as const, teams: game.teams };
    const scripts = [AI_SCRIPT_LIBRARY.attackWave];
    const unitIds = ["defender-a", "defender-b", "defender-c"];

    expect(planAiCommandsFromScripts(snapshot, "defender", scripts, options)).toEqual([
      { type: "attack", unitIds, targetId: "first-attacker" },
    ]);
    expect(snapshot).toEqual(before);

    game.units.find(unit => unit.id === "second-attacker")!.hp = 10;
    expect(planAiCommandsFromScripts(snapshotGame(game), "defender", scripts, options)).toEqual([
      { type: "attack", unitIds, targetId: "second-attacker" },
    ]);
    expect(planAiCommandsFromScripts(snapshot, "defender", scripts, options)).toEqual([
      { type: "attack", unitIds, targetId: "first-attacker" },
    ]);
  });

  it.each(["v1", "v2"] as const)("keeps the %s worker defense target and worker command order stable", version => {
    const game = sketchScene(`worker-defense-stable-priority-${version}`)
      .map("openClaims")
      .replaceDefaults()
      .player("defender", { team: "north", race: "grove" })
      .player("invader", { team: "south", race: "grove" })
      .townHall("defender", 500, 500, { id: "defender-main" })
      .worker("defender", 520, 540, { id: "worker-a" })
      .worker("defender", 540, 520, { id: "worker-b" })
      .townHall("invader", 3300, 3300)
      .unit("invader", "footman", 730, 650, { id: "first-attacker" })
      .unit("invader", "footman", 730, 650, { id: "second-attacker" })
      .unit("invader", "footman", 730, 650, { id: "third-attacker" })
      .build().createGame();
    if (version === "v2") game.buildings.find(building => building.id === "defender-main")!.hp = 100;
    const snapshot = snapshotGame(game);
    const before = structuredClone(snapshot);
    const options = { version, teams: game.teams };
    const scripts = [AI_SCRIPT_LIBRARY.workerDefense];
    const unitIds = ["worker-a", "worker-b"];

    expect(planAiCommandsFromScripts(snapshot, "defender", scripts, options)).toEqual([
      { type: "attack", unitIds, targetId: "first-attacker" },
    ]);
    expect(snapshot).toEqual(before);

    game.units.find(unit => unit.id === "third-attacker")!.hp = 10;
    expect(planAiCommandsFromScripts(snapshotGame(game), "defender", scripts, options)).toEqual([
      { type: "attack", unitIds, targetId: "third-attacker" },
    ]);
  });
});
