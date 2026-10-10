import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { snapshotGame } from "../../shared/sim";
import { createAiPolicyMemory } from "../memory";
import { AI_SCRIPT_LIBRARY } from "../policy";

describe("attack wave readiness and immediate defense", () => {
  it("keeps a main farm break-in ahead of the field army's retreat claims", () => {
    const scene = sketchScene("claimed-army-main-farm-break-in")
      .map("openClaims")
      .replaceDefaults()
      .player("defender", { team: "north", race: "grove" })
      .player("invader", { team: "south", race: "grove" })
      .townHall("defender", 500, 500)
      .building("defender", "farm", 900, 500, { id: "protected-farm" })
      .townHall("invader", 3300, 3300)
      .unit("invader", "archer", 1250, 500, { order: { type: "attack", targetId: "protected-farm" } })
      .unit("invader", "archer", 1250, 540, { order: { type: "attack", targetId: "protected-farm" } })
      .unit("invader", "footman", 1200, 540);
    const unitIds = ["defender-a", "defender-b", "defender-c", "defender-d", "defender-e"];
    unitIds.forEach((id, index) => scene.unit("defender", "footman", 600 + index * 20, 500, { id }));
    const snapshot = snapshotGame(scene.build().createGame());
    const memory = createAiPolicyMemory();
    for (const id of unitIds) memory.unitClaims[id] = {
      kind: "retreat", targetId: "retreat", x: 200, y: 200, sinceTick: 0, expiresTick: 900,
    };
    const beforeSnapshot = structuredClone(snapshot);
    const beforeMemory = structuredClone(memory);

    expect(AI_SCRIPT_LIBRARY.attackWave.run(snapshot, "defender", {
      version: "v2", ...(snapshot.teams ? { teams: snapshot.teams } : {}), memory,
    })).toEqual({ type: "attackMove", unitIds, x: 900, y: 500 });
    expect(snapshot).toEqual(beforeSnapshot);
    expect(memory).toEqual(beforeMemory);
  });

  it("still filters retreaters and critical wounds in the combat-only wave", () => {
    const game = sketchScene("combat-wave-readiness")
      .map("openClaims")
      .replaceDefaults()
      .player("defender", { team: "north", race: "grove" })
      .player("invader", { team: "south", race: "grove" })
      .townHall("defender", 500, 500)
      .townHall("invader", 3300, 3300)
      .unit("defender", "footman", 800, 800, { id: "ready-a" })
      .unit("defender", "footman", 800, 820, { id: "retreater" })
      .unit("defender", "footman", 800, 840, { id: "critical", hp: 1 })
      .unit("defender", "footman", 800, 860, { id: "ready-b" })
      .unit("invader", "footman", 1000, 800)
      .unit("invader", "footman", 1000, 840)
      .build().createGame();
    const snapshot = snapshotGame(game);
    const memory = createAiPolicyMemory();
    memory.unitClaims.retreater = {
      kind: "retreat", targetId: "retreat", x: 200, y: 200, sinceTick: 0, expiresTick: 900,
    };
    const beforeSnapshot = structuredClone(snapshot);
    const beforeMemory = structuredClone(memory);

    expect(AI_SCRIPT_LIBRARY.attackWave.run(snapshot, "defender", {
      version: "v2", policyMode: "combat", ...(snapshot.teams ? { teams: snapshot.teams } : {}), memory,
    })).toEqual({ type: "attackMove", unitIds: ["ready-a", "ready-b"], x: 1000, y: 820 });
    expect(snapshot).toEqual(beforeSnapshot);
    expect(memory).toEqual(beforeMemory);
  });
});
