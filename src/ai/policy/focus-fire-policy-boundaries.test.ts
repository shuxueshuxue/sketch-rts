import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { canReach } from "../../shared/naval";
import { snapshotGame } from "../../shared/sim";
import { createAiPolicyMemory } from "../memory";
import { planFocusFireCommand } from "./spell-tactics";
import type { PresetAiPolicyOptions } from "./types";

function nearbyFighters(extraFighter = false) {
  const scene = sketchScene("focus-fire-policy-boundary").map("bareDuel").replaceDefaults()
    .player("us", { team: "north" }).player("foe", { team: "south" })
    .townHall("us", 500, 500)
    .unit("us", "footman", 770, 1000, { id: "first" })
    .unit("us", "footman", 780, 1030, { id: "second" })
    .unit("foe", "lancer", 900, 1000, { id: "target", hp: 20 });
  if (extraFighter) scene.unit("us", "footman", 790, 1000, { id: "claimed" });
  return scene.build().createGame();
}

function arrivedCampSquad() {
  const game = sketchScene("focus-fire-arrived-camp-boundary").map("openClaims").replaceDefaults()
    .player("us", { team: "north" }).player("foe", { team: "south" })
    .goldMine("main-mine", 500, 500, 4000).goldMine("natural-mine", 900, 500, 4000)
    .townHall("us", 500, 500).townHall("us", 900, 500).townHall("foe", 3300, 3300)
    .unit("us", "footman", 1100, 1000, { id: "first", order: { type: "attackMove", x: 1100, y: 1000 } })
    .unit("us", "footman", 1120, 1020, { id: "second", order: { type: "attackMove", x: 1100, y: 1000 } })
    .unit("foe", "contractArcher", 1700, 1000, { id: "target", order: { type: "attack", targetId: "first" } })
    .mercenaryCamp("camp", 1100, 1000, { hireKind: "contractArcher", cost: 160, stock: 1, cooldownRemaining: 0 })
    .build().createGame();
  const memory = createAiPolicyMemory();
  for (const id of ["first", "second"]) memory.unitClaims[id] = {
    kind: "mercenary", targetId: "camp", x: 1100, y: 1000, sinceTick: 0, expiresTick: 900,
  };
  return { game, memory };
}

describe("focus fire policy and claim boundaries", () => {
  for (const requestedVersion of [undefined, "v2", "v3", "v4-tr"] as const) {
    it(`keeps ordinary joining and target memory for requested ${requestedVersion ?? "default"}`, () => {
      const game = nearbyFighters();
      const memory = createAiPolicyMemory();
      expect(planFocusFireCommand(snapshotGame(game), "us", { version: "v2", ...(requestedVersion === undefined ? {} : { requestedVersion }), teams: game.teams, memory })).toEqual({
        type: "attack", unitIds: ["first", "second"], targetId: "target",
      });
      expect(memory.strategicPlan).toEqual({ focusTargetOwner: "foe", focusTargetId: "target", focusTargetSinceTick: 0, focusTargetUpdatedTick: 0 });
    });
  }

  for (const requestedVersion of [undefined, "v3", "v6"] as const) {
    it(`preserves the original across-water range decision for requested ${requestedVersion ?? "default"}`, () => {
      const game = nearbyFighters();
      game.map = { ...game.map, width: 4096, height: 4096, terrain: {
        cell: 32, cols: 128, rows: 128, cells: (".".repeat(25) + "~~" + ".".repeat(101)).repeat(128),
      } };
      const snapshot = snapshotGame(game);
      const target = snapshot.units.find(unit => unit.id === "target")!;
      for (const id of ["first", "second"]) expect(canReach(snapshot.map, snapshot.units.find(unit => unit.id === id)!, target)).toBe(false);
      expect(planFocusFireCommand(snapshot, "us", { version: "v2", ...(requestedVersion === undefined ? {} : { requestedVersion }), teams: game.teams })).toEqual(
        requestedVersion === "v6" ? undefined : { type: "attack", unitIds: ["first", "second"], targetId: "target" },
      );
    });
  }

  for (const requestedVersion of ["v5", "v6", "v7", "v8", "v9"] as const) {
    it(`keeps the stricter ordinary melee join for requested ${requestedVersion}`, () => {
      const game = nearbyFighters();
      expect(planFocusFireCommand(snapshotGame(game), "us", { version: "v2", requestedVersion, teams: game.teams })).toBeUndefined();
    });

    it(`lets requested ${requestedVersion} counterfire beyond ordinary joining for a claimed arrived camp`, () => {
      const { game, memory } = arrivedCampSquad();
      const claims = structuredClone(memory.unitClaims);
      expect(planFocusFireCommand(snapshotGame(game), "us", { version: "v2", requestedVersion, teams: game.teams, memory })).toEqual({
        type: "attack", unitIds: ["first", "second"], targetId: "target",
      });
      expect(memory.unitClaims).toEqual(claims);
    });
  }

  for (const requestedVersion of [undefined, "v2", "v3"] as const) {
    it(`keeps camp ownership out of ordinary requested ${requestedVersion ?? "default"} focus`, () => {
      const { game, memory } = arrivedCampSquad();
      const before = structuredClone(memory);
      expect(planFocusFireCommand(snapshotGame(game), "us", { version: "v2", ...(requestedVersion === undefined ? {} : { requestedVersion }), teams: game.teams, memory })).toBeUndefined();
      expect(memory).toEqual(before);
    });
  }

  for (const options of [{ version: "v3" }, { version: "v6" }, { version: "v3", requestedVersion: "v6" }] as const satisfies readonly PresetAiPolicyOptions[]) {
    it(`does not enable this planner for version ${options.version} requested ${"requestedVersion" in options ? options.requestedVersion : "default"}`, () => {
      const game = nearbyFighters();
      const memory = createAiPolicyMemory();
      expect(planFocusFireCommand(snapshotGame(game), "us", { ...options, teams: game.teams, memory })).toBeUndefined();
      expect(memory.strategicPlan).toBeUndefined();
    });
  }

  it("keeps a retreat claim through its last tick and releases the fighter after expiry", () => {
    const game = nearbyFighters(true);
    const memory = createAiPolicyMemory();
    memory.unitClaims.claimed = { kind: "retreat", targetId: "retreat", x: 500, y: 500, sinceTick: 0, expiresTick: 0 };
    const options: PresetAiPolicyOptions = { version: "v2", requestedVersion: "v3", teams: game.teams, memory };
    expect(planFocusFireCommand(snapshotGame(game), "us", options)).toEqual({ type: "attack", unitIds: ["first", "second"], targetId: "target" });
    game.tick = 1;
    expect(planFocusFireCommand(snapshotGame(game), "us", options)).toEqual({ type: "attack", unitIds: ["first", "second", "claimed"], targetId: "target" });
    expect(memory.unitClaims.claimed).toMatchObject({ kind: "retreat", expiresTick: 0 });
  });

  it("keeps an attack-claimed fighter eligible for ordinary focus", () => {
    const game = nearbyFighters(true);
    const memory = createAiPolicyMemory();
    memory.unitClaims.claimed = { kind: "attack", targetId: "target", x: 900, y: 1000, sinceTick: 0, expiresTick: 900 };
    expect(planFocusFireCommand(snapshotGame(game), "us", { version: "v2", teams: game.teams, memory })).toEqual({
      type: "attack", unitIds: ["first", "second", "claimed"], targetId: "target",
    });
  });
});
