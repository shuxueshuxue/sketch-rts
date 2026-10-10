import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import { issuePlayerCommand, snapshotGame } from "../../shared/sim";
import type { RaceId, TrainableUnitKind } from "../../shared/types";
import { AI_SCRIPT_LIBRARY, createAiPolicyMemory, planAiCommandsFromScripts } from "../policy";
import { engineeringWant } from "./engineering";
import { distance } from "./spatial";

function engineeringScene(race: RaceId) {
  const scene = sketchScene("support-weapon-query-guards")
    .map("openClaims")
    .replaceDefaults()
    .player("us", { race, team: "north" })
    .player("foe", { race: "ember", team: "south" })
    .playerState("us", { gold: 5_000 })
    .townHall("us", 500, 500)
    .farmsPastTiers("us", 600, 1_200)
    .worker("us", 650, 650, { id: "builder" })
    .townHall("foe", 3_300, 3_300);
  for (let index = 0; index < 12; index++) {
    scene.unit("us", race === "grove" ? "footman" : "cinderRunner", 1_000 + index * 25, 900);
  }
  return scene;
}

describe("support weapons after workshop readiness", () => {
  it.each(["grove", "ember"] as const)("keeps the %s workshop build command before choosing a weapon", race => {
    const game = engineeringScene(race)
      .tower("foe", 2_800, 2_800)
      .tower("foe", 2_900, 2_800)
      .build().createGame();
    const snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const memory = createAiPolicyMemory(), beforeMemory = structuredClone(memory);
    const want = engineeringWant(snapshot, "us", { version: "v2", teams: game.teams, memory });
    expect(want).toMatchObject({ id: "engineering:workshop", cost: BUILDING_DEFS.workshop.cost });
    const used = new Set<string>();
    expect(want?.issue(used)).toMatchObject({ type: "build", unitId: "builder", buildingKind: "workshop" });
    expect([...used]).toEqual(["builder"]);
    expect(want?.issue(used)).toBeUndefined();
    expect(snapshot).toEqual(before);
    expect(memory).toEqual(beforeMemory);
  });

  it.each(["grove", "ember"] as const)("waits for an incomplete or occupied %s workshop", race => {
    const game = engineeringScene(race).building("us", "workshop", 700, 850, { id: "workshop", complete: false }).build().createGame();
    const options = { version: "v2" as const, teams: game.teams, memory: createAiPolicyMemory() };
    expect(engineeringWant(snapshotGame(game), "us", options)).toBeUndefined();
    game.buildings.find(building => building.id === "workshop")!.complete = true;
    const firstKind = race === "grove" ? "ballista" : "siegeRam";
    issuePlayerCommand(game, "us", { type: "train", buildingId: "workshop", unitKind: firstKind });
    expect(game.buildings.find(building => building.id === "workshop")!.queue.map(job => job.unitKind)).toEqual([firstKind]);
    // Twelve permanent soldiers allow two support weapons; the queue itself
    // stops this plan, rather than the earlier weapon-share limit.
    expect(engineeringWant(snapshotGame(game), "us", options)).toBeUndefined();
  });

  it.each([
    { race: "grove", towers: 2, ranged: 4, melee: 0, kind: "ballista" },
    { race: "ember", towers: 2, ranged: 4, melee: 0, kind: "catapult" },
    { race: "ember", towers: 0, ranged: 4, melee: 0, kind: "organGun" },
    { race: "ember", towers: 0, ranged: 0, melee: 12, kind: "organGun" },
    { race: "ember", towers: 0, ranged: 3, melee: 0, kind: "siegeRam" },
  ] as const)("trains $kind for $race against $towers towers and $ranged ranged/$melee melee enemies", ({ race, towers, ranged, melee, kind }) => {
    const scene = engineeringScene(race).building("us", "workshop", 700, 850, { id: "workshop" });
    for (let index = 0; index < towers; index++) scene.tower("foe", 2_800 + index * 100, 2_800);
    for (let index = 0; index < ranged; index++) scene.unit("foe", "sparkArcher", 2_700 + index * 30, 2_700);
    for (let index = 0; index < melee; index++) scene.unit("foe", "cinderRunner", 2_700 + index * 30, 2_600);
    const game = scene.build().createGame(), snapshot = snapshotGame(game);
    const before = structuredClone(snapshot), memory = createAiPolicyMemory(), beforeMemory = structuredClone(memory);
    const want = engineeringWant(snapshot, "us", { version: "v2", teams: game.teams, memory });
    expect(want).toMatchObject({ id: `engineering:${kind}`, cost: UNIT_DEFS[kind].cost });
    const command = want?.issue(new Set());
    expect(command).toEqual({ type: "train", buildingId: "workshop", unitKind: kind });
    expect(snapshot).toEqual(before);
    expect(memory).toEqual(beforeMemory);
    issuePlayerCommand(game, "us", command!);
    expect(game.buildings.find(building => building.id === "workshop")!.queue.map(job => job.unitKind)).toEqual([kind]);
    expect(game.players.us!.gold).toBe(5_000 - UNIT_DEFS[kind].cost);
  });

  it("ignores allied towers and archers when selecting the ember weapon", () => {
    const scene = engineeringScene("ember")
      .player("ally", { race: "ember", team: "north" })
      .building("us", "workshop", 700, 850, { id: "workshop" })
      .tower("ally", 1_700, 1_700).tower("ally", 1_800, 1_700);
    for (let index = 0; index < 4; index++) scene.unit("ally", "sparkArcher", 1_600 + index * 30, 1_600);
    const game = scene.build().createGame();
    expect(engineeringWant(snapshotGame(game), "us", { version: "v2", teams: game.teams, memory: createAiPolicyMemory() })?.issue(new Set())).toEqual({
      type: "train", buildingId: "workshop", unitKind: "siegeRam" satisfies TrainableUnitKind,
    });
  });
});

