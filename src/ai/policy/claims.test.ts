import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
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

  it("keeps objective claims alive long enough for distant camp walks", () => {
    const game = sketchScene("long-objective-claim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 620, 540, { id: "claim-footman" })
      .unit("neutral", "wildling", 1420, 1120, { id: "distant-guard" })
      .build()
      .createGame();
    const memory = createAiPolicyMemory();

    recordAiMemoryForCommands(snapshotGame(game), "objectiveControl", [{ type: "attackMove", unitIds: ["claim-footman"], x: 1420, y: 1120 }], memory);

    expect(memory.unitClaims["claim-footman"]).toMatchObject({ kind: "creep", targetId: "distant-guard", sinceTick: 0 });
    expect(memory.unitClaims["claim-footman"]?.expiresTick).toBeGreaterThanOrEqual(120 * SIM_TICKS_PER_SECOND);
  });

  it("records guarded mercenary camp objectives as camp claims instead of disposable guard claims", () => {
    const game = sketchScene("guarded-merc-camp-claim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 620, 540, { id: "claim-footman" })
      .unit("neutral", "wildling", 1180, 990, { id: "camp-guard" })
      .mercenaryCamp("guarded-camp", 1160, 980)
      .build()
      .createGame();
    const memory = createAiPolicyMemory();

    recordAiMemoryForCommands(snapshotGame(game), "objectiveControl", [{ type: "attackMove", unitIds: ["claim-footman"], x: 1160, y: 980 }], memory);

    expect(memory.unitClaims["claim-footman"]).toMatchObject({
      kind: "mercenary",
      targetId: "guarded-camp",
      x: 1160,
      y: 980,
    });
  });

  it("clears expansion army claims once the claimed mine has an owned town hall", () => {
    const game = sketchScene("expansion-claim-complete")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .goldMine("natural-mine", 760, 760, 5000)
      .townHall("v2", 740, 740, { id: "natural-hall" })
      .unit("v2", "footman", 760, 820, { id: "claim-footman" })
      .build()
      .createGame();
    game.tick = 420;
    const memory = createAiPolicyMemory();
    memory.unitClaims["claim-footman"] = { kind: "expansion", targetId: "natural-mine", x: 760, y: 760, sinceTick: 0, expiresTick: 3600 };
    memory.strategicPlan = { expansionClaimTargetId: "natural-mine", expansionClaimTick: 0 };

    pruneAiPolicyMemory(snapshotGame(game), "v2", memory);

    expect(memory.unitClaims["claim-footman"]).toBeUndefined();
    expect(memory.strategicPlan?.expansionClaimTargetId).toBeUndefined();
  });

  it("clears abandoned objective claims when the unit has stopped far from the claim point", () => {
    const game = sketchScene("abandoned-expansion-claim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .goldMine("natural-mine", 760, 760, 5000)
      .unit("v2", "footman", 520, 500, { id: "claim-footman", order: { type: "idle" } })
      .build()
      .createGame();
    game.tick = 420;
    const memory = createAiPolicyMemory();
    memory.unitClaims["claim-footman"] = { kind: "expansion", targetId: "natural-mine", x: 760, y: 760, sinceTick: 0, expiresTick: 3600 };

    pruneAiPolicyMemory(snapshotGame(game), "v2", memory);

    expect(memory.unitClaims["claim-footman"]).toBeUndefined();
  });

  it("remembers the expansion target after assigning a squad to clear a natural", () => {
    const game = sketchScene("expansion-strategic-claim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .goldMine("natural-mine", 760, 760, 5000)
      .unit("v2", "footman", 520, 500, { id: "claim-footman" })
      .build()
      .createGame();
    const memory = createAiPolicyMemory();

    recordAiMemoryForCommands(snapshotGame(game), "expansion", [{ type: "attackMove", unitIds: ["claim-footman"], x: 760, y: 760 }], memory, { owner: "v2" });

    expect(memory.strategicPlan).toMatchObject({ expansionClaimTargetId: "natural-mine", expansionClaimTick: 0 });
  });

});
