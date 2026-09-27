import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory } from "../memory";
import { planV6Economy } from "./v6/economy";
import { V8_STRATEGIES } from "./v8/doctrine";
import { SUMMONING_UNIT_KINDS } from "./versions";

describe("v8 fields no summoners", () => {
  it("knows the summoning kinds from the catalog", () => {
    expect(SUMMONING_UNIT_KINDS).toEqual(new Set(["summoner", "pyreCaller"]));
  });

  it("wants no summoner in any phase, raid or stand-in of any strategy", () => {
    for (const strategy of V8_STRATEGIES) {
      const kinds = [...strategy.phases.flatMap((phase) => phase.wants.flatMap((want) => ("unit" in want ? [want.unit] : []))), ...strategy.raids.flatMap((raid) => raid.kinds), strategy.standIn];
      expect(kinds.filter((kind) => SUMMONING_UNIT_KINDS.has(kind)), strategy.id).toEqual([]);
    }
  });

  it("leaves a sanctum or spire it owns without summoners, whatever gold it has", () => {
    for (const race of ["grove", "ember"] as const) {
      // Nine farms beside the hall: supply 62, past every tier's bar, so the casters' building can train anything.
      let scene = sketchScene(`v8-idle-${race}`)
        .map("openClaims")
        .replaceDefaults()
        .player("v8", { team: "north", race })
        .player("p1", { team: "south", race: "grove" })
        .playerState("v8", { gold: 2_000 })
        .townHall("v8", 500, 500)
        .building("v8", race === "grove" ? "sanctum" : "cinderSpire", 700, 560, { id: "casters" })
        .townHall("p1", 3_300, 3_300);
      for (let index = 0; index < 9; index += 1) scene = scene.building("v8", "farm", 300 + (index % 3) * 90, 800 + Math.floor(index / 3) * 90);
      const game = scene.build().createGame();
      expect(game.players.v8!.supplyCap).toBeGreaterThanOrEqual(60);
      for (const strategy of V8_STRATEGIES.filter((candidate) => candidate.race === race)) {
        const memory = createAiPolicyMemory();
        memory.v6 = { doctrine: { profileId: "steady", strategyId: strategy.id, decidedTick: 0 }, phase: 3 };
        const commands = planV6Economy(snapshotGame(game), "v8", { version: "v2", requestedVersion: "v8", teams: game.teams, memory });
        const trained = commands.flatMap((command) => (command.type === "train" && command.buildingId === "casters" ? [command.unitKind] : []));
        // It does train there (its healers and cursers), just never a summoner.
        expect(trained.length, strategy.id).toBeGreaterThan(0);
        expect(trained.filter((kind) => SUMMONING_UNIT_KINDS.has(kind)), strategy.id).toEqual([]);
      }
    }
  });
});
