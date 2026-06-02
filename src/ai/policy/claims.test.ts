import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory } from "../memory";
import { pruneAiPolicyMemory, recordAiMemoryForCommands } from "./claims";

describe("AI policy command memory claims", () => {
  it("records builder ownership for high-level build tasks", () => {
    const game = sketchScene("build-claim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .worker("v2", 540, 520, { id: "builder" })
      .build()
      .createGame();
    const memory = createAiPolicyMemory();

    recordAiMemoryForCommands(snapshotGame(game), "productionBuilding", [{ type: "build", unitId: "builder", buildingKind: "barracks", x: 640, y: 520 }], memory);

    expect(memory.unitClaims.builder).toMatchObject({
      kind: "build",
      targetId: "build:barracks:640:520",
      x: 640,
      y: 520,
      sinceTick: 0,
    });
    expect(memory.unitClaims.builder?.expiresTick).toBeGreaterThan(0);
  });

  it("clears builder claims once the target building is complete", () => {
    const game = sketchScene("build-claim-complete")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 640, 520, { complete: true })
      .worker("v2", 540, 520, { id: "builder" })
      .build()
      .createGame();
    game.tick = 45;
    const memory = createAiPolicyMemory();
    memory.unitClaims.builder = { kind: "build", targetId: "build:barracks:640:520", x: 640, y: 520, sinceTick: 0, expiresTick: 900 };

    pruneAiPolicyMemory(snapshotGame(game), "v2", memory);

    expect(memory.unitClaims.builder).toBeUndefined();
  });

  it("records attack-wave target ownership as a long-running memory job", () => {
    const game = sketchScene("attack-wave-job-memory")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 620, 540, { id: "wave-footman" })
      .townHall("v1a", 1200, 520, { id: "v1a-main" })
      .build()
      .createGame();
    const memory = createAiPolicyMemory();

    recordAiMemoryForCommands(snapshotGame(game), "attackWave", [{ type: "attackMove", unitIds: ["wave-footman"], x: 1200, y: 520 }], memory, {
      owner: "v2",
      teams: game.teams,
    });
    game.tick = 45;
    recordAiMemoryForCommands(snapshotGame(game), "attackWave", [{ type: "attackMove", unitIds: ["wave-footman"], x: 1200, y: 520 }], memory, {
      owner: "v2",
      teams: game.teams,
    });

    expect(memory.strategicPlan).toMatchObject({
      focusTargetOwner: "v1a",
      focusTargetSinceTick: 0,
      focusTargetUpdatedTick: 45,
    });
    expect(memory.jobs).toEqual([{ id: "attackWave:v1a", kind: "attackWave", createdTick: 0, updatedTick: 45 }]);
    expect(memory.unitClaims["wave-footman"]).toMatchObject({
      kind: "attack",
      targetId: "v1a-main",
      x: 1200,
      y: 520,
      sinceTick: 45,
    });
  });
});
