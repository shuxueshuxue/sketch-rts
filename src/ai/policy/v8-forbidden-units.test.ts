import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import type { BuildingKind } from "../../shared/types";
import { createAiPolicyMemory } from "../memory";
import { planV6Economy } from "./v6/economy";
import { V8_STRATEGIES } from "./v8/doctrine";
import { SHOOTER_UNIT_KINDS, SUMMONING_UNIT_KINDS, V8_FORBIDDEN_UNIT_KINDS } from "./versions";

describe("v8 fields no shooter and no summoner", () => {
  it("forbids the shooters and the summoning kinds read from the catalog", () => {
    expect(SUMMONING_UNIT_KINDS).toEqual(new Set(["summoner", "pyreCaller"]));
    expect(V8_FORBIDDEN_UNIT_KINDS).toEqual(new Set([...SHOOTER_UNIT_KINDS, "summoner", "pyreCaller"]));
  });

  it("wants none of them in any phase, raid or stand-in of any strategy", () => {
    for (const strategy of V8_STRATEGIES) {
      const kinds = [...strategy.phases.flatMap((phase) => phase.wants.flatMap((want) => ("unit" in want ? [want.unit] : []))), ...strategy.raids.flatMap((raid) => raid.kinds), strategy.standIn];
      expect(kinds.filter((kind) => V8_FORBIDDEN_UNIT_KINDS.has(kind)), strategy.id).toEqual([]);
    }
  });

  it("leaves the buildings that make them without them, whatever gold it has, and trains its casters there", () => {
    const cases: { race: "grove" | "ember"; building: BuildingKind; casters: boolean }[] = [
      { race: "grove", building: "sanctum", casters: true },
      { race: "grove", building: "archeryRange", casters: false },
      { race: "ember", building: "cinderSpire", casters: true },
    ];
    for (const { race, building, casters } of cases) {
      // Nine farms beside the hall: supply 62, past every tier's bar, so the building could train anything it makes.
      let scene = sketchScene(`v8-idle-${building}`)
        .map("openClaims")
        .replaceDefaults()
        .player("v8", { team: "north", race })
        .player("p1", { team: "south", race: "grove" })
        .playerState("v8", { gold: 2_000 })
        .townHall("v8", 500, 500)
        .building("v8", building, 700, 560, { id: "maker" })
        .townHall("p1", 3_300, 3_300);
      for (let index = 0; index < 9; index += 1) scene = scene.building("v8", "farm", 300 + (index % 3) * 90, 800 + Math.floor(index / 3) * 90);
      const game = scene.build().createGame();
      expect(game.players.v8!.supplyCap).toBeGreaterThanOrEqual(60);
      for (const strategy of V8_STRATEGIES.filter((candidate) => candidate.race === race)) {
        const memory = createAiPolicyMemory();
        memory.v6 = { doctrine: { profileId: "steady", strategyId: strategy.id, decidedTick: 0 }, phase: 3 };
        const commands = planV6Economy(snapshotGame(game), "v8", { version: "v2", requestedVersion: "v8", teams: game.teams, memory });
        const trained = commands.flatMap((command) => (command.type === "train" && command.buildingId === "maker" ? [command.unitKind] : []));
        if (casters) expect(trained.length, `${strategy.id} ${building}`).toBeGreaterThan(0);
        expect(trained.filter((kind) => V8_FORBIDDEN_UNIT_KINDS.has(kind)), `${strategy.id} ${building}`).toEqual([]);
      }
    }
  });
});