describe("neutral-free objective planning", () => {
  it("keeps orders and claims intact, then plans the next snapshot's newly guarded camp", () => {
    const scene = sketchScene("new-neutral-objective")
      .map("openClaims").replaceDefaults()
      .player("us", { race: "grove", team: "north" })
      .player("foe", { race: "ember", team: "south" })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .worker("us", 650, 650, { id: "retreating-worker", order: { type: "move", x: 200, y: 200 } })
      .mercenaryCamp("camp", 1_200, 900);
    const ids = ["a", "b", "c", "d", "e"];
    ids.forEach((id, index) => scene.unit("us", "footman", 700 + index * 25, 700, { id }));
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.unitClaims["retreating-worker"] = {
      kind: "retreat", targetId: "retreat", x: 200, y: 200, sinceTick: 0, expiresTick: 900,
    };
    const options = { version: "v2" as const, teams: game.teams, memory };
    const emptySnapshot = snapshotGame(game), before = structuredClone(emptySnapshot), beforeMemory = structuredClone(memory);
    expect(planAiCommandsFromScripts(emptySnapshot, "us", [AI_SCRIPT_LIBRARY.objectiveControl], options)).toEqual([]);
    expect(emptySnapshot).toEqual(before);
    expect(memory).toEqual(beforeMemory);

    game.spawnUnit("neutral", "wildling", 1_200, 900);
    const guardedSnapshot = snapshotGame(game), guardedBefore = structuredClone(guardedSnapshot);
    const commands = planAiCommandsFromScripts(guardedSnapshot, "us", [AI_SCRIPT_LIBRARY.objectiveControl], options);
    expect(commands).toEqual([{ type: "attackMove", unitIds: ids, x: 1_200, y: 900 }]);
    for (const id of ids) expect(memory.unitClaims[id]).toMatchObject({ kind: "mercenary", targetId: "camp", sinceTick: game.tick });
    expect(memory.unitClaims["retreating-worker"]).toEqual(beforeMemory.unitClaims["retreating-worker"]);
    expect(guardedSnapshot).toEqual(guardedBefore);
    issuePlayerCommand(game, "us", commands[0]!);
    for (const id of ids) expect(game.units.find(unit => unit.id === id)!.order).toMatchObject({ type: "attackMove", x: 1_200, y: 900 });
  });

  it("still releases an unsafe cleared-camp claim even when the squad needs no rally move", () => {
    const scene = sketchScene("cleared-camp-claim-release")
      .map("openClaims").replaceDefaults()
      .player("us", { race: "grove", team: "north" })
      .player("foe", { race: "grove", team: "south" })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .mercenaryCamp("cleared-camp", 2_500, 500);
    const ids = ["claimed-a", "claimed-b", "claimed-c"];
    ids.forEach((id, index) => scene.unit("us", "footman", 510 + index * 20, 500, { id }));
    for (let index = 0; index < 5; index++) scene.unit("foe", "footman", 2_450 + index * 20, 500);
    const game = scene.build().createGame(), snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const memory = createAiPolicyMemory();
    for (const id of ids) memory.unitClaims[id] = {
      kind: "mercenary", targetId: "cleared-camp", x: 2_500, y: 500, sinceTick: 0, expiresTick: 900,
    };
    expect(planAiCommandsFromScripts(snapshot, "us", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory })).toEqual([]);
    expect(memory.unitClaims).toEqual({});
    expect(snapshot).toEqual(before);
    expect(game.units.filter(unit => unit.owner === "us").every(unit => unit.order.type === "idle")).toBe(true);
  });

  it("still recalls wounded natural claimants into the well after all neutrals disappear", () => {
    const game = sketchScene("neutral-free-natural-healing-recall")
      .map("openClaims").replaceDefaults()
      .player("us", { race: "grove", team: "north" })
      .player("foe", { race: "grove", team: "south" })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .building("us", "moonWell", 420, 620, { id: "well" })
      .goldMine("main-mine", 560, 540, 4_000)
      .goldMine("cleared-natural", 1_080, 660, 4_000)
      .goldMine("foe-mine", 3_300, 3_240, 4_000)
      .unit("us", "footman", 1_040, 650, { id: "wounded-a", hpRatio: 0.6 })
      .unit("us", "lancer", 1_080, 680, { id: "wounded-b", hpRatio: 0.6 })
      .unit("us", "footman", 1_120, 650, { id: "healthy" })
      .unit("us", "archer", 1_160, 690)
      .build().createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "cleared-natural", expansionClaimTick: 0 };
    for (const id of ["wounded-a", "wounded-b", "healthy"]) memory.unitClaims[id] = {
      kind: "expansion", targetId: "cleared-natural", x: 1_080, y: 660, sinceTick: 0, expiresTick: 3_600,
    };
    const snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const commands = planAiCommandsFromScripts(snapshot, "us", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory });
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toMatchObject({ type: "move", unitIds: ["wounded-a", "wounded-b"] });
    if (command?.type !== "move") throw new Error("Expected a natural recovery move");
    expect(distance(command, { x: 420, y: 620 })).toBeLessThanOrEqual(BUILDING_DEFS.moonWell.attackRange);
    expect(memory.unitClaims.healthy).toMatchObject({ kind: "expansion", targetId: "cleared-natural" });
    for (const id of ["wounded-a", "wounded-b"]) expect(memory.unitClaims[id]).toMatchObject({ kind: "retreat", targetId: "retreat" });
    expect(snapshot).toEqual(before);
    issuePlayerCommand(game, "us", command);
    for (const id of ["wounded-a", "wounded-b"]) expect(game.units.find(unit => unit.id === id)!.order).toMatchObject({ type: "move", x: command.x, y: command.y });
  });
});
