import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory } from "../memory";
import { V6_AI_STACK } from "./core";
import { V6_STRATEGIES } from "./v6/doctrine";
import { planV6Economy } from "./v6/economy";
import { SHOOTER_UNIT_KINDS } from "./versions";

describe("v6 fields no shooters", () => {
  it("wants no shooter in any phase of any strategy", () => {
    for (const strategy of V6_STRATEGIES) {
      const kinds = strategy.phases.flatMap((phase) => phase.wants.flatMap((want) => ("unit" in want ? [want.unit] : "front" in want ? [want.front.chaser, want.front.holder] : [])));
      expect(kinds.filter((kind) => SHOOTER_UNIT_KINDS.has(kind)), strategy.id).toEqual([]);
    }
  });

  it("leaves an archery range it happens to own idle, whatever gold it has", () => {
    const game = sketchScene("v6-idle-range")
      .map("openClaims")
      .replaceDefaults()
      .player("v6", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v5", { team: "south", race: "grove" })
      .playerState("v6", { gold: 2_000 })
      .townHall("v6", 500, 500)
      .building("v6", "archeryRange", 700, 560, { id: "range" })
      .townHall("v3", 3_300, 3_300)
      .townHall("v5", 3_300, 3_800)
      .build()
      .createGame();
    for (const strategy of V6_STRATEGIES.filter((candidate) => candidate.race === "grove")) {
      const memory = createAiPolicyMemory();
      memory.v6 = { doctrine: { profileId: "steady", strategyId: strategy.id, decidedTick: 0 } };
      const commands = planV6Economy(snapshotGame(game), "v6", { version: "v2", requestedVersion: "v6", teams: game.teams, memory });
      expect(commands.filter((command) => command.type === "train" && command.buildingId === "range"), strategy.id).toEqual([]);
    }
  });

  it("runs no script that hires mercenaries", () => {
    expect(V6_AI_STACK.map((script) => script.id)).not.toContain("mercenary");
  });
});
